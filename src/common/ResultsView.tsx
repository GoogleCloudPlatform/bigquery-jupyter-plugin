/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import { ISchemaField, PreviewCell } from '../explorer/api';
import { formatCell } from './format';

// Shared page sizes for every result/preview grid.
export const PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500];

// A results grid: a leading "#" row-number column (offset by startIndex so
// numbers stay absolute across pages) then one column per schema field.
export function ResultsGrid({
  columns,
  rows,
  startIndex
}: {
  columns: ISchemaField[];
  rows: PreviewCell[][];
  startIndex: number;
}): JSX.Element {
  return (
    <div className="bq-dt-preview-scroll">
      <table className="bq-dt-table bq-dt-grid">
        <thead>
          <tr>
            <th className="bq-dt-rownum">#</th>
            {columns.map(c => (
              <th key={c.name}>{c.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              <td className="bq-dt-rownum">
                {(startIndex + r + 1).toLocaleString()}
              </td>
              {row.map((cell, c) => (
                <td
                  key={c}
                  className={cell === null ? 'bq-dt-null' : undefined}
                >
                  {formatCell(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// A pagination bar: "Rows X–Y of Z" plus a page-size selector and
// first/prev/next/last controls. Stateless — the parent owns page/pageSize and
// fetches on change. `totalRows` (the full result size) drives the page count
// and the last-page jump; when it is unknown we fall back to "there may be a
// next page if this one was full".
export function PagerBar({
  page,
  pageSize,
  totalRows,
  rowsOnPage,
  busy,
  onPage,
  onPageSize
}: {
  page: number;
  pageSize: number;
  totalRows: number | null;
  rowsOnPage: number;
  busy: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}): JSX.Element {
  const totalPages =
    totalRows !== null ? Math.max(1, Math.ceil(totalRows / pageSize)) : null;
  const lastPage = totalPages !== null ? totalPages - 1 : null;
  const hasNext =
    totalPages !== null ? page < totalPages - 1 : rowsOnPage === pageSize;
  const firstRow = page * pageSize + 1;
  const lastRow = page * pageSize + rowsOnPage;
  return (
    <div className="bq-dt-pager">
      <span className="bq-dt-pager-info">
        {totalRows === 0
          ? 'No rows'
          : `Rows ${firstRow.toLocaleString()}\u2013${lastRow.toLocaleString()}${
              totalRows !== null ? ` of ${totalRows.toLocaleString()}` : ''
            }`}
      </span>
      <span className="bq-dt-pager-controls">
        <label className="bq-dt-pager-size-label">
          Rows per page:
          <select
            className="bq-dt-pager-size"
            value={pageSize}
            disabled={busy}
            onChange={e => onPageSize(Number(e.target.value))}
          >
            {PAGE_SIZE_OPTIONS.map(n => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          className="bq-dt-pager-btn"
          title="First page"
          aria-label="First page"
          disabled={busy || page === 0}
          onClick={() => onPage(0)}
        >
          {'\u00ab'}
        </button>
        <button
          className="bq-dt-pager-btn"
          title="Previous page"
          aria-label="Previous page"
          disabled={busy || page === 0}
          onClick={() => onPage(page - 1)}
        >
          {'\u2039'}
        </button>
        <button
          className="bq-dt-pager-btn"
          title="Next page"
          aria-label="Next page"
          disabled={busy || !hasNext}
          onClick={() => onPage(page + 1)}
        >
          {'\u203a'}
        </button>
        <button
          className="bq-dt-pager-btn"
          title="Last page"
          aria-label="Last page"
          disabled={busy || !hasNext || lastPage === null}
          onClick={() => lastPage !== null && onPage(lastPage)}
        >
          {'\u00bb'}
        </button>
      </span>
    </div>
  );
}
