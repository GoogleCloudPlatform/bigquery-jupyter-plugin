/*
 * @license
 * Copyright 2026 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { ServerConnection } from '@jupyterlab/services';
import { requestAPI } from '../handler';
import {
  failureReason,
  recordBigQueryJob,
  recordFeatureUse,
  resetTelemetry,
  statementKind
} from './telemetry';

jest.mock('../handler', () => ({ requestAPI: jest.fn() }));
const mockedRequest = requestAPI as jest.MockedFunction<typeof requestAPI>;

const flush = (): Promise<void> => new Promise(r => setTimeout(r, 0));

function posts(): unknown[] {
  return mockedRequest.mock.calls
    .filter(([, init]) => init?.method === 'POST')
    .map(([endpoint, init]) => ({
      endpoint,
      body: JSON.parse(init?.body as string)
    }));
}

beforeEach(() => {
  jest.resetAllMocks();
  resetTelemetry();
});

describe('telemetry', () => {
  it('is a no-op when the server reports disabled', async () => {
    mockedRequest.mockResolvedValue({ enabled: false });
    recordFeatureUse('FORMAT_SQL');
    recordBigQueryJob({ surface: 'QUERY_EDITOR', outcome: 'CANCELLED' });
    await flush();
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith('telemetry');
    expect(posts()).toEqual([]);
  });

  it('is a no-op when the enabled check fails', async () => {
    mockedRequest.mockRejectedValue(new Error('boom'));
    recordFeatureUse('FORMAT_SQL');
    await flush();
    recordFeatureUse('SEARCH');
    await flush();
    expect(posts()).toEqual([]);
    // The failed check is cached too: no retry storm.
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when enabled is not literally true', async () => {
    mockedRequest.mockResolvedValue({ enabled: 'yes' });
    recordFeatureUse('SEARCH');
    await flush();
    expect(posts()).toEqual([]);
  });

  it('posts the exact feature payload when enabled', async () => {
    mockedRequest.mockImplementation(async (_e, init) =>
      init?.method === 'POST' ? '' : { enabled: true }
    );
    recordFeatureUse('COPY_TABLE_ID');
    await flush();
    expect(posts()).toEqual([
      {
        endpoint: 'telemetry',
        body: { event: { bigquery_feature_use: { feature: 'COPY_TABLE_ID' } } }
      }
    ]);
  });

  it('posts the exact job payload and checks enabled only once', async () => {
    mockedRequest.mockImplementation(async (_e, init) =>
      init?.method === 'POST' ? '' : { enabled: true }
    );
    recordBigQueryJob({
      surface: 'QUERY_EDITOR',
      outcome: 'SUCCEEDED',
      statementKind: 'SELECT',
      cacheHit: false,
      bytesProcessed: 104857600,
      durationMs: 3400,
      ranSelection: false
    });
    recordFeatureUse('SEARCH');
    await flush();
    const gets = mockedRequest.mock.calls.filter(([, i]) => !i);
    expect(gets).toHaveLength(1);
    expect(posts()).toEqual([
      {
        endpoint: 'telemetry',
        body: {
          event: {
            bigquery_job: {
              surface: 'QUERY_EDITOR',
              outcome: 'SUCCEEDED',
              statement_kind: 'SELECT',
              cache_hit: false,
              processed_bytes: 104857600,
              duration_ms: 3400,
              ran_selection: false
            }
          }
        }
      },
      {
        endpoint: 'telemetry',
        body: { event: { bigquery_feature_use: { feature: 'SEARCH' } } }
      }
    ]);
  });

  it('omits unknown or invalid job fields', async () => {
    mockedRequest.mockImplementation(async (_e, init) =>
      init?.method === 'POST' ? '' : { enabled: true }
    );
    recordBigQueryJob({
      surface: 'QUERY_EDITOR',
      outcome: 'SUCCEEDED',
      cacheHit: null,
      bytesProcessed: null,
      durationMs: -1
    });
    recordBigQueryJob({
      surface: 'TABLE_STATS',
      outcome: 'SUCCEEDED',
      bytesProcessed: 12.4,
      ranSelection: true,
      // failure_reason is only valid with FAILED
      failureReason: 'OTHER_FAILURE'
    });
    await flush();
    expect(posts().map((p: any) => p.body.event.bigquery_job)).toEqual([
      { surface: 'QUERY_EDITOR', outcome: 'SUCCEEDED' },
      { surface: 'TABLE_STATS', outcome: 'SUCCEEDED', processed_bytes: 12 }
    ]);
  });

  it('includes failure_reason for FAILED', async () => {
    mockedRequest.mockImplementation(async (_e, init) =>
      init?.method === 'POST' ? '' : { enabled: true }
    );
    recordBigQueryJob({
      surface: 'QUERY_EDITOR',
      outcome: 'FAILED',
      failureReason: 'ACCESS_DENIED',
      durationMs: 5
    });
    await flush();
    expect((posts()[0] as any).body.event.bigquery_job).toEqual({
      surface: 'QUERY_EDITOR',
      outcome: 'FAILED',
      failure_reason: 'ACCESS_DENIED',
      duration_ms: 5
    });
  });

  it('swallows send errors', async () => {
    mockedRequest.mockImplementation(async (_e, init) => {
      if (init?.method === 'POST') {
        throw new Error('post failed');
      }
      return { enabled: true };
    });
    expect(() => recordFeatureUse('SEARCH')).not.toThrow();
    await flush();
  });
});

describe('statementKind', () => {
  it.each([
    ['SELECT', 'SELECT'],
    ['INSERT', 'DML'],
    ['UPDATE', 'DML'],
    ['DELETE', 'DML'],
    ['MERGE', 'DML'],
    ['CREATE_TABLE', 'DDL'],
    ['CREATE_TABLE_AS_SELECT', 'DDL'],
    ['DROP_VIEW', 'DDL'],
    ['ALTER_TABLE', 'DDL'],
    ['TRUNCATE_TABLE', 'DDL'],
    ['SCRIPT', 'SCRIPT'],
    ['EXPORT_DATA', 'OTHER_STATEMENT'],
    ['CALL', 'OTHER_STATEMENT'],
    ['SOMETHING_NEW', 'OTHER_STATEMENT']
  ])('maps %s to %s', (input, expected) => {
    expect(statementKind(input)).toBe(expected);
  });

  it.each([[undefined], [null], ['']])('omits %p', input => {
    expect(statementKind(input)).toBeUndefined();
  });
});

describe('failureReason', () => {
  const err = (status?: number, reason?: string): unknown =>
    Object.assign(new Error('some message'), {
      response: status === undefined ? undefined : { status },
      reason
    });

  it.each([
    // No reason: classified by HTTP status.
    [400, undefined, 'INVALID_REQUEST'],
    [401, undefined, 'ACCESS_DENIED'],
    [403, undefined, 'ACCESS_DENIED'],
    [404, undefined, 'NOT_FOUND'],
    [429, undefined, 'QUOTA_EXCEEDED'],
    [500, undefined, 'OTHER_FAILURE'],
    [undefined, undefined, 'OTHER_FAILURE'],
    // A reason wins over the status the client library chose for it.
    [403, 'accessDenied', 'ACCESS_DENIED'],
    [404, 'notFound', 'NOT_FOUND'],
    [400, 'invalid', 'INVALID_REQUEST'],
    [400, 'invalidQuery', 'INVALID_REQUEST'],
    [403, 'quotaExceeded', 'QUOTA_EXCEEDED'],
    [429, 'rateLimitExceeded', 'QUOTA_EXCEEDED'],
    [400, 'resourcesExceeded', 'RESOURCES_EXCEEDED'],
    [400, 'billingTierLimitExceeded', 'RESOURCES_EXCEEDED'],
    [403, 'responseTooLarge', 'RESPONSE_TOO_LARGE'],
    [403, 'billingNotEnabled', 'BILLING_NOT_ENABLED'],
    [403, 'policyViolation', 'POLICY_VIOLATION'],
    [500, 'backendError', 'BACKEND_ERROR'],
    [500, 'internalError', 'BACKEND_ERROR'],
    // An unknown reason is OTHER_FAILURE, not guessed from the status.
    [403, 'blocked', 'OTHER_FAILURE'],
    [400, 'tableUnavailable', 'OTHER_FAILURE'],
    [403, 'toString', 'OTHER_FAILURE']
  ])('status %p reason %p -> %s', (status, reason, expected) => {
    expect(failureReason(err(status, reason))).toBe(expected);
  });

  it('handles non-error values', () => {
    expect(failureReason('string')).toBe('OTHER_FAILURE');
    expect(failureReason(null)).toBe('OTHER_FAILURE');
    expect(failureReason(undefined)).toBe('OTHER_FAILURE');
  });

  it('never inspects the error message', () => {
    const e = Object.assign(new Error('403 Forbidden quotaExceeded 404'), {});
    expect(failureReason(e)).toBe('OTHER_FAILURE');
  });
});

describe('requestAPI errors', () => {
  it('exposes the HTTP status and reason to failureReason', async () => {
    const { requestAPI: realRequestAPI } = jest.requireActual('../handler');
    const spy = jest.spyOn(ServerConnection, 'makeRequest').mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      text: async () =>
        JSON.stringify({ error: 'Quota exceeded', reason: 'quotaExceeded' })
    } as unknown as Response);
    let caught: unknown;
    try {
      await realRequestAPI('query');
    } catch (e) {
      caught = e;
    }
    spy.mockRestore();
    expect(caught).toBeInstanceOf(ServerConnection.ResponseError);
    expect((caught as Error).message).toBe('Quota exceeded');
    expect((caught as { reason?: string }).reason).toBe('quotaExceeded');
    expect(failureReason(caught)).toBe('QUOTA_EXCEEDED');
  });

  it('leaves reason unset when the body has none', async () => {
    const { requestAPI: realRequestAPI } = jest.requireActual('../handler');
    const spy = jest.spyOn(ServerConnection, 'makeRequest').mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      text: async () => JSON.stringify({ error: 'nope' })
    } as unknown as Response);
    let caught: unknown;
    try {
      await realRequestAPI('table');
    } catch (e) {
      caught = e;
    }
    spy.mockRestore();
    expect((caught as { reason?: string }).reason).toBeUndefined();
    expect(failureReason(caught)).toBe('NOT_FOUND');
  });
});
