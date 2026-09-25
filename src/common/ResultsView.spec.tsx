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
import { PagerBar, PAGE_SIZE_OPTIONS, ResultsGrid } from './ResultsView';
import { ISchemaField, PreviewCell } from '../explorer/api';

const COLUMNS: ISchemaField[] = [
  { name: 'word', type: 'STRING', fields: [] },
  { name: 'n', type: 'INTEGER', fields: [] }
];

function renderPager(
  overrides: Partial<React.ComponentProps<typeof PagerBar>> = {}
): { onPage: jest.Mock; onPageSize: jest.Mock } {
  const onPage = jest.fn();
  const onPageSize = jest.fn();
  render(
    <PagerBar
      page={0}
      pageSize={100}
      totalRows={250}
      rowsOnPage={100}
      busy={false}
      onPage={onPage}
      onPageSize={onPageSize}
      {...overrides}
    />
  );
  return { onPage, onPageSize };
}

describe('PagerBar', () => {
  it('shows the absolute row range for the current page', () => {
    renderPager({ page: 1, pageSize: 100, totalRows: 250, rowsOnPage: 100 });
    expect(screen.getByText('101\u2013200 of 250')).toBeInTheDocument();
  });

  it('shows "No rows" for an empty result', () => {
    renderPager({ totalRows: 0, rowsOnPage: 0 });
    expect(screen.getByText('No rows')).toBeInTheDocument();
  });

  it('disables First/Prev on the first page', () => {
    renderPager({ page: 0 });
    expect(screen.getByTitle('First page')).toBeDisabled();
    expect(screen.getByTitle('Previous page')).toBeDisabled();
    expect(screen.getByTitle('Next page')).not.toBeDisabled();
    expect(screen.getByTitle('Last page')).not.toBeDisabled();
  });

  it('disables Next/Last on the last page', () => {
    // 250 rows / 100 => 3 pages; page index 2 is last, with 50 rows.
    renderPager({ page: 2, pageSize: 100, totalRows: 250, rowsOnPage: 50 });
    expect(screen.getByTitle('Next page')).toBeDisabled();
    expect(screen.getByTitle('Last page')).toBeDisabled();
    expect(screen.getByTitle('First page')).not.toBeDisabled();
    expect(screen.getByTitle('Previous page')).not.toBeDisabled();
  });

  it('disables every control while busy', () => {
    renderPager({ page: 1, busy: true });
    for (const t of ['First page', 'Previous page', 'Next page', 'Last page']) {
      expect(screen.getByTitle(t)).toBeDisabled();
    }
  });

  it('routes first/prev/next/last to onPage with the right target', () => {
    // 500 rows / 100 => 5 pages; last index 4.
    const { onPage } = renderPager({
      page: 1,
      pageSize: 100,
      totalRows: 500,
      rowsOnPage: 100
    });
    fireEvent.click(screen.getByTitle('Next page'));
    fireEvent.click(screen.getByTitle('Previous page'));
    fireEvent.click(screen.getByTitle('First page'));
    fireEvent.click(screen.getByTitle('Last page'));
    expect(onPage.mock.calls.map(c => c[0])).toEqual([2, 0, 0, 4]);
  });

  it('offers the shared page sizes and reports a change', () => {
    const { onPageSize } = renderPager({});
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => o.value)).toEqual(
      PAGE_SIZE_OPTIONS.map(String)
    );
    fireEvent.change(select, { target: { value: '200' } });
    expect(onPageSize).toHaveBeenCalledWith(200);
  });

  it('falls back to a rows-full heuristic when totalRows is unknown', () => {
    renderPager({ page: 0, pageSize: 100, totalRows: null, rowsOnPage: 100 });
    // A full page suggests there may be a next page...
    expect(screen.getByTitle('Next page')).not.toBeDisabled();
    // ...but with no total we can't jump to the last page.
    expect(screen.getByTitle('Last page')).toBeDisabled();
  });
});

describe('ResultsGrid', () => {
  it('renders headers and row numbers offset by startIndex', () => {
    render(
      <ResultsGrid
        columns={COLUMNS}
        rows={[
          ['a', 1],
          ['b', 2]
        ]}
        startIndex={100}
      />
    );
    expect(screen.getByText('word')).toBeInTheDocument();
    expect(screen.getByText('n')).toBeInTheDocument();
    // startIndex 100 => first data row is #101.
    expect(screen.getByText('101')).toBeInTheDocument();
    expect(screen.getByText('102')).toBeInTheDocument();
  });

  it('formats null and object cells', () => {
    const rows: PreviewCell[][] = [[null, { x: 1 }]];
    render(<ResultsGrid columns={COLUMNS} rows={rows} startIndex={0} />);
    expect(screen.getByText('null')).toBeInTheDocument();
    expect(screen.getByText('{"x":1}')).toBeInTheDocument();
  });
});
