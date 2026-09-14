/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { sql as sqlLanguage, SQLDialect } from '@codemirror/lang-sql';
import { Prec } from '@codemirror/state';
import {
  EditorView,
  keymap,
  placeholder as cmPlaceholder
} from '@codemirror/view';
import {
  CodeEditor,
  CodeEditorWrapper,
  IEditorServices
} from '@jupyterlab/codeeditor';
import { Widget } from '@lumino/widgets';
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

// BigQuery SQL dialect: StandardSQL keywords/types, but with backtick-quoted
// identifiers so a fully-qualified `project.dataset.table` is one identifier
// token (StandardSQL would otherwise lex the words inside the backticks and
// mis-highlight ones like `public` as keywords). Also enables BigQuery's
// `#` line comments, double-quoted strings, and backslash escapes.
const BIGQUERY_SQL = SQLDialect.define({
  identifierQuotes: '`',
  doubleQuotedStrings: true,
  hashComments: true,
  backslashEscapes: true
});

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
  editorServices,
  onSqlChange
}: {
  initialQuery?: string;
  projects: string[];
  defaultProject: string | null;
  editorServices?: IEditorServices | null;
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
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor.IEditor | null>(null);
  const runRef = useRef<() => void>(() => undefined);
  const onSqlChangeRef = useRef(onSqlChange);
  onSqlChangeRef.current = onSqlChange;

  const useCodeMirror = !!editorServices;

  // Return the text to run: the selection if there is one, else the whole doc.
  // Reads the live editor (source of truth) via the abstract CodeEditor API.
  const getQueryToRun = (): string => {
    const ed = editorRef.current;
    if (!ed) {
      return sql;
    }
    const source = ed.model.sharedModel.getSource();
    const sel = ed.getSelection();
    const a = ed.getOffsetAt(sel.start);
    const b = ed.getOffsetAt(sel.end);
    const selected = source.slice(Math.min(a, b), Math.max(a, b));
    return selected.trim() ? selected : source;
  };

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
      const job = await executeQuery(getQueryToRun(), project || undefined);
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

  // Keep the keymap's run handler pointing at the latest closure without
  // recreating the editor.
  runRef.current = () => void run();

  // Mount a CodeMirror 6 SQL editor (via the app's editor factory) once. React
  // `sql` state becomes a mirror of the editor's document; the editor itself is
  // the source of truth. Falls back to a plain textarea if IEditorServices is
  // unavailable.
  useEffect(() => {
    if (!editorServices || !hostRef.current) {
      return;
    }
    // No text/x-sql mimeType: that would make the host inject its own
    // (StandardSQL) language and conflict with the BigQuery dialect we supply
    // below. We provide the language explicitly via the sql() extension.
    const model = new CodeEditor.Model();
    model.sharedModel.setSource(initialQuery ?? '');
    const wrapper = new CodeEditorWrapper({
      model,
      factory: editorServices.factoryService.newInlineEditor,
      editorOptions: {
        config: { lineNumbers: false },
        extensions: [
          sqlLanguage({ dialect: BIGQUERY_SQL }),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  runRef.current();
                  return true;
                }
              }
            ])
          ),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ spellcheck: 'false' }),
          cmPlaceholder(
            'Write SQL, e.g. SELECT * FROM `project.dataset.table` LIMIT 100'
          )
        ]
      }
    });
    editorRef.current = wrapper.editor;
    Widget.attach(wrapper, hostRef.current);
    // setSource above runs before this connect, so the initial value does not
    // fire the mirror; only user edits do.
    const onChanged = (): void => {
      const text = model.sharedModel.getSource();
      setSql(text);
      onSqlChangeRef.current?.(text);
    };
    model.sharedModel.changed.connect(onChanged);
    return () => {
      model.sharedModel.changed.disconnect(onChanged);
      editorRef.current = null;
      wrapper.dispose();
    };
    // Create once. `sql` is intentionally not a dependency (it is a mirror).
  }, []);

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
      {useCodeMirror ? (
        <div className="bq-qe-sql bq-qe-cm" ref={hostRef} />
      ) : (
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
      )}
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
