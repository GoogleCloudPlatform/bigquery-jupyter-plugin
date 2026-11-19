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
import { requestAPI } from '../handler';
import { resetTelemetry } from '../common/telemetry';

jest.mock('../explorer/api');
jest.mock('../handler');
const mockedApi = api as jest.Mocked<typeof api>;
const mockedRequest = requestAPI as jest.MockedFunction<typeof requestAPI>;

function events(): any[] {
  return mockedRequest.mock.calls
    .filter(([endpoint, init]) => endpoint === 'telemetry' && init?.method)
    .map(([, init]) => JSON.parse(init?.body as string).event);
}

const TABLE_MARKER = 'MARKER_TABLE_7a1e';

function renderDetails(): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <TableDetails
        tref={{
          projectId: 'proj',
          datasetId: 'ds',
          tableId: TABLE_MARKER,
          tableType: 'TABLE'
        }}
        billingProject="bill-proj"
      />
    </QueryClientProvider>
  );
}

function stats(overrides: Partial<api.ITableStats> = {}): api.ITableStats {
  return {
    totalRows: 3,
    bytesProcessed: 4096,
    skipped: [],
    columns: [
      {
        name: 'user_id',
        type: 'STRING',
        nulls: 0,
        nullFraction: 0,
        distinct: 3,
        distinctFraction: 1,
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
        topValues: []
      }
    ],
    ...overrides
  };
}

beforeEach(() => {
  jest.resetAllMocks();
  resetTelemetry();
  mockedRequest.mockImplementation(
    async (_e, init) => (init?.method ? '' : { enabled: true }) as any
  );
  mockedApi.getTable.mockResolvedValue({
    id: TABLE_MARKER,
    projectId: 'proj',
    datasetId: 'ds',
    type: 'TABLE',
    schema: [{ name: 'user_id', type: 'STRING', mode: 'NULLABLE', fields: [] }]
  });
  mockedApi.previewTable.mockResolvedValue({
    schema: [{ name: 'user_id', type: 'STRING', fields: [] }],
    rows: [['u1']],
    totalRows: 1
  });
});

describe('TableDetails telemetry', () => {
  it('records GENERATE_STATS and a TABLE_STATS job', async () => {
    mockedApi.tableStats.mockResolvedValue(stats());
    renderDetails();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate Statistics' })
    );
    await waitFor(() => expect(events()).toHaveLength(2));
    expect(events()[0]).toEqual({
      bigquery_feature_use: { feature: 'GENERATE_STATS' }
    });
    expect(events()[1]).toEqual({
      bigquery_job: {
        surface: 'TABLE_STATS',
        outcome: 'SUCCEEDED',
        statement_kind: 'SELECT',
        processed_bytes: 4096,
        duration_ms: expect.any(Number)
      }
    });
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain(
      TABLE_MARKER
    );
  });

  it('records a FAILED job with a reason when statistics fail', async () => {
    mockedApi.tableStats.mockRejectedValue(
      Object.assign(new Error(`no access to ${TABLE_MARKER}`), {
        response: { status: 403 }
      })
    );
    renderDetails();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate Statistics' })
    );
    await waitFor(() => expect(events()).toHaveLength(2));
    expect(events()[1]).toEqual({
      bigquery_job: {
        surface: 'TABLE_STATS',
        outcome: 'FAILED',
        failure_reason: 'ACCESS_DENIED',
        statement_kind: 'SELECT',
        duration_ms: expect.any(Number)
      }
    });
    expect(JSON.stringify(mockedRequest.mock.calls)).not.toContain(
      TABLE_MARKER
    );
  });

  it('records no job when the server skipped the query', async () => {
    mockedApi.tableStats.mockResolvedValue(
      stats({ columns: [], bytesProcessed: 0 })
    );
    renderDetails();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Generate Statistics' })
    );
    await waitFor(() => expect(mockedApi.tableStats).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 30));
    expect(events().map(e => Object.keys(e)[0])).toEqual([
      'bigquery_feature_use'
    ]);
  });

  it('records TABLE_PREVIEW once, not per page', async () => {
    mockedApi.previewTable.mockResolvedValue({
      schema: [{ name: 'user_id', type: 'STRING', fields: [] }],
      rows: [['u1']],
      totalRows: 250
    });
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByText('u1');
    await waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toEqual({
      bigquery_feature_use: { feature: 'TABLE_PREVIEW' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() =>
      expect(mockedApi.previewTable).toHaveBeenLastCalledWith(
        'proj',
        'ds',
        TABLE_MARKER,
        100,
        100
      )
    );
    await new Promise(r => setTimeout(r, 30));
    expect(events()).toHaveLength(1);
  });

  it('does not record TABLE_PREVIEW when the preview fails', async () => {
    mockedApi.previewTable.mockRejectedValue(new Error('boom'));
    renderDetails();
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    await screen.findByText('boom');
    await new Promise(r => setTimeout(r, 30));
    expect(events()).toEqual([]);
  });
});
