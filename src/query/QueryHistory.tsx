/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { IQueryHistoryJob, listQueryHistory } from '../explorer/api';
import { oneLine } from '../common/format';

const PAGE_SIZE = 50;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function humanBytes(n?: number | null): string {
  if (n === null || n === undefined) {
    return '—';
  }
  if (n === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function duration(started: string | null, ended: string | null): string {
  if (!started || !ended) {
    return '—';
  }
  const secs = (Date.parse(ended) - Date.parse(started)) / 1000;
  if (Number.isNaN(secs) || secs < 0) {
    return '—';
  }
  return `${secs.toFixed(1)}s`;
}

/** Local calendar-day label for grouping: Today / Yesterday / locale date. */
function dayLabel(iso: string | null): string {
  if (!iso) {
    return 'Unknown';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return 'Unknown';
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date): boolean =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) {
    return 'Today';
  }
  if (sameDay(d, yesterday)) {
    return 'Yesterday';
  }
  return d.toLocaleDateString();
}

function timeLabel(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function QueryHistory({
  projects,
  defaultProject,
  openQuery,
  registerReload
}: {
  projects: string[];
  defaultProject: string | null;
  openQuery: (sql: string) => void;
  // Lets the host widget trigger a refetch (e.g. when the tab is re-shown), so
  // queries run since the panel opened appear without a manual refresh.
  registerReload?: (reload: (() => void) | null) => void;
}): JSX.Element {
  const [project, setProject] = useState(defaultProject ?? projects[0] ?? '');
  const [jobs, setJobs] = useState<IQueryHistoryJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError('');
    setExpanded(null);
    try {
      const page = await listQueryHistory(project || undefined, PAGE_SIZE);
      setJobs(page.jobs);
      setNextToken(page.nextPageToken ?? null);
    } catch (e) {
      setJobs([]);
      setNextToken(null);
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [project]);

  useEffect(() => {
    void load();
  }, [load]);

  // Expose the latest load() to the host widget via a stable callback, so a
  // re-show can refresh without re-mounting the component.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    registerReload?.(() => void loadRef.current());
    return () => registerReload?.(null);
  }, [registerReload]);

  const loadMore = async (): Promise<void> => {
    if (!nextToken) {
      return;
    }
    try {
      const page = await listQueryHistory(
        project || undefined,
        PAGE_SIZE,
        nextToken
      );
      setJobs(prev => [...prev, ...page.jobs]);
      setNextToken(page.nextPageToken ?? null);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  // Group by day, preserving the newest-first order the backend returns.
  const groups: [string, IQueryHistoryJob[]][] = [];
  for (const job of jobs) {
    const label = dayLabel(job.created);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) {
      last[1].push(job);
    } else {
      groups.push([label, [job]]);
    }
  }

  return (
    <div className="bq-qh">
      <div className="bq-qh-toolbar">
        <span className="bq-qh-title">Query history</span>
        <span className="bq-qh-toolbar-actions">
          {projects.length > 0 && (
            <select
              className="bq-qh-project"
              value={project}
              onChange={e => setProject(e.target.value)}
              disabled={loading}
              title="Project"
            >
              {projects.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          )}
          <button
            className="bq-icon-btn"
            title="Refresh"
            aria-label="Refresh query history"
            onClick={() => void load()}
            disabled={loading}
          >
            {'\u27f3'}
          </button>
        </span>
      </div>
      {error && <div className="bq-qh-error">{error}</div>}
      {loading && jobs.length === 0 ? (
        <div className="bq-qh-empty">Loading…</div>
      ) : !loading && jobs.length === 0 && !error ? (
        <div className="bq-qh-empty">
          No query jobs found in {project || 'this project'}.
        </div>
      ) : (
        <div className="bq-qh-list">
          {groups.map(([label, groupJobs]) => (
            <div className="bq-qh-group" key={label}>
              <div className="bq-qh-daterow">{label}</div>
              {groupJobs.map(job => (
                <div className="bq-qh-item" key={job.jobId}>
                  <div
                    className="bq-qh-bar"
                    onClick={() =>
                      setExpanded(expanded === job.jobId ? null : job.jobId)
                    }
                  >
                    <span className="bq-qh-time">{timeLabel(job.created)}</span>
                    <span
                      className={
                        job.errored ? 'bq-qh-status-err' : 'bq-qh-status-ok'
                      }
                      title={job.errored ? 'Failed' : 'Succeeded'}
                    >
                      {job.errored ? '\u2717' : '\u2713'}
                    </span>
                    <span className="bq-qh-sql" title={job.query ?? ''}>
                      {oneLine(job.query)}
                    </span>
                    <button
                      className="bq-qh-open"
                      title="Open in editor"
                      aria-label="Open in query editor"
                      onClick={event => {
                        event.stopPropagation();
                        openQuery(job.query ?? '');
                      }}
                    >
                      Open
                    </button>
                  </div>
                  {expanded === job.jobId && (
                    <div className="bq-qh-detail">
                      {job.errored && job.errorMessage && (
                        <div className="bq-qh-detail-error">
                          {job.errorMessage}
                        </div>
                      )}
                      <pre className="bq-qh-detail-sql">{job.query ?? ''}</pre>
                      <dl className="bq-qh-meta">
                        <dt>State</dt>
                        <dd>{job.state}</dd>
                        <dt>Statement</dt>
                        <dd>{job.statementType ?? '—'}</dd>
                        <dt>Bytes processed</dt>
                        <dd>{humanBytes(job.totalBytesProcessed)}</dd>
                        <dt>Bytes billed</dt>
                        <dd>{humanBytes(job.totalBytesBilled)}</dd>
                        <dt>Cache hit</dt>
                        <dd>{job.cacheHit ? 'yes' : 'no'}</dd>
                        <dt>Duration</dt>
                        <dd>{duration(job.started, job.ended)}</dd>
                        <dt>Job ID</dt>
                        <dd className="bq-qh-jobid">{job.jobId}</dd>
                        <dt>Location</dt>
                        <dd>{job.location ?? '—'}</dd>
                      </dl>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
          {nextToken && (
            <button className="bq-dt-more" onClick={() => void loadMore()}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
