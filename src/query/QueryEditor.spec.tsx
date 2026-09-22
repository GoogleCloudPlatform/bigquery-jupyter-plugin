/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryEditor } from './QueryEditor';
import * as api from '../explorer/api';

jest.mock('../explorer/api');
// sql-formatter is ESM and only pulled in (via dynamic import) when Format is
// clicked; mock it so the import resolves in jsdom with a deterministic result.
jest.mock('sql-formatter', () => ({
  formatDialect: (s: string) => s.replace(/select/gi, 'SELECT'),
  bigquery: {}
}));
const mockedApi = api as jest.Mocked<typeof api>;

function renderEditor(
  props: Partial<React.ComponentProps<typeof QueryEditor>> = {}
): void {
  render(
    <QueryEditor
      projects={['proj-a', 'proj-b']}
      defaultProject="proj-a"
      editorServices={null}
      {...props}
    />
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedApi.dryRun.mockResolvedValue({
    totalBytesProcessed: 5 * 1024 * 1024,
    cacheHit: false,
    statementType: 'SELECT'
  });
  mockedApi.executeQuery.mockResolvedValue({
    jobId: 'job-1',
    projectId: 'proj-a',
    location: 'US',
    state: 'RUNNING'
  });
  mockedApi.getQueryResults.mockResolvedValue({
    state: 'DONE',
    schema: [
      { name: 'word', type: 'STRING', fields: [] },
      { name: 'n', type: 'INTEGER', fields: [] }
    ],
    rows: [
      ['hello', 42],
      ['world', 7]
    ],
    totalRows: 250,
    startIndex: 0
  });
  mockedApi.cancelQuery.mockResolvedValue({ jobId: 'job-1', state: 'DONE' });
});

describe('QueryEditor', () => {
  // CUJ-21: the editor renders its toolbar (Run) and a SQL input.
  it('renders the toolbar and SQL input', () => {
    renderEditor();
    expect(screen.getByRole('button', { name: 'Run' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    // Run is disabled until there is SQL to run.
    expect(screen.getByRole('button', { name: 'Run' })).toBeDisabled();
  });

  // CUJ-24: a live (debounced) dry-run estimate appears as SQL is entered.
  it('shows a dry-run cost estimate for valid SQL', async () => {
    renderEditor();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'SELECT 1' }
    });
    expect(
      await screen.findByText(
        'This query will process 5.0 MB when run.',
        undefined,
        { timeout: 2500 }
      )
    ).toBeInTheDocument();
    expect(mockedApi.dryRun).toHaveBeenCalledWith('SELECT 1', 'proj-a');
  });

  // CUJ-24 (error path): invalid SQL surfaces an inline estimate error, no crash.
  it('shows an estimate error for invalid SQL', async () => {
    mockedApi.dryRun.mockRejectedValue(new Error('Syntax error near FROM'));
    renderEditor();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'SELCT bad' }
    });
    const err = await screen.findByText(/Syntax error near FROM/, undefined, {
      timeout: 2500
    });
    expect(err).toHaveClass('bq-qe-estimate-error');
  });

  // CUJ-25: the billing-project selector lists projects, defaults correctly, and
  // re-estimates against the chosen project.
  it('lists projects and re-estimates on project change', async () => {
    renderEditor({ initialQuery: 'SELECT 1' });
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('proj-a');
    expect(screen.getByRole('option', { name: 'proj-b' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'proj-b' } });
    await waitFor(
      () => expect(mockedApi.dryRun).toHaveBeenCalledWith('SELECT 1', 'proj-b'),
      { timeout: 2500 }
    );
  });

  // CUJ-21: running a query polls to completion and renders the results grid.
  it('runs a query and renders the results grid', async () => {
    renderEditor({ initialQuery: 'SELECT 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    expect(await screen.findByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
    expect(mockedApi.executeQuery).toHaveBeenCalledWith('SELECT 1', 'proj-a');
    expect(await screen.findByText(/Done in/)).toBeInTheDocument();
  });

  // CUJ-27: a query failure shows a red error banner (not a crash / raw 500).
  it('shows a run error banner when the query fails', async () => {
    mockedApi.executeQuery.mockRejectedValue(
      new Error('400 Syntax error: Unexpected end of statement')
    );
    renderEditor({ initialQuery: 'SELECT bad' });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    const err = await screen.findByText(/Unexpected end of statement/);
    expect(err).toHaveClass('bq-qe-error');
  });

  // CUJ-26: the results pager fetches an arbitrary page by random-access offset.
  it('fetches the next results page via the pager', async () => {
    renderEditor({ initialQuery: 'SELECT 1' });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await screen.findByText('hello');
    mockedApi.getQueryResults.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(mockedApi.getQueryResults).toHaveBeenCalledWith(
        'job-1',
        'proj-a',
        'US',
        100,
        100
      )
    );
  });

  // CUJ-30: Format pretty-prints the SQL in place.
  it('formats the SQL when Format is clicked', async () => {
    renderEditor({ initialQuery: 'select 1 from t' });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
    await waitFor(() =>
      expect(screen.getByRole('textbox')).toHaveValue('SELECT 1 from t')
    );
  });
});
