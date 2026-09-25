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
import { Clipboard, Notification } from '@jupyterlab/apputils';
import React, { useEffect, useRef, useState } from 'react';
import {
  cancelQuery,
  dryRun,
  executeQuery,
  getQueryResults,
  IQueryResults,
  IQueryStats,
  ISchemaField,
  PreviewCell
} from '../explorer/api';
import { PagerBar, ResultsGrid } from '../common/ResultsView';

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// One-line post-run summary from the job stats: bytes processed / billed, cache
// hit, and slot time. Mirrors what the Query history panel shows per job, but
// inline in the editor right after a run.
function formatStats(stats: IQueryStats): string {
  const parts: string[] = [];
  if (stats.cacheHit) {
    // A cache hit is free: no bytes are billed, so lead with that.
    parts.push('Results served from cache (no bytes billed)');
  } else {
    parts.push(`Processed ${humanBytes(stats.totalBytesProcessed)}`);
    if (
      stats.totalBytesBilled !== null &&
      stats.totalBytesBilled !== undefined
    ) {
      parts.push(`billed ${humanBytes(stats.totalBytesBilled)}`);
    }
  }
  if (stats.slotMillis !== null && stats.slotMillis !== undefined) {
    parts.push(`slot time ${(stats.slotMillis / 1000).toFixed(1)}s`);
  }
  return parts.join(' · ');
}

