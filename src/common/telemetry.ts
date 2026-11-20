/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

// Workbench usage telemetry. Events are fixed enums, booleans and integers --
// never SQL, resource names, error text or anything typed. The server writes
// them only on Workbench instances with usage telemetry turned on; elsewhere
// `enabled` is false and everything here is a no-op. Sends are fire-and-forget.

import { requestAPI } from '../handler';

export type JobSurface = 'QUERY_EDITOR' | 'TABLE_STATS';
export type JobOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
export type FailureReason =
  | 'ACCESS_DENIED'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'QUOTA_EXCEEDED'
  | 'RESOURCES_EXCEEDED'
  | 'RESPONSE_TOO_LARGE'
  | 'BILLING_NOT_ENABLED'
  | 'POLICY_VIOLATION'
  | 'BACKEND_ERROR'
  | 'OTHER_FAILURE';
export type StatementKind =
  'SELECT' | 'DML' | 'DDL' | 'SCRIPT' | 'OTHER_STATEMENT';
export type Feature =
  | 'FORMAT_SQL'
  | 'COPY_DATAFRAME_CODE'
  | 'COPY_TABLE_ID'
  | 'COPY_SELECT_STATEMENT'
  | 'SEARCH'
  | 'TABLE_PREVIEW'
  | 'OPEN_DETAILS'
  | 'OPEN_HISTORY'
  | 'GENERATE_STATS'
  | 'OTHER_FEATURE';

export interface IBigQueryJobFields {
  surface: JobSurface;
  outcome: JobOutcome;
  failureReason?: FailureReason;
  statementKind?: StatementKind;
  cacheHit?: boolean | null;
  bytesProcessed?: number | null;
  durationMs?: number | null;
  ranSelection?: boolean;
}

let enabledPromise: Promise<boolean> | null = null;

// One GET per page load; a failed check counts as disabled.
function isEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = requestAPI<{ enabled?: unknown }>('telemetry')
      .then(r => r?.enabled === true)
      .catch(() => false);
  }
  return enabledPromise;
}

/** Forget the cached enabled check (tests only). */
export function resetTelemetry(): void {
  enabledPromise = null;
}

function send(event: Record<string, Record<string, unknown>>): void {
  void isEnabled()
    .then(enabled =>
      enabled
        ? requestAPI('telemetry', {
            method: 'POST',
            body: JSON.stringify({ event })
          })
        : undefined
    )
    .catch(() => undefined);
}

function nonNegativeInt(n: number | null | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
    ? Math.round(n)
    : undefined;
}

/** Record one finished BigQuery job. Unknown values are omitted. */
export function recordBigQueryJob(fields: IBigQueryJobFields): void {
  try {
    // Built field by field so nothing but the known keys can be sent.
    const job: Record<string, unknown> = {
      surface: fields.surface,
      outcome: fields.outcome
    };
    if (fields.outcome === 'FAILED' && fields.failureReason) {
      job.failure_reason = fields.failureReason;
    }
    if (fields.statementKind) {
      job.statement_kind = fields.statementKind;
    }
    if (typeof fields.cacheHit === 'boolean') {
      job.cache_hit = fields.cacheHit;
    }
    const bytes = nonNegativeInt(fields.bytesProcessed);
    if (bytes !== undefined) {
      job.processed_bytes = bytes;
    }
    const duration = nonNegativeInt(fields.durationMs);
    if (duration !== undefined) {
      job.duration_ms = duration;
    }
    if (
      fields.surface === 'QUERY_EDITOR' &&
      typeof fields.ranSelection === 'boolean'
    ) {
      job.ran_selection = fields.ranSelection;
    }
    send({ bigquery_job: job });
  } catch {
    // telemetry must never affect the UI
  }
}

/** Record one use of a feature. */
export function recordFeatureUse(feature: Feature): void {
  try {
    send({ bigquery_feature_use: { feature } });
  } catch {
    // telemetry must never affect the UI
  }
}

/**
 * Map BigQuery's `statementType` to a coarse kind; undefined when missing.
 * The input string is only compared, never copied into the result.
 */
export function statementKind(
  statementType?: string | null
): StatementKind | undefined {
  if (typeof statementType !== 'string' || !statementType) {
    return undefined;
  }
  const t = statementType.toUpperCase();
  if (t === 'SELECT') {
    return 'SELECT';
  }
  if (['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(t)) {
    return 'DML';
  }
  if (
    t.startsWith('CREATE_') ||
    t.startsWith('DROP_') ||
    t.startsWith('ALTER_') ||
    t.startsWith('TRUNCATE_TABLE')
  ) {
    return 'DDL';
  }
  if (t === 'SCRIPT') {
    return 'SCRIPT';
  }
  return 'OTHER_STATEMENT';
}

// BigQuery's error `reason` tokens. The HTTP status alone is misleading: the
// client library maps e.g. responseTooLarge and billingNotEnabled to 403.
const REASON_TO_FAILURE: Record<string, FailureReason> = {
  accessDenied: 'ACCESS_DENIED',
  notFound: 'NOT_FOUND',
  invalid: 'INVALID_REQUEST',
  invalidQuery: 'INVALID_REQUEST',
  quotaExceeded: 'QUOTA_EXCEEDED',
  rateLimitExceeded: 'QUOTA_EXCEEDED',
  resourcesExceeded: 'RESOURCES_EXCEEDED',
  billingTierLimitExceeded: 'RESOURCES_EXCEEDED',
  responseTooLarge: 'RESPONSE_TOO_LARGE',
  billingNotEnabled: 'BILLING_NOT_ENABLED',
  policyViolation: 'POLICY_VIOLATION',
  backendError: 'BACKEND_ERROR',
  internalError: 'BACKEND_ERROR'
};

/**
 * Classify an error thrown by `requestAPI`: by the API's `reason` token when
 * there is one, otherwise by HTTP status. The error message is never inspected.
 */
export function failureReason(error: unknown): FailureReason {
  const e = error as {
    reason?: unknown;
    response?: { status?: unknown };
  } | null;
  const reason = e?.reason;
  const status = e?.response?.status;
  if (typeof reason === 'string' && reason) {
    return Object.prototype.hasOwnProperty.call(REASON_TO_FAILURE, reason)
      ? REASON_TO_FAILURE[reason]
      : 'OTHER_FAILURE';
  }
  if (status === 429) {
    return 'QUOTA_EXCEEDED';
  }
  if (status === 401 || status === 403) {
    return 'ACCESS_DENIED';
  }
  if (status === 404) {
    return 'NOT_FOUND';
  }
  if (status === 400) {
    return 'INVALID_REQUEST';
  }
  return 'OTHER_FAILURE';
}
