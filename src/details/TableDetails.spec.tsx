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
import { TableDetails } from './TableDetails';
import * as api from '../explorer/api';
import { ITableRef } from '../explorer/TableActions';

jest.mock('../explorer/api');
const mockedApi = api as jest.Mocked<typeof api>;

const TABLE_REF: ITableRef = {
  projectId: 'proj',
  datasetId: 'ds',
  tableId: 'events',
  tableType: 'TABLE'
};

function meta(overrides: Partial<api.ITableMeta> = {}): api.ITableMeta {
  return {
    id: 'events',
    projectId: 'proj',
    datasetId: 'ds',
    type: 'TABLE',
    schema: [
      { name: 'user_id', type: 'STRING', mode: 'NULLABLE', fields: [] },
      {
        name: 'address',
        type: 'RECORD',
        mode: 'REPEATED',
        fields: [{ name: 'city', type: 'STRING', mode: 'NULLABLE', fields: [] }]
      }
    ],
    numRows: 1234,
    sizeBytes: 2048,
    location: 'US',
    ...overrides
  };
}

function renderDetails(
  tref: ITableRef = TABLE_REF,
  onQuery?: (sql: string) => void
): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <TableDetails tref={tref} onQuery={onQuery} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.resetAllMocks();
  mockedApi.getTable.mockResolvedValue(meta());
  mockedApi.previewTable.mockResolvedValue({
    schema: [
      { name: 'user_id', type: 'STRING', fields: [] },
      { name: 'city', type: 'STRING', fields: [] }
    ],
    rows: [['u1', 'NYC']],
    totalRows: 1
  });
});

