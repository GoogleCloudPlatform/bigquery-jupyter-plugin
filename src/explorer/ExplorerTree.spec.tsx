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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ExplorerTree } from './ExplorerTree';
import * as api from './api';
import { ITableActions } from './TableActions';

// Stub the LabIcon set so the tree renders in jsdom without SVG loaders.
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
const mockedApi = api as jest.Mocked<typeof api>;

function renderTree(): ITableActions {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  const actions: ITableActions = {
    openDetails: jest.fn(),
    openQuery: jest.fn(),
    openHistory: jest.fn()
  };
  render(
    <QueryClientProvider client={client}>
      <ExplorerTree settings={null} actions={actions} />
    </QueryClientProvider>
  );
  return actions;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedApi.getConfig.mockResolvedValue({
    principal: 'user@example.com',
    project: 'proj-a'
  });
  mockedApi.bigqueryStatus.mockResolvedValue({ enabled: true });
  mockedApi.dataplexStatus.mockResolvedValue({ enabled: false });
  mockedApi.listDatasets.mockResolvedValue({
    datasets: [],
    nextPageToken: null
  });
  mockedApi.listTables.mockResolvedValue({ tables: [], nextPageToken: null });
  mockedApi.searchTables.mockResolvedValue({ results: [], partial: false });
});

