/*
 * @license
 * Copyright 2026 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Clipboard } from '@jupyterlab/apputils';
import { ExplorerTree } from './ExplorerTree';
import * as api from './api';
import { requestAPI } from '../handler';
import { resetTelemetry } from '../common/telemetry';

jest.mock('../icons', () => {
  const react = require('react');
  const stub = {
    react: (props: Record<string, unknown>) =>
      react.createElement('span', props)
  };
  return {
    addIcon: stub,
    columnIcon: stub,
    datasetIcon: stub,
    historyIcon: stub,
    projectIcon: stub,
    queryIcon: stub,
    searchClearIcon: stub,
    searchIcon: stub,
    datasetExplorerIcon: stub,
    iconForTableType: () => stub
  };
});
jest.mock('./api');
jest.mock('../handler');
const mockedApi = api as jest.Mocked<typeof api>;
const mockedRequest = requestAPI as jest.MockedFunction<typeof requestAPI>;

function features(): string[] {
  return mockedRequest.mock.calls
    .filter(([endpoint, init]) => endpoint === 'telemetry' && init?.method)
    .map(([, init]) => JSON.parse(init?.body as string).event)
    .map(e => e.bigquery_feature_use.feature);
}

function renderTree(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <ExplorerTree
        settings={null}
        actions={{
          openDetails: jest.fn(),
          openQuery: jest.fn(),
          openHistory: jest.fn()
        }}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  resetTelemetry();
  mockedRequest.mockImplementation(
    async (_e, init) => (init?.method ? '' : { enabled: true }) as any
  );
  mockedApi.getConfig.mockResolvedValue({
    principal: 'user@example.com',
    project: 'proj-a'
  });
  mockedApi.bigqueryStatus.mockResolvedValue({ enabled: true });
  mockedApi.dataplexStatus.mockResolvedValue({ enabled: true });
  mockedApi.listDatasets.mockImplementation((projectId: string) =>
    Promise.resolve({
      datasets:
        projectId === 'proj-a' ? [{ id: 'sales', projectId: 'proj-a' }] : [],
      nextPageToken: null
    })
  );
  mockedApi.listTables.mockResolvedValue({
    tables: [{ id: 'orders', type: 'TABLE' }],
    nextPageToken: null
  });
  mockedApi.searchTables.mockResolvedValue({ results: [], partial: false });
  jest.spyOn(Clipboard, 'copyToSystem').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

async function openTableMenu(): Promise<void> {
  fireEvent.click(await screen.findByText('proj-a', { selector: '.bq-label' }));
  fireEvent.click(await screen.findByText('sales'));
  fireEvent.contextMenu(await screen.findByText('orders'));
}

describe('ExplorerTree telemetry', () => {
  it('records COPY_SELECT_STATEMENT for the boilerplate query copy', async () => {
    renderTree();
    await openTableMenu();
    fireEvent.click(await screen.findByText('Copy boilerplate query'));
    await waitFor(() => expect(features()).toEqual(['COPY_SELECT_STATEMENT']));
    // The copied SQL names the table; telemetry must not.
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain('orders');
  });

  it('records COPY_TABLE_ID for Copy table ID', async () => {
    renderTree();
    await openTableMenu();
    fireEvent.click(await screen.findByText('Copy table ID'));
    await waitFor(() => expect(features()).toEqual(['COPY_TABLE_ID']));
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain('orders');
  });

  it('records COPY_DATAFRAME_CODE for the table menu copy', async () => {
    renderTree();
    await openTableMenu();
    fireEvent.click(await screen.findByText('Copy DataFrame code'));
    await waitFor(() => expect(features()).toEqual(['COPY_DATAFRAME_CODE']));
  });

  it('does not record other ID copies', async () => {
    renderTree();
    fireEvent.contextMenu(
      await screen.findByText('proj-a', { selector: '.bq-label' })
    );
    fireEvent.click(await screen.findByText('Copy project ID'));
    await new Promise(r => setTimeout(r, 30));
    expect(features()).toEqual([]);
  });

  it('records SEARCH once per search request, not per keystroke', async () => {
    renderTree();
    await screen.findByText('proj-a');
    const box = screen.getByPlaceholderText(
      'Search tables & datasets (3+ chars)'
    );
    for (const value of ['o', 'or', 'ord', 'orde', 'order']) {
      fireEvent.change(box, { target: { value } });
    }
    await waitFor(() => expect(mockedApi.searchTables).toHaveBeenCalled());
    await waitFor(() => expect(features()).toEqual(['SEARCH']));
    expect(mockedApi.searchTables).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain('order');
  });

  it('does not record SEARCH when the search request fails', async () => {
    mockedApi.searchTables.mockRejectedValue(new Error('boom'));
    renderTree();
    await screen.findByText('proj-a');
    fireEvent.change(
      screen.getByPlaceholderText('Search tables & datasets (3+ chars)'),
      { target: { value: 'orders' } }
    );
    await waitFor(() => expect(mockedApi.searchTables).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 30));
    expect(features()).toEqual([]);
  });
});
