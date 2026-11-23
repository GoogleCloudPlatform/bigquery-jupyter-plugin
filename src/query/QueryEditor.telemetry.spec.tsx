/*
 * @license
 * Copyright 2026 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { Clipboard, Notification } from '@jupyterlab/apputils';
import { IEditorServices } from '@jupyterlab/codeeditor';
import { Widget } from '@lumino/widgets';
import { QueryEditor } from './QueryEditor';
import * as api from '../explorer/api';
import { requestAPI } from '../handler';
import { resetTelemetry } from '../common/telemetry';

jest.mock('../explorer/api');
jest.mock('../handler');
jest.mock('sql-formatter', () => ({
  formatDialect: (s: string) => {
    if (s.includes('BADSQL')) {
      throw new Error('parse error');
    }
    return s.replace(/select/gi, 'SELECT');
  },
  bigquery: {}
}));
const mockedApi = api as jest.Mocked<typeof api>;
const mockedRequest = requestAPI as jest.MockedFunction<typeof requestAPI>;

const MARKER_SQL = 'MARKER_SQL_9f3c';
const MARKER_ERR = 'MARKER_ERR_55bd';

// Telemetry events the component sent (POST bodies, parsed).
function events(): any[] {
  return mockedRequest.mock.calls
    .filter(([endpoint, init]) => endpoint === 'telemetry' && init?.method)
    .map(([, init]) => JSON.parse(init?.body as string).event);
}

function jobs(): any[] {
  return events()
    .filter(e => e.bigquery_job)
    .map(e => e.bigquery_job);
}

function httpError(
  status?: number,
  message = 'failed',
  reason?: string
): Error {
  return Object.assign(new Error(message), {
    response: status === undefined ? undefined : { status },
    reason
  });
}

function renderEditor(
  props: Partial<React.ComponentProps<typeof QueryEditor>> = {}
): void {
  render(
    <QueryEditor
      projects={['proj-a']}
      defaultProject="proj-a"
      editorServices={null}
      initialQuery="SELECT 1"
      {...props}
    />
  );
}

function clickRun(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run' }));
}

const realSetTimeout = global.setTimeout;

beforeEach(() => {
  jest.resetAllMocks();
  resetTelemetry();
  mockedRequest.mockImplementation(
    async (_e, init) => (init?.method ? '' : { enabled: true }) as any
  );
  mockedApi.dryRun.mockResolvedValue({ totalBytesProcessed: 1 });
  mockedApi.executeQuery.mockResolvedValue({
    jobId: 'job-1',
    projectId: 'proj-a',
    location: 'US',
    state: 'RUNNING'
  });
  mockedApi.getQueryResults.mockResolvedValue({
    state: 'DONE',
    schema: [{ name: 'n', type: 'INTEGER', fields: [] }],
    rows: [[1]],
    totalRows: 1,
    startIndex: 0,
    stats: {
      totalBytesProcessed: 10 * 1024 * 1024,
      totalBytesBilled: 10 * 1024 * 1024,
      cacheHit: false,
      statementType: 'SELECT',
      slotMillis: 1500
    }
  });
  mockedApi.cancelQuery.mockResolvedValue({ jobId: 'job-1', state: 'DONE' });
});

afterEach(() => {
  global.setTimeout = realSetTimeout;
  jest.restoreAllMocks();
});

describe('QueryEditor telemetry', () => {
  it('reports a successful run', async () => {
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()[0]).toEqual({
      surface: 'QUERY_EDITOR',
      outcome: 'SUCCEEDED',
      statement_kind: 'SELECT',
      cache_hit: false,
      processed_bytes: 10485760,
      duration_ms: expect.any(Number),
      ran_selection: false
    });
    expect(Number.isInteger(jobs()[0].duration_ms)).toBe(true);
  });

  it('maps DML and cache hits, and omits unknown bytes', async () => {
    mockedApi.getQueryResults.mockResolvedValue({
      state: 'DONE',
      schema: [],
      rows: [],
      totalRows: 0,
      stats: {
        totalBytesProcessed: null,
        cacheHit: true,
        statementType: 'MERGE'
      }
    });
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    const job = jobs()[0];
    expect(job.statement_kind).toBe('DML');
    expect(job.cache_hit).toBe(true);
    expect(job).not.toHaveProperty('processed_bytes');
  });

  it('omits statement_kind and cache_hit when stats are missing', async () => {
    mockedApi.getQueryResults.mockResolvedValue({
      state: 'DONE',
      schema: [],
      rows: [],
      totalRows: 0,
      stats: null
    });
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()[0]).toEqual({
      surface: 'QUERY_EDITOR',
      outcome: 'SUCCEEDED',
      duration_ms: expect.any(Number),
      ran_selection: false
    });
  });

  it('reports a cancelled run once', async () => {
    mockedApi.getQueryResults.mockResolvedValue({
      state: 'RUNNING',
      schema: [],
      rows: [],
      totalRows: null
    });
    renderEditor();
    clickRun();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(jobs()).toHaveLength(1), { timeout: 3000 });
    // Let any stray second report show up.
    await act(() => new Promise(r => realSetTimeout(r, 1000)));
    expect(jobs()).toEqual([
      {
        surface: 'QUERY_EDITOR',
        outcome: 'CANCELLED',
        duration_ms: expect.any(Number),
        ran_selection: false
      }
    ]);
  });

  it('reports a timeout', async () => {
    // Poll sleeps (800 ms) run immediately so 225 polls finish quickly. Plain
    // assignment: a jest spy would make Testing Library assume fake timers.
    global.setTimeout = ((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms === 800 ? 0 : ms)) as unknown as typeof setTimeout;
    mockedApi.getQueryResults.mockResolvedValue({
      state: 'RUNNING',
      schema: [],
      rows: [],
      totalRows: null
    });
    renderEditor();
    clickRun();
    expect(
      await screen.findByText('Timed out waiting for the query to finish.')
    ).toBeInTheDocument();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()).toEqual([
      {
        surface: 'QUERY_EDITOR',
        outcome: 'TIMED_OUT',
        duration_ms: expect.any(Number),
        ran_selection: false
      }
    ]);
  });

  it.each([
    [400, undefined, 'INVALID_REQUEST'],
    [401, undefined, 'ACCESS_DENIED'],
    [403, undefined, 'ACCESS_DENIED'],
    [404, undefined, 'NOT_FOUND'],
    [429, undefined, 'QUOTA_EXCEEDED'],
    [403, 'quotaExceeded', 'QUOTA_EXCEEDED'],
    [403, 'rateLimitExceeded', 'QUOTA_EXCEEDED'],
    [403, 'responseTooLarge', 'RESPONSE_TOO_LARGE'],
    [400, 'resourcesExceeded', 'RESOURCES_EXCEEDED'],
    [500, undefined, 'OTHER_FAILURE'],
    [undefined, undefined, 'OTHER_FAILURE']
  ])(
    'reports a failure with status %p / reason %p as %s',
    async (status, reason, expected) => {
      mockedApi.executeQuery.mockRejectedValue(
        httpError(status, 'bad', reason)
      );
      renderEditor();
      clickRun();
      await waitFor(() => expect(jobs()).toHaveLength(1));
      expect(jobs()[0]).toEqual({
        surface: 'QUERY_EDITOR',
        outcome: 'FAILED',
        failure_reason: expected,
        duration_ms: expect.any(Number),
        ran_selection: false
      });
    }
  );

  it('reports a failure while polling for results', async () => {
    mockedApi.getQueryResults.mockRejectedValue(httpError(403));
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()[0]).toMatchObject({
      outcome: 'FAILED',
      failure_reason: 'ACCESS_DENIED'
    });
  });

  it('reports the statement kind of a job that failed after parsing', async () => {
    mockedApi.getQueryResults.mockRejectedValue(
      Object.assign(httpError(403), { statementType: 'DELETE' })
    );
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()[0]).toMatchObject({
      outcome: 'FAILED',
      failure_reason: 'ACCESS_DENIED',
      statement_kind: 'DML'
    });
  });

  it('falls back to the polled statement kind for a failure', async () => {
    global.setTimeout = ((fn: () => void, ms?: number) =>
      realSetTimeout(fn, ms === 800 ? 0 : ms)) as unknown as typeof setTimeout;
    mockedApi.getQueryResults
      .mockResolvedValueOnce({
        state: 'RUNNING',
        schema: [],
        rows: [],
        totalRows: null,
        statementType: 'INSERT'
      })
      .mockRejectedValueOnce(httpError(400));
    renderEditor();
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    expect(jobs()[0]).toMatchObject({
      outcome: 'FAILED',
      failure_reason: 'INVALID_REQUEST',
      statement_kind: 'DML'
    });
  });

  it('reports the polled statement kind of a cancelled run', async () => {
    mockedApi.getQueryResults.mockResolvedValue({
      state: 'RUNNING',
      schema: [],
      rows: [],
      totalRows: null,
      statementType: 'SELECT'
    });
    renderEditor();
    clickRun();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(jobs()).toHaveLength(1), { timeout: 3000 });
    expect(jobs()[0]).toMatchObject({
      outcome: 'CANCELLED',
      statement_kind: 'SELECT'
    });
  });

  it('never records SQL or error text', async () => {
    mockedApi.executeQuery.mockRejectedValue(
      httpError(400, `Syntax error near ${MARKER_ERR} in ${MARKER_SQL}`)
    );
    renderEditor({ initialQuery: `SELECT '${MARKER_SQL}' FROM t` });
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(1));
    // The UI shows the error text, but telemetry must not carry it.
    expect(await screen.findByText(new RegExp(MARKER_ERR))).toBeInTheDocument();
    // Same for a succeeded run of the same SQL.
    mockedApi.executeQuery.mockResolvedValue({
      jobId: `job-${MARKER_SQL}`,
      projectId: `proj-${MARKER_SQL}`,
      location: 'US',
      state: 'RUNNING'
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Run' })).toBeEnabled()
    );
    clickRun();
    await waitFor(() => expect(jobs()).toHaveLength(2));
    // The component did render the error and SQL, so the marker is in play.
    const everything = JSON.stringify(mockedRequest.mock.calls);
    expect(everything).not.toContain(MARKER_SQL);
    expect(everything).not.toContain(MARKER_ERR);
    expect(everything).toContain('bigquery_job');
  });

  it('records a feature use when Format is clicked', async () => {
    renderEditor({ initialQuery: 'select 1 from t' });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    await waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toEqual({
      bigquery_feature_use: { feature: 'FORMAT_SQL' }
    });
  });

  it('does not record Format when formatting fails', async () => {
    renderEditor({ initialQuery: 'BADSQL' });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    expect(await screen.findByText(/Could not format SQL/)).toBeInTheDocument();
    await act(() => new Promise(r => realSetTimeout(r, 50)));
    expect(events()).toEqual([]);
  });

  it('records a feature use when DataFrame code is copied', async () => {
    jest.spyOn(Clipboard, 'copyToSystem').mockImplementation(() => undefined);
    jest.spyOn(Notification, 'success').mockImplementation(() => 'id');
    renderEditor();
    fireEvent.click(
      screen.getByRole('button', { name: 'Copy DataFrame code' })
    );
    await waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toEqual({
      bigquery_feature_use: { feature: 'COPY_DATAFRAME_CODE' }
    });
    // The copied code contains the SQL, but telemetry does not.
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain('SELECT 1');
  });

  it('sends nothing when telemetry is disabled', async () => {
    mockedRequest.mockImplementation(
      async (_e, init) => (init?.method ? '' : { enabled: false }) as any
    );
    renderEditor();
    clickRun();
    await screen.findByText(/Done in/);
    await act(() => new Promise(r => realSetTimeout(r, 50)));
    expect(events()).toEqual([]);
  });

  it('still runs the query when the telemetry endpoint fails', async () => {
    mockedRequest.mockRejectedValue(new Error('telemetry down'));
    renderEditor();
    clickRun();
    expect(await screen.findByText(/Done in/)).toBeInTheDocument();
  });

  describe('with a CodeMirror-style editor', () => {
    // A stand-in for the CodeEditor: a single-line doc with a settable
    // selection, enough for the component's selection logic.
    function fakeServices(selection: {
      start: number;
      end: number;
    }): IEditorServices {
      const newInlineEditor = (options: any): any => ({
        model: options.model,
        getSelection: () => ({
          start: { line: 0, column: selection.start },
          end: { line: 0, column: selection.end }
        }),
        getOffsetAt: (pos: { column: number }) => pos.column,
        getLine: () => '',
        getOption: () => undefined,
        focus: () => undefined,
        dispose: () => undefined
      });
      return {
        factoryService: { newInlineEditor }
      } as unknown as IEditorServices;
    }

    // RTL removes the host node before the widget's cleanup runs, which makes
    // Widget.detach throw in jsdom; that is a test artifact, not component logic.
    beforeEach(() => {
      jest.spyOn(Widget, 'detach').mockImplementation(() => undefined);
    });

    it('flags ran_selection when only the selection is run', async () => {
      renderEditor({
        initialQuery: 'SELECT 1; SELECT 2',
        editorServices: fakeServices({ start: 0, end: 8 })
      });
      clickRun();
      await waitFor(() => expect(jobs()).toHaveLength(1));
      expect(mockedApi.executeQuery).toHaveBeenCalledWith('SELECT 1', 'proj-a');
      expect(jobs()[0].ran_selection).toBe(true);
    });

    it('does not flag ran_selection for a whitespace-only selection', async () => {
      renderEditor({
        initialQuery: 'SELECT 1; SELECT 2',
        editorServices: fakeServices({ start: 6, end: 7 })
      });
      clickRun();
      await waitFor(() => expect(jobs()).toHaveLength(1));
      expect(mockedApi.executeQuery).toHaveBeenCalledWith(
        'SELECT 1; SELECT 2',
        'proj-a'
      );
      expect(jobs()[0].ran_selection).toBe(false);
    });

    it('does not flag ran_selection with no selection', async () => {
      renderEditor({
        initialQuery: 'SELECT 1; SELECT 2',
        editorServices: fakeServices({ start: 3, end: 3 })
      });
      clickRun();
      await waitFor(() => expect(jobs()).toHaveLength(1));
      expect(jobs()[0].ran_selection).toBe(false);
    });
  });
});
