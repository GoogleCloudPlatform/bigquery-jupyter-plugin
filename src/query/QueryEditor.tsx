/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  cancelQuery,
  dryRun,
  executeQuery,
  getQueryResults,
  IQueryResults,
  ISchemaField,
  PreviewCell
} from '../explorer/api';

const PAGE_SIZE = 100;
const POLL_MS = 800;
const MAX_POLLS = 225; // ~3 min at POLL_MS

interface IJobRef {
  jobId: string;
  projectId: string | null;
  location: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function humanBytes(n?: number | null): string {
  if (n === null || n === undefined) {
    return 'an unknown number of bytes';
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

function formatCell(value: PreviewCell): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function QueryEditor({
  initialQuery,
  projects,
  defaultProject,
  onSqlChange
}: {
  initialQuery?: string;
  projects: string[];
  defaultProject: string | null;
  onSqlChange?: (sql: string) => void;
}): JSX.Element {
  const [sql, setSql] = useState(initialQuery ?? '');
  const [project, setProject] = useState(defaultProject ?? projects[0] ?? '');
  const [estimate, setEstimate] = useState('');
  const [estimateError, setEstimateError] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [runError, setRunError] = useState('');
  const [columns, setColumns] = useState<ISchemaField[]>([]);
  const [rows, setRows] = useState<PreviewCell[][]>([]);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const jobRef = useRef<IJobRef | null>(null);
  const cancelRef = useRef(false);

  // Live dry-run cost estimate (debounced) as the SQL or project changes.
  useEffect(() => {
    // Editing the query invalidates a previous run's error.
    setRunError('');
    if (!sql.trim()) {
      setEstimate('');
      setEstimateError('');
      return;
    }
    const handle = setTimeout(() => {
      dryRun(sql, project || undefined)
        .then(d => {
          setEstimateError('');
          setEstimate(
            `This query will process ${humanBytes(d.totalBytesProcessed)} when run.`
          );
        })
        .catch(e => {
          setEstimate('');
          setEstimateError(errorMessage(e));
        });
    }, 500);
    return () => clearTimeout(handle);
  }, [sql, project]);

  const run = async (): Promise<void> => {
    setRunError('');
    setEstimateError('');
    setRows([]);
    setColumns([]);
    setTotalRows(null);
    setNextToken(null);
    cancelRef.current = false;
    setRunning(true);
    setStatus('Submitting…');
    const started = Date.now();
    try {
      const job = await executeQuery(sql, project || undefined);
      jobRef.current = {
        jobId: job.jobId,
        projectId: job.projectId,
        location: job.location
      };
      let res: IQueryResults | null = null;
      for (let i = 0; i < MAX_POLLS; i += 1) {
        if (cancelRef.current) {
          setStatus('Cancelled');
          return;
        }
        res = await getQueryResults(
          job.jobId,
          job.projectId,
          job.location,
          null,
          PAGE_SIZE
        );
        if (res.state === 'DONE') {
          break;
        }
        setStatus(
          `${res.state}… ${((Date.now() - started) / 1000).toFixed(1)}s`
        );
        await sleep(POLL_MS);
      }
      if (cancelRef.current) {
        setStatus('Cancelled');
        return;
      }
      if (!res || res.state !== 'DONE') {
        throw new Error('Timed out waiting for the query to finish.');
      }
      setColumns(res.schema);
      setRows(res.rows);
      setTotalRows(res.totalRows);
      setNextToken(res.nextPageToken ?? null);
      setStatus(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (e) {
      if (!cancelRef.current) {
        setRunError(errorMessage(e));
        setStatus('');
      }
    } finally {
      setRunning(false);
    }
  };

  const cancel = async (): Promise<void> => {
    cancelRef.current = true;
    setStatus('Cancelling…');
    if (jobRef.current) {
      try {
        await cancelQuery(
          jobRef.current.jobId,
          jobRef.current.projectId,
          jobRef.current.location
        );
      } catch {
        // best-effort; the poll loop stops regardless
      }
    }
    setStatus('Cancelled');
  };

  const loadMore = async (): Promise<void> => {
    if (!jobRef.current || !nextToken) {
      return;
    }
    try {
      const res = await getQueryResults(
        jobRef.current.jobId,
        jobRef.current.projectId,
        jobRef.current.location,
        nextToken,
        PAGE_SIZE
      );
      setRows(prev => [...prev, ...res.rows]);
      setNextToken(res.nextPageToken ?? null);
    } catch (e) {
      setRunError(errorMessage(e));
    }
  };

  return (
    <div className="bq-qe">
      <div className="bq-qe-toolbar">
        <button
          className="bq-qe-run"
          onClick={run}
          disabled={running || !sql.trim()}
        >
          {running ? 'Running…' : 'Run'}
        </button>
        {running && (
          <button className="bq-qe-cancel" onClick={cancel}>
            Cancel
          </button>
        )}
        {projects.length > 0 && (
          <label className="bq-qe-project-label">
            Project:
            <select
              className="bq-qe-project"
              value={project}
              onChange={e => setProject(e.target.value)}
              disabled={running}
            >
              {projects.map(p => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        {estimate && <span className="bq-qe-estimate">{estimate}</span>}
        {status && <span className="bq-qe-status">{status}</span>}
      </div>
      <textarea
        className="bq-qe-sql"
        spellCheck={false}
        value={sql}
        placeholder="Write SQL, e.g. SELECT * FROM `project.dataset.table` LIMIT 100"
        onChange={e => {
          setSql(e.target.value);
          onSqlChange?.(e.target.value);
        }}
      />
      {runError ? (
        <div className="bq-qe-error">{runError}</div>
      ) : estimateError ? (
        <div className="bq-qe-estimate-error">{estimateError}</div>
      ) : null}
      {columns.length > 0 && (
        <div className="bq-qe-results">
          <div className="bq-dt-preview-info">
            {rows.length.toLocaleString()}
            {totalRows !== null ? ` of ${totalRows.toLocaleString()}` : ''} rows
          </div>
          <div className="bq-dt-preview-scroll">
            <table className="bq-dt-table bq-dt-grid">
              <thead>
                <tr>
                  <th className="bq-dt-rownum">#</th>
                  {columns.map(c => (
                    <th key={c.name}>{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    <td className="bq-dt-rownum">{r + 1}</td>
                    {row.map((cell, c) => (
                      <td
                        key={c}
                        className={cell === null ? 'bq-dt-null' : undefined}
                      >
                        {formatCell(cell)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextToken && (
            <button className="bq-dt-more" onClick={loadMore}>
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