describe('ExplorerTree', () => {
  // CUJ-1: identity header shows the active principal from /config.
  it('shows the active identity in the header', async () => {
    renderTree();
    expect(
      await screen.findByText('user@example.com', { selector: '.bq-principal' })
    ).toBeInTheDocument();
  });

  // CUJ-3: roots are the default project + bigquery-public-data.
  it('roots the tree at the default project and public data', async () => {
    renderTree();
    expect(
      await screen.findByText('proj-a', { selector: '.bq-label' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('bigquery-public-data', { selector: '.bq-label' })
    ).toBeInTheDocument();
  });

  // CUJ-3: "Add project by ID" adds a browsable root (in-session).
  it('adds a project by id', async () => {
    renderTree();
    await screen.findByText('proj-a', { selector: '.bq-label' });
    const input = screen.getByPlaceholderText('Add project by ID or number');
    fireEvent.change(input, { target: { value: 'proj-b' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(
      await screen.findByText('proj-b', { selector: '.bq-label' })
    ).toBeInTheDocument();
  });

  // A numeric input is a project number: resolve it to the canonical id and
  // show/persist the id, not the number.
  it('resolves a project number to its id when adding', async () => {
    mockedApi.resolveProject.mockResolvedValue({
      projectId: 'resolved-proj',
      projectNumber: '123456789012',
      name: 'resolved-proj'
    });
    renderTree();
    await screen.findByText('proj-a', { selector: '.bq-label' });
    const input = screen.getByPlaceholderText('Add project by ID or number');
    fireEvent.change(input, { target: { value: '123456789012' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(
      await screen.findByText('resolved-proj', { selector: '.bq-label' })
    ).toBeInTheDocument();
    expect(mockedApi.resolveProject).toHaveBeenCalledWith('123456789012');
    expect(
      screen.queryByText('123456789012', { selector: '.bq-label' })
    ).not.toBeInTheDocument();
  });

  // CUJ-4: the default (auto-opened) project lists its datasets.
  it('lists datasets for the default project', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'proj-a' ? [{ id: 'sales', projectId: 'proj-a' }] : [],
        nextPageToken: null
      })
    );
    renderTree();
    expect(await screen.findByText('sales')).toBeInTheDocument();
    expect(mockedApi.listDatasets).toHaveBeenCalledWith('proj-a', undefined);
  });

  // CUJ-9: a dataset-listing failure renders inline, not a crash.
  it('surfaces a dataset-listing error inline', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      projectId === 'proj-a'
        ? Promise.reject(new Error('404 Not found: Project proj-a'))
        : Promise.resolve({ datasets: [], nextPageToken: null })
    );
    renderTree();
    expect(
      await screen.findByText(/404 Not found: Project proj-a/)
    ).toBeInTheDocument();
  });

  // CUJ-40: BigQuery API disabled -> friendly enable banner.
  it('shows the enable-BigQuery banner when the API is off', async () => {
    mockedApi.bigqueryStatus.mockResolvedValue({ enabled: false });
    renderTree();
    expect(
      await screen.findByText(/The BigQuery API is not enabled/)
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Enable the BigQuery API/ })
    ).toBeInTheDocument();
  });

  // CUJ-40 (fail-open): no banner when the API is enabled.
  it('shows no enable banner when the API is enabled', async () => {
    renderTree();
    await screen.findByText('proj-a');
    await waitFor(() =>
      expect(mockedApi.bigqueryStatus).toHaveBeenCalledWith('proj-a')
    );
    expect(
      screen.queryByText(/The BigQuery API is not enabled/)
    ).not.toBeInTheDocument();
  });

  // Bug fix: a project with zero datasets shows an access hint (identity +
  // the roles/bigquery.dataViewer grant), not just a bare "No datasets".
  it('shows an access hint when a project has no datasets', async () => {
    // proj-a is empty; give bigquery-public-data data so only proj-a hints.
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'bigquery-public-data'
            ? [{ id: 'samples', projectId: 'bigquery-public-data' }]
            : [],
        nextPageToken: null
      })
    );
    renderTree();
    await screen.findByText(/No datasets/);
    const hint = document.querySelector('.bq-empty-hint') as HTMLElement;
    expect(hint).toBeTruthy();
    expect(hint).toHaveTextContent('user@example.com');
    expect(hint).toHaveTextContent('proj-a');
    expect(hint).toHaveTextContent('roles/bigquery.dataViewer');
    // The grant command must use a valid IAM member prefix. A plain email is a
    // user, so `user:` — never the bogus `user-or-serviceAccount:`.
    const cmd = hint.querySelector('.bq-cmd-text') as HTMLElement;
    expect(cmd).toHaveTextContent('--member="user:user@example.com"');
    expect(hint).not.toHaveTextContent('user-or-serviceAccount:');
  });

  // Bug fix: a service-account principal must be prefixed `serviceAccount:` in
  // the grant command (a `*.gserviceaccount.com` member as `user:` is rejected
  // by IAM with INVALID_ARGUMENT).
  it('uses the serviceAccount: prefix for a service-account identity', async () => {
    const sa = '267782943877-compute@developer.gserviceaccount.com';
    mockedApi.getConfig.mockResolvedValue({ principal: sa, project: 'proj-a' });
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'bigquery-public-data'
            ? [{ id: 'samples', projectId: 'bigquery-public-data' }]
            : [],
        nextPageToken: null
      })
    );
    renderTree();
    await screen.findByText(/No datasets/);
    const cmd = document.querySelector('.bq-cmd-text') as HTMLElement;
    expect(cmd).toHaveTextContent(`--member="serviceAccount:${sa}"`);
    expect(cmd).not.toHaveTextContent('user:');
  });

  // Bug fix: in search mode the project row still offers its context menu
  // (previously right-click on a search-result project did nothing).
  it('offers the project context menu in search results', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'proj-a'
            ? [{ id: 'census_data', projectId: 'proj-a' }]
            : [],
        nextPageToken: null
      })
    );
    renderTree();
    await screen.findByText('proj-a');
    const searchBox = screen.getByPlaceholderText(
      'Search tables & datasets (3+ chars)'
    );
    fireEvent.change(searchBox, { target: { value: 'census' } });
    // Wait until search mode renders a project row in the results.
    await waitFor(() =>
      expect(
        document.querySelector('.bq-search-results .bq-project')
      ).toBeTruthy()
    );
    const projectRow = document.querySelector(
      '.bq-search-results .bq-project'
    ) as HTMLElement;
    fireEvent.contextMenu(projectRow);
    expect(await screen.findByText('Refresh project')).toBeInTheDocument();
    expect(screen.getByText('Copy project ID')).toBeInTheDocument();
  });

  // Bug fix: RECORD/STRUCT columns expand to reveal their nested subfields
  // inline (previously every column rendered as a flat leaf).
  it('expands a RECORD column to show its nested fields', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'proj-a' ? [{ id: 'ds', projectId: 'proj-a' }] : [],
        nextPageToken: null
      })
    );
    mockedApi.listTables.mockResolvedValue({
      tables: [{ id: 'events', type: 'TABLE' }],
      nextPageToken: null
    });
    mockedApi.getTable.mockResolvedValue({
      id: 'events',
      projectId: 'proj-a',
      datasetId: 'ds',
      type: 'TABLE',
      schema: [
        { name: 'user_id', type: 'STRING', mode: 'NULLABLE', fields: [] },
        {
          name: 'address',
          type: 'RECORD',
          mode: 'REPEATED',
          fields: [
            { name: 'city', type: 'STRING', mode: 'NULLABLE', fields: [] },
            { name: 'zip', type: 'STRING', mode: 'NULLABLE', fields: [] }
          ]
        }
      ]
    });
    renderTree();

    // Drill in: project (auto-open) -> dataset -> table -> record column.
    fireEvent.click(await screen.findByText('ds', { selector: '.bq-label' }));
    fireEvent.click(
      await screen.findByText('events', { selector: '.bq-label' })
    );
    const recordCol = await screen.findByText('address', {
      selector: '.bq-label'
    });
    // Nested subfields stay hidden until the record column is expanded.
    expect(
      screen.queryByText('city', { selector: '.bq-label' })
    ).not.toBeInTheDocument();
    fireEvent.click(recordCol);
    expect(
      await screen.findByText('city', { selector: '.bq-label' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('zip', { selector: '.bq-label' })
    ).toBeInTheDocument();
  });

  // CUJ-9: expanding a dataset lists its tables with a type badge.
  it('browses tables under a dataset with a type badge', async () => {
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
    renderTree();
    fireEvent.click(await screen.findByText('sales'));
    expect(await screen.findByText('orders')).toBeInTheDocument();
    expect(
      screen.getByText('table', { selector: '.bq-badge' })
    ).toBeInTheDocument();
    expect(mockedApi.listTables).toHaveBeenCalledWith(
      'proj-a',
      'sales',
      undefined
    );
  });

  // CUJ-11: a table's context menu offers Open details / Query table / Copy
  // table ID, and Open details drives the table-actions callback.
  it('opens table details from the table context menu', async () => {
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
    const actions = renderTree();
    fireEvent.click(await screen.findByText('sales'));
    fireEvent.contextMenu(await screen.findByText('orders'));
    expect(await screen.findByText('Open details')).toBeInTheDocument();
    expect(screen.getByText('Query table')).toBeInTheDocument();
    expect(screen.getByText('Copy table ID')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open details'));
    expect(actions.openDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-a',
        datasetId: 'sales',
        tableId: 'orders',
        tableType: 'TABLE'
      })
    );
  });

  // CUJ-11: a dataset's context menu offers Copy dataset ID / Refresh dataset.
  it('offers dataset context-menu actions', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'proj-a' ? [{ id: 'sales', projectId: 'proj-a' }] : [],
        nextPageToken: null
      })
    );
    renderTree();
    fireEvent.contextMenu(await screen.findByText('sales'));
    expect(await screen.findByText('Copy dataset ID')).toBeInTheDocument();
    expect(screen.getByText('Refresh dataset')).toBeInTheDocument();
  });

  // CUJ-12: "Refresh all" re-fetches from the backend.
  it('re-fetches datasets when Refresh all is clicked', async () => {
    mockedApi.listDatasets.mockImplementation((projectId: string) =>
      Promise.resolve({
        datasets:
          projectId === 'proj-a' ? [{ id: 'sales', projectId: 'proj-a' }] : [],
        nextPageToken: null
      })
    );
    renderTree();
    await screen.findByText('sales');
    const before = mockedApi.listDatasets.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh all' }));
    await waitFor(() =>
      expect(mockedApi.listDatasets.mock.calls.length).toBeGreaterThan(before)
    );
  });

  // CUJ-8: an added project is removable and default roots are not; removal
  // takes it out of the tree.
  it('adds then removes a pinned project; defaults are not removable', async () => {
    renderTree();
    await screen.findByText('proj-a', { selector: '.bq-label' });
    const input = screen.getByPlaceholderText('Add project by ID or number');
    fireEvent.change(input, { target: { value: 'proj-b' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    await screen.findByText('proj-b', { selector: '.bq-label' });
    // Only the added project (proj-b) has a remove control; proj-a and
    // bigquery-public-data (defaults) do not.
    const removeButtons = screen.getAllByTitle('Remove project');
    expect(removeButtons).toHaveLength(1);
    fireEvent.click(removeButtons[0]);
    await waitFor(() =>
      expect(
        screen.queryByText('proj-b', { selector: '.bq-label' })
      ).not.toBeInTheDocument()
    );
  });

  // CUJ-31: the search box surfaces cross-dataset table matches (table search
  // is backed by Dataplex, so it must be enabled).
  it('searches tables via the search box', async () => {
    mockedApi.dataplexStatus.mockResolvedValue({ enabled: true });
    mockedApi.searchTables.mockResolvedValue({
      results: [
        {
          projectId: 'proj-a',
          datasetId: 'sales',
          tableId: 'orders',
          type: 'TABLE'
        }
      ],
      partial: false
    });
    renderTree();
    await screen.findByText('proj-a');
    fireEvent.change(
      screen.getByPlaceholderText('Search tables & datasets (3+ chars)'),
      { target: { value: 'orders' } }
    );
    expect(await screen.findByText('orders')).toBeInTheDocument();
  });
});
