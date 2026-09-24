/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  getTable,
  ISchemaField,
  ITableMeta,
  ITopValue,
  PreviewCell,
  previewTable,
  tableStats
} from '../explorer/api';
import { ITableRef } from '../explorer/TableActions';
import { PagerBar, ResultsGrid } from '../common/ResultsView';

const PREVIEW_PAGE_SIZE = 100;

// Row preview uses tabledata.list (free), which only reads types backed by
// BigQuery storage. Everything else (logical views, models, external/federated
// sources) has no stored rows to page through, so the Preview tab is hidden.
const PREVIEWABLE_TYPES = ['TABLE', 'MATERIALIZED_VIEW', 'SNAPSHOT'];

type Tab = 'details' | 'preview' | 'query' | 'stats';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canPreview(tableType: string): boolean {
  return PREVIEWABLE_TYPES.includes(tableType.toUpperCase());
}

// A short reason shown when Preview is unavailable, so the tab isn't just
// silently missing.
function noPreviewReason(tableType: string): string | null {
  switch (tableType.toUpperCase()) {
    case 'VIEW':
      return 'This is a view — see the Query tab for its SQL definition.';
    case 'MODEL':
      return 'Models have no row data to preview.';
    case 'EXTERNAL':
      return 'External tables are backed by a federated source, not BigQuery storage, so row preview is unavailable.';
    default:
      return null;
  }
}

