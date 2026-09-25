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
import { QueryHistory } from './QueryHistory';
import * as api from '../explorer/api';

jest.mock('../explorer/api');
const mockedApi = api as jest.Mocked<typeof api>;

function job(
  overrides: Partial<api.IQueryHistoryJob> = {}
): api.IQueryHistoryJob {
  const now = new Date().toISOString();
  return {
    jobId: 'job-a',
    projectId: 'proj-a',
    location: 'US',
    state: 'DONE',
    query: 'SELECT 1',
    statementType: 'SELECT',
    created: now,
    started: now,
    ended: now,
    totalBytesProcessed: 1024 * 1024,
    totalBytesBilled: 1024 * 1024,
    cacheHit: false,
    errored: false,
    errorMessage: null,
    userEmail: 'me@example.com',
    ...overrides
  };
}

function renderHistory(
  props: Partial<React.ComponentProps<typeof QueryHistory>> = {}
): { openQuery: jest.Mock } {
  const openQuery = jest.fn();
  render(
    <QueryHistory
      projects={['proj-a', 'proj-b']}
      defaultProject="proj-a"
      openQuery={openQuery}
      {...props}
    />
  );
  return { openQuery };
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedApi.listQueryHistory.mockResolvedValue({
    jobs: [
      job({ jobId: 'job-a', query: 'SELECT 1' }),
      job({
        jobId: 'job-b',
        query: 'SELECT 2',
        errored: true,
        state: 'DONE',
        errorMessage: 'Boom: bad query'
      })
    ],
    nextPageToken: null
  });
});

describe('QueryHistory', () => {
  // CUJ-28: recent jobs list, grouped by day, with condensed SQL.
  it('lists recent query jobs grouped by day', async () => {
    renderHistory();
    expect(await screen.findByText('SELECT 1')).toBeInTheDocument();
    expect(screen.getByText('SELECT 2')).toBeInTheDocument();
    // created is "now", so both fall under the Today group.
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(mockedApi.listQueryHistory).toHaveBeenCalledWith('proj-a', 50);
  });

  // CUJ-29: expanding a job reveals its detail metadata.
  it('expands a job to show its details', async () => {
    renderHistory();
    fireEvent.click(await screen.findByText('SELECT 1'));
    expect(await screen.findByText('Bytes processed')).toBeInTheDocument();
    expect(screen.getByText('job-a')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
  });

  // CUJ-29 (failed job): the detail surfaces the error message.
  it('shows the error message when expanding a failed job', async () => {
    renderHistory();
    fireEvent.click(await screen.findByText('SELECT 2'));
    expect(await screen.findByText('Boom: bad query')).toBeInTheDocument();
  });

  // CUJ-30 / entry point: "Open" loads that job's SQL into a query editor.
  it('opens a past query in the editor', async () => {
    const { openQuery } = renderHistory();
    await screen.findByText('SELECT 1');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Open query in editor' })[0]
    );
    expect(openQuery).toHaveBeenCalledWith('SELECT 1');
  });

  // CUJ-31: "Load more" appends the next page via nextPageToken.
  it('appends the next page with Load more', async () => {
    mockedApi.listQueryHistory
      .mockResolvedValueOnce({
        jobs: [job({ jobId: 'job-a', query: 'SELECT 1' })],
        nextPageToken: 'tok-2'
      })
      .mockResolvedValueOnce({
        jobs: [job({ jobId: 'job-c', query: 'SELECT 3' })],
        nextPageToken: null
      });
    renderHistory();
    fireEvent.click(await screen.findByText('Load more'));
    expect(await screen.findByText('SELECT 3')).toBeInTheDocument();
    expect(mockedApi.listQueryHistory).toHaveBeenLastCalledWith(
      'proj-a',
      50,
      'tok-2'
    );
  });

  // CUJ-31: the refresh button re-fetches from the top.
  it('refreshes on demand', async () => {
    renderHistory();
    await screen.findByText('SELECT 1');
    fireEvent.click(
      screen.getByRole('button', { name: 'Refresh query history' })
    );
    await waitFor(() =>
      expect(mockedApi.listQueryHistory).toHaveBeenCalledTimes(2)
    );
  });

  // CUJ-31: switching the project reloads history for that project.
  it('reloads history when the project changes', async () => {
    renderHistory();
    await screen.findByText('SELECT 1');
    fireEvent.change(screen.getByTitle('Project'), {
      target: { value: 'proj-b' }
    });
    await waitFor(() =>
      expect(mockedApi.listQueryHistory).toHaveBeenCalledWith('proj-b', 50)
    );
  });

  // Empty and error states render inline, not as a crash.
  it('shows an empty state when there are no jobs', async () => {
    mockedApi.listQueryHistory.mockResolvedValue({
      jobs: [],
      nextPageToken: null
    });
    renderHistory();
    expect(
      await screen.findByText(/No query jobs found in proj-a/)
    ).toBeInTheDocument();
  });

  it('surfaces a history-fetch error inline', async () => {
    mockedApi.listQueryHistory.mockRejectedValue(
      new Error('403 Caller does not have permission')
    );
    renderHistory();
    expect(
      await screen.findByText(/403 Caller does not have permission/)
    ).toBeInTheDocument();
  });

  // CUJ-31 (auto-refresh on show): the host can trigger a reload via the
  // registered callback without re-mounting the component.
  it('reloads via the registered host callback', async () => {
    let reload: (() => void) | null = null;
    renderHistory({ registerReload: fn => (reload = fn) });
    await screen.findByText('SELECT 1');
    expect(reload).toBeInstanceOf(Function);
    reload!();
    await waitFor(() =>
      expect(mockedApi.listQueryHistory).toHaveBeenCalledTimes(2)
    );
  });
});