// Escape a string for embedding inside a Python single-quoted literal.
function pyStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// Generate a self-contained Python snippet that runs the SQL and returns the
// results as a pandas DataFrame, using the same google-cloud-bigquery client the
// plugin's backend uses. The SQL goes in a triple-double-quoted string (its
// backslashes and any embedded `"""` are escaped so the snippet stays valid).
function dataframeCode(sql: string, project: string): string {
  const escapedSql = sql.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const clientArgs = project ? `project=${pyStr(project)}` : '';
  return [
    '# Run the query and load the results into a pandas DataFrame.',
    'from google.cloud import bigquery',
    '',
    `client = bigquery.Client(${clientArgs})`,
    'df = client.query(',
    `    """${escapedSql}"""`,
    ').to_dataframe()',
    'df'
  ].join('\n');
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
  const [stats, setStats] = useState<IQueryStats | null>(null);
  const [columns, setColumns] = useState<ISchemaField[]>([]);
  const [rows, setRows] = useState<PreviewCell[][]>([]);
  const [totalRows, setTotalRows] = useState<number | null>(null);
  // Results pagination: `page` (0-based) and `pageSize` drive a random-access
  // fetch (startIndex = page * pageSize); `paging` disables the controls while a
  // page is loading.
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [paging, setPaging] = useState(false);
  const jobRef = useRef<IJobRef | null>(null);
  const cancelRef = useRef(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor.IEditor | null>(null);
  const runRef = useRef<() => void>(() => undefined);
  const formatRef = useRef<() => void>(() => undefined);
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
    setStats(null);
    setPage(0);
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
          0,
          pageSize
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
      setStats(res.stats ?? null);
      setPage(0);
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

  // Fetch an arbitrary results page (random access via startIndex) and replace
  // the grid. Used by the first/prev/next/last controls and the page-size menu.
  const fetchPage = async (newPage: number, size: number): Promise<void> => {
    if (!jobRef.current) {
      return;
    }
    setPaging(true);
    try {
      const res = await getQueryResults(
        jobRef.current.jobId,
        jobRef.current.projectId,
        jobRef.current.location,
        newPage * size,
        size
      );
      setRows(res.rows);
      if (res.totalRows !== null) {
        setTotalRows(res.totalRows);
      }
      setPage(newPage);
      setPageSize(size);
    } catch (e) {
      setRunError(errorMessage(e));
    } finally {
      setPaging(false);
    }
  };

  // Pretty-print the whole query with sql-formatter (BigQuery dialect). Reads
  // from the editor (or `sql` in the textarea fallback), reformats, and writes
  // back -- which flows through the mirror to update state / dry-run. On a parse
  // error the text is left unchanged and the message is shown non-destructively.
  const formatSql = async (): Promise<void> => {
    const model = editorRef.current?.model;
    const current = model ? model.sharedModel.getSource() : sql;
    if (!current.trim()) {
      return;
    }
    let formatted: string;
    try {
      // Loaded on demand: sql-formatter is ~600 KiB, so keep it out of the
      // initial bundle and only fetch it when the user actually formats.
      const { formatDialect, bigquery } = await import('sql-formatter');
      formatted = formatDialect(current, {
        dialect: bigquery,
        keywordCase: 'upper',
        tabWidth: 2
      });
    } catch (e) {
      setEstimateError(`Could not format SQL: ${errorMessage(e)}`);
      return;
    }
    if (formatted === current) {
      return;
    }
    if (model) {
      model.sharedModel.setSource(formatted);
    } else {
      setSql(formatted);
      onSqlChange?.(formatted);
    }
  };

  // Generate a pandas-DataFrame snippet for the current query (selection or whole
  // doc) and copy it to the clipboard, so a data scientist can paste it into a
  // notebook cell and get the results as a DataFrame.
  const copyDataFrameCode = (): void => {
    const query = getQueryToRun();
    if (!query.trim()) {
      return;
    }
    Clipboard.copyToSystem(dataframeCode(query, project));
    Notification.success('Copied DataFrame code', { autoClose: 2000 });
  };

  // Keep the keymap handlers pointing at the latest closures without recreating
  // the editor.
  runRef.current = () => void run();
  formatRef.current = () => void formatSql();

  // Mount a CodeMirror 6 SQL editor (via the app's editor factory) once. React
  // `sql` state becomes a mirror of the editor's document; the editor itself is
  // the source of truth. Falls back to a plain textarea if IEditorServices is
  // unavailable.
  useEffect(() => {
    if (!editorServices || !hostRef.current) {
      return;
    }
    // Set the SQL mimeType so the host resolves a language into its (high
    // precedence) language compartment -- that is also what makes it apply the
    // theme's syntax highlighting. We then override the *parser* with our
    // BigQuery dialect at Prec.highest below, so the backtick fix stays while
    // the host keeps driving the highlight style.
    const model = new CodeEditor.Model({ mimeType: 'text/x-sql' });
    model.sharedModel.setSource(initialQuery ?? '');
    const wrapper = new CodeEditorWrapper({
      model,
      factory: editorServices.factoryService.newInlineEditor,
      editorOptions: {
        config: { lineNumbers: false },
        extensions: [
          Prec.highest(sqlLanguage({ dialect: BIGQUERY_SQL })),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  runRef.current();
                  return true;
                }
              },
              {
                key: 'Shift-Alt-f',
                run: () => {
                  formatRef.current();
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
        <button
          className="bq-qe-format"
          onClick={() => void formatSql()}
          disabled={running || !sql.trim()}
          title="Format SQL (Shift+Alt+F)"
        >
          Format
        </button>
        <button
          className="bq-qe-dataframe"
          onClick={copyDataFrameCode}
          disabled={!sql.trim()}
          title="Copy Python code to load these results as a pandas DataFrame"
        >
          Copy DataFrame code
        </button>
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
      {stats && <div className="bq-qe-stats">{formatStats(stats)}</div>}
      {columns.length > 0 && (
        <div className="bq-qe-results">
          <PagerBar
            page={page}
            pageSize={pageSize}
            totalRows={totalRows}
            rowsOnPage={rows.length}
            busy={paging || running}
            onPage={p => void fetchPage(p, pageSize)}
            onPageSize={s => void fetchPage(0, s)}
          />
          <ResultsGrid
            columns={columns}
            rows={rows}
            startIndex={page * pageSize}
          />
        </div>
      )}
    </div>
  );
}