function humanBytes(n?: number | null): string {
  if (n === null || n === undefined) {
    return '—';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function humanNumber(n?: number | null): string {
  return n === null || n === undefined ? '—' : n.toLocaleString();
}

function SchemaRows({
  fields,
  depth
}: {
  fields: ISchemaField[];
  depth: number;
}): JSX.Element {
  return (
    <>
      {fields.map((f, i) => (
        <React.Fragment key={`${depth}-${i}-${f.name}`}>
          <tr>
            <td style={{ paddingLeft: `${8 + depth * 16}px` }}>{f.name}</td>
            <td className="bq-dt-type">{f.type}</td>
            <td>{f.mode ?? 'NULLABLE'}</td>
            <td className="bq-dt-desc">{f.description ?? ''}</td>
          </tr>
          {f.fields && f.fields.length > 0 && (
            <SchemaRows fields={f.fields} depth={depth + 1} />
          )}
        </React.Fragment>
      ))}
    </>
  );
}

function SchemaTable({ meta }: { meta: ITableMeta }): JSX.Element {
  if (!meta.schema || meta.schema.length === 0) {
    return <div className="bq-dt-empty">No schema.</div>;
  }
  return (
    <table className="bq-dt-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Mode</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        <SchemaRows fields={meta.schema} depth={0} />
      </tbody>
    </table>
  );
}

// The Details tab combines the table's description, metadata ("Table info") and
// its schema in one scrollable view, mirroring the BigQuery console's table
// Details page rather than splitting schema into a separate tab.
function DetailsTab({ meta }: { meta: ITableMeta }): JSX.Element {
  const rows: [string, string][] = [
    ['Table ID', `${meta.projectId}.${meta.datasetId}.${meta.id}`],
    ['Type', meta.type],
    ['Rows', humanNumber(meta.numRows)],
    ['Size', humanBytes(meta.sizeBytes)],
    ['Location', meta.location ?? '—'],
    ['Created', meta.created ?? '—'],
    ['Last modified', meta.modified ?? '—'],
    ['Expires', meta.expires ?? '—']
  ];
  if (meta.timePartitioning) {
    const tp = meta.timePartitioning;
    rows.push([
      'Partitioned by',
      `${tp.type ?? ''}${tp.field ? ` on ${tp.field}` : ' (ingestion time)'}`
    ]);
    if (tp.requirePartitionFilter) {
      rows.push(['Requires partition filter', 'yes']);
    }
  }
  if (meta.clusteringFields && meta.clusteringFields.length > 0) {
    rows.push(['Clustered by', meta.clusteringFields.join(', ')]);
  }
  return (
    <div className="bq-dt-details">
      {meta.description && (
        <section className="bq-dt-section">
          <h3 className="bq-dt-section-title">Description</h3>
          <div className="bq-dt-description">{meta.description}</div>
        </section>
      )}
      <section className="bq-dt-section">
        <h3 className="bq-dt-section-title">Table info</h3>
        <table className="bq-dt-table bq-dt-meta">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td className="bq-dt-key">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="bq-dt-section">
        <h3 className="bq-dt-section-title">Schema</h3>
        <SchemaTable meta={meta} />
      </section>
    </div>
  );
}

function PreviewTab({ tref }: { tref: ITableRef }): JSX.Element {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(PREVIEW_PAGE_SIZE);
  // Random-access paging over tabledata.list (free): each page is a direct
  // fetch at startIndex = page * pageSize. keepPreviousData holds the current
  // page on screen while the next one loads, so the grid doesn't flash empty.
  const q = useQuery({
    queryKey: [
      'preview',
      tref.projectId,
      tref.datasetId,
      tref.tableId,
      page,
      pageSize
    ],
    queryFn: () =>
      previewTable(
        tref.projectId,
        tref.datasetId,
        tref.tableId,
        pageSize,
        page * pageSize
      ),
    placeholderData: keepPreviousData
  });

  if (q.isLoading && !q.data) {
    return <div className="bq-dt-empty">Loading preview…</div>;
  }
  if (q.isError) {
    return <div className="bq-dt-error">{errorMessage(q.error)}</div>;
  }
  const columns = q.data?.schema ?? [];
  const rows = q.data?.rows ?? [];
  const total = q.data?.totalRows ?? null;
  if (columns.length === 0) {
    return <div className="bq-dt-empty">No rows to display.</div>;
  }
  return (
    <div className="bq-dt-preview">
      <PagerBar
        page={page}
        pageSize={pageSize}
        totalRows={total}
        rowsOnPage={rows.length}
        busy={q.isFetching}
        onPage={setPage}
        onPageSize={s => {
          setPageSize(s);
          setPage(0);
        }}
      />
      <ResultsGrid columns={columns} rows={rows} startIndex={page * pageSize} />
    </div>
  );
}

function QueryTab({ meta }: { meta: ITableMeta }): JSX.Element {
  if (!meta.viewQuery) {
    return <div className="bq-dt-empty">No query definition.</div>;
  }
  return <pre className="bq-dt-query">{meta.viewQuery}</pre>;
}

function humanPercent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined) {
    return '—';
  }
  const pct = fraction * 100;
  // Keep small non-zero fractions visible instead of rounding them to 0.0%.
  const digits = pct > 0 && pct < 0.1 ? 2 : 1;
  return `${pct.toFixed(digits)}%`;
}

// Render a numeric/temporal stat cell. Numbers are locale-formatted (integers
// grouped, floats capped to a few decimals); everything else is shown as-is.
function statCell(value: PreviewCell): string {
  if (value === null || value === undefined) {
    return '—';
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString()
      : value.toLocaleString(undefined, { maximumFractionDigits: 4 });
  }
  return String(value);
}

// Render a "count (percent)" stat cell; "—" when the count is not applicable
// (e.g. numeric-only counts on a non-numeric column).
function countCell(
  count: number | null | undefined,
  fraction: number | null | undefined
): string {
  if (count === null || count === undefined) {
    return '—';
  }
  return `${humanNumber(count)} (${humanPercent(fraction ?? null)})`;
}

const TOP_N = 10;
const TOP_VALUES_HELP =
  `Adds each column's ${TOP_N} most frequent values as mini bar charts, ` +
  'estimated with APPROX_TOP_COUNT — a fast approximate count, not exact. ' +
  'Computed in the same single query (no extra table scan).';

