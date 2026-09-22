/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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
  // CUJ-10 / CUJ-11: Schema tab is active by default and renders nested
  // RECORD fields (indented child rows).
  it('renders the schema with nested RECORD fields by default', async () => {
    renderDetails();
    expect(await screen.findByText('user_id')).toBeInTheDocument();
    expect(screen.getByText('address')).toBeInTheDocument();
    // The nested subfield proves SchemaRows recursed into the RECORD.
    expect(screen.getByText('city')).toBeInTheDocument();
    // REPEATED mode is surfaced (only the address column is repeated).
    expect(screen.getByText('REPEATED')).toBeInTheDocument();
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