describe('TableDetails', () => {
  // CUJ-10 / CUJ-11: the Details tab is the default and combines the table
  // metadata with the schema (nested RECORD fields shown as indented child
  // rows). The former standalone Schema tab is merged in, not a separate tab.
  it('combines table info and the nested schema on the default Details tab', async () => {
    renderDetails();
    // Schema fields, incl. a nested RECORD subfield and REPEATED mode...
    expect(await screen.findByText('user_id')).toBeInTheDocument();
    expect(screen.getByText('address')).toBeInTheDocument();
    expect(screen.getByText('city')).toBeInTheDocument();
    expect(screen.getByText('REPEATED')).toBeInTheDocument();
    // ...render alongside the table metadata, all without switching tabs.
    expect(screen.getByText('proj.ds.events')).toBeInTheDocument();
    // The Schema tab was folded into Details, so it no longer exists.
    expect(
      screen.queryByRole('button', { name: 'Schema' })
    ).not.toBeInTheDocument();
  });

  // CUJ-12: the Details tab lists table metadata, partitioning and clustering.
  it('shows metadata, partitioning and clustering on the Details tab', async () => {
    mockedApi.getTable.mockResolvedValue(
      meta({
        timePartitioning: { type: 'DAY', field: 'ts' },
        clusteringFields: ['wiki', 'title']
      })
    );
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Details' }));
    expect(await screen.findByText('proj.ds.events')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('DAY on ts')).toBeInTheDocument();
    expect(screen.getByText('wiki, title')).toBeInTheDocument();
  });

  function statsFixture(): api.ITableStats {
    return {
      totalRows: 100,
      bytesProcessed: 4096,
      columns: [
        {
          name: 'user_id',
          type: 'STRING',
          nulls: 10,
          nullFraction: 0.1,
          distinct: 90,
          distinctFraction: 0.9,
          min: null,
          max: null,
          avg: null,
          stddev: null,
          zeros: null,
          zeroFraction: null,
          negatives: null,
          negativeFraction: null,
          infinite: null,
          infiniteFraction: null,
          topValues: [
            { value: 'alice', count: 60 },
            { value: 'bob', count: 40 }
          ]
        },
        {
          name: 'amount',
          type: 'FLOAT',
          nulls: 0,
          nullFraction: 0,
          distinct: 50,
          distinctFraction: 0.5,
          min: 1,
          max: 99,
          avg: 42.5,
          stddev: 10,
          zeros: 3,
          zeroFraction: 0.03,
          negatives: 4,
          negativeFraction: 0.04,
          infinite: 1,
          infiniteFraction: 0.01,
          topValues: [{ value: 42, count: 20 }]
        }
      ],
      skipped: ['address']
    };
  }

  // Generate Statistics runs a server-side per-column profile and shows it in a
  // Statistics tab that appears only after the explicit (billable) action.
  it('generates a per-column statistics profile on demand', async () => {
    mockedApi.tableStats.mockResolvedValue(statsFixture());
    renderDetails();
    // No Statistics tab until it is requested.
    expect(
      screen.queryByRole('button', { name: 'Statistics' })
    ).not.toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate Statistics' })
    );
    // The profile renders in a new Statistics tab (42.5 is the avg cell).
    expect(await screen.findByText('42.5')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Statistics' })
    ).toBeInTheDocument();
    expect(screen.getByText(/Not profiled/)).toHaveTextContent('address');
    // Default request does not compute top values.
    expect(mockedApi.tableStats).toHaveBeenCalledWith(
      'proj',
      'ds',
      'events',
      0
    );
  });

  // The "Show top values" toggle re-requests with a top-N and renders the
  // per-column value-distribution charts.
  it('shows top values when the toggle is enabled', async () => {
    mockedApi.tableStats.mockResolvedValue(statsFixture());
    renderDetails();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate Statistics' })
    );
    await screen.findByText('42.5');
    // Value labels are hidden until the toggle is on.
    expect(screen.queryByText('alice')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Show top values/));
    expect(await screen.findByText('alice')).toBeInTheDocument();
    await waitFor(() =>
      expect(mockedApi.tableStats).toHaveBeenCalledWith(
        'proj',
        'ds',
        'events',
        10
      )
    );
  });

  // CUJ-13: the Preview tab renders a typed row grid from previewTable.
  it('previews rows on the Preview tab', async () => {
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('NYC')).toBeInTheDocument();
    expect(mockedApi.previewTable).toHaveBeenCalledWith(
      'proj',
      'ds',
      'events',
      100,
      0
    );
  });

  // CUJ-16 (VIEW): no Preview tab; a note points at the Query tab, which shows
  // the view's SQL definition.
  it('hides Preview and shows the Query tab for a view', async () => {
    mockedApi.getTable.mockResolvedValue(
      meta({ type: 'VIEW', viewQuery: 'SELECT 1' })
    );
    renderDetails({ ...TABLE_REF, tableType: 'VIEW' });
    expect(await screen.findByText(/This is a view/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Query' }));
    expect(await screen.findByText('SELECT 1')).toBeInTheDocument();
  });

  // CUJ-16 (MODEL/EXTERNAL): no Preview tab, each with its own explanation.
  it('hides Preview with an explanation for a model', async () => {
    mockedApi.getTable.mockResolvedValue(meta({ type: 'MODEL' }));
    renderDetails({ ...TABLE_REF, tableType: 'MODEL' });
    expect(
      await screen.findByText(/Models have no row data/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview' })
    ).not.toBeInTheDocument();
  });

  it('hides Preview with an explanation for an external table', async () => {
    mockedApi.getTable.mockResolvedValue(meta({ type: 'EXTERNAL' }));
    renderDetails({ ...TABLE_REF, tableType: 'EXTERNAL' });
    expect(
      await screen.findByText(
        /External tables are backed by a federated source/
      )
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview' })
    ).not.toBeInTheDocument();
  });

  // The "Query table" action pre-fills a SELECT for the fully-qualified table.
  it('calls onQuery with a SELECT when "Query table" is clicked', async () => {
    const onQuery = jest.fn();
    renderDetails(TABLE_REF, onQuery);
    fireEvent.click(await screen.findByRole('button', { name: 'Query table' }));
    expect(onQuery).toHaveBeenCalledWith(
      'SELECT * FROM `proj.ds.events` LIMIT 1000'
    );
  });

  // CUJ-18: a metadata fetch failure renders inline, not a crash.
  it('surfaces a getTable error inline', async () => {
    mockedApi.getTable.mockRejectedValue(
      new Error('404 Not found: Table events')
    );
    renderDetails();
    expect(
      await screen.findByText(/404 Not found: Table events/)
    ).toBeInTheDocument();
  });
});