// A compact horizontal bar chart of a column's most frequent values.
function TopValuesChart({ values }: { values: ITopValue[] }): JSX.Element {
  if (!values || values.length === 0) {
    return <div className="bq-dt-empty">No values.</div>;
  }
  const max = Math.max(...values.map(v => v.count), 1);
  return (
    <div className="bq-dt-topvals">
      {values.map((v, i) => {
        const label =
          v.value === null || v.value === undefined
            ? '(null)'
            : String(v.value);
        return (
          <div className="bq-dt-topval" key={`${i}-${label}`}>
            <span className="bq-dt-topval-label" title={label}>
              {label}
            </span>
            <span className="bq-dt-topval-bar">
              <span
                className="bq-dt-topval-fill"
                style={{ width: `${(v.count / max) * 100}%` }}
              />
            </span>
            <span className="bq-dt-topval-count">{humanNumber(v.count)}</span>
          </div>
        );
      })}
    </div>
  );
}

// On-demand per-column profile. Mounted only after the user clicks "Generate
// Statistics", so the (billable) query runs on that explicit action, not on
// opening the table. The "top values" toggle adds an approximate per-column
// value distribution (still one query, via APPROX_TOP_COUNT).
function StatisticsTab({ tref }: { tref: ITableRef }): JSX.Element {
  const [showTopValues, setShowTopValues] = useState(false);
  const q = useQuery({
    queryKey: [
      'tableStats',
      tref.projectId,
      tref.datasetId,
      tref.tableId,
      showTopValues
    ],
    queryFn: () =>
      tableStats(
        tref.projectId,
        tref.datasetId,
        tref.tableId,
        showTopValues ? TOP_N : 0
      ),
    placeholderData: keepPreviousData
  });
  if (q.isLoading && !q.data) {
    return (
      <div className="bq-dt-empty">
        Computing statistics… (this runs a query over the table)
      </div>
    );
  }
  if (q.isError) {
    return <div className="bq-dt-error">{errorMessage(q.error)}</div>;
  }
  const data = q.data;
  if (!data) {
    return <div className="bq-dt-empty">No statistics.</div>;
  }
  return (
    <div className="bq-dt-stats">
      <div className="bq-dt-stats-bar">
        <span className="bq-dt-stats-summary">
          {humanNumber(data.totalRows)} rows
          {data.bytesProcessed !== null &&
            data.bytesProcessed !== undefined &&
            ` · ${humanBytes(data.bytesProcessed)} processed`}
        </span>
        <label className="bq-dt-stats-toggle" title={TOP_VALUES_HELP}>
          <input
            type="checkbox"
            checked={showTopValues}
            onChange={e => setShowTopValues(e.target.checked)}
          />
          Show top values (approximate)
          {q.isFetching && showTopValues ? ' …' : ''}
          <span
            className="bq-dt-info"
            aria-hidden="true"
            title={TOP_VALUES_HELP}
          >
            {'\u24D8'}
          </span>
        </label>
      </div>
      {data.columns.length === 0 ? (
        <div className="bq-dt-empty">No scalar columns to profile.</div>
      ) : (
        <table className="bq-dt-table">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th>Nulls</th>
              <th>Distinct</th>
              <th>Min</th>
              <th>Max</th>
              <th>Avg</th>
              <th>Stddev</th>
              <th>Zeros</th>
              <th>Negatives</th>
              <th>Infinite</th>
            </tr>
          </thead>
          <tbody>
            {data.columns.map(c => (
              <tr key={c.name}>
                <td>{c.name}</td>
                <td className="bq-dt-type">{c.type}</td>
                <td>{countCell(c.nulls, c.nullFraction)}</td>
                <td>{countCell(c.distinct, c.distinctFraction)}</td>
                <td>{statCell(c.min)}</td>
                <td>{statCell(c.max)}</td>
                <td>{statCell(c.avg)}</td>
                <td>{statCell(c.stddev)}</td>
                <td>{countCell(c.zeros, c.zeroFraction)}</td>
                <td>{countCell(c.negatives, c.negativeFraction)}</td>
                <td>{countCell(c.infinite, c.infiniteFraction)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showTopValues && data.columns.length > 0 && (
        <div className="bq-dt-topgrid">
          {data.columns.map(c => (
            <div className="bq-dt-topcard" key={c.name}>
              <div className="bq-dt-topcard-title">{c.name}</div>
              <TopValuesChart values={c.topValues} />
            </div>
          ))}
        </div>
      )}
      {data.skipped.length > 0 && (
        <div className="bq-dt-stats-skipped">
          Not profiled (nested or repeated): {data.skipped.join(', ')}
        </div>
      )}
    </div>
  );
}

export function TableDetails({
  tref,
  onQuery
}: {
  tref: ITableRef;
  onQuery?: (sql: string) => void;
}): JSX.Element {
  const previewable = canPreview(tref.tableType);
  const isView = tref.tableType.toUpperCase() === 'VIEW';
  const reason = previewable ? null : noPreviewReason(tref.tableType);
  const [tab, setTab] = useState<Tab>('details');
  // The Statistics tab appears only once the user asks for it (the profile is a
  // billable query), and stays available afterwards.
  const [statsRequested, setStatsRequested] = useState(false);
  const meta = useQuery({
    queryKey: ['table', tref.projectId, tref.datasetId, tref.tableId],
    queryFn: () => getTable(tref.projectId, tref.datasetId, tref.tableId)
  });

  const tabs: [Tab, string][] = [['details', 'Details']];
  if (previewable) {
    tabs.push(['preview', 'Preview']);
  }
  if (isView) {
    tabs.push(['query', 'Query']);
  }
  if (statsRequested) {
    tabs.push(['stats', 'Statistics']);
  }

  const fqId = `${tref.projectId}.${tref.datasetId}.${tref.tableId}`;

  return (
    <div className="bq-dt">
      <div className="bq-dt-header">
        <div className="bq-dt-heading">{tref.tableId}</div>
        <div className="bq-dt-fqid">
          {tref.projectId}.{tref.datasetId}
        </div>
        <div className="bq-dt-actions">
          {onQuery && (
            <button
              className="bq-dt-action"
              title="Open a query editor for this table"
              onClick={() => onQuery(`SELECT * FROM \`${fqId}\` LIMIT 1000`)}
            >
              <svg
                className="bq-dt-action-icon"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6zM14.6 16.6 19.2 12l-4.6-4.6L16 6l6 6-6 6z" />
              </svg>
              Query table
            </button>
          )}
          <button
            className="bq-dt-action"
            title="Compute per-column statistics (runs a query over the table)"
            onClick={() => {
              setStatsRequested(true);
              setTab('stats');
            }}
          >
            <svg
              className="bq-dt-action-icon"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path d="M4 13h4v7H4zM10 4h4v16h-4zM16 9h4v11h-4z" />
            </svg>
            Generate Statistics
          </button>
        </div>
      </div>
      <div className="bq-dt-tabs">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={`bq-dt-tab${tab === id ? ' bq-dt-tab-active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {reason && <div className="bq-dt-note">{reason}</div>}
      <div className="bq-dt-body">
        {meta.isLoading && <div className="bq-dt-empty">Loading…</div>}
        {meta.isError && (
          <div className="bq-dt-error">{errorMessage(meta.error)}</div>
        )}
        {meta.data && tab === 'details' && <DetailsTab meta={meta.data} />}
        {tab === 'preview' && previewable && <PreviewTab tref={tref} />}
        {meta.data && tab === 'query' && <QueryTab meta={meta.data} />}
        {statsRequested && tab === 'stats' && <StatisticsTab tref={tref} />}
      </div>
    </div>
  );
}
