/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  getTable,
  IPreviewPage,
  ISchemaField,
  ITableMeta,
  PreviewCell,
  previewTable
} from '../explorer/api';
import { ITableRef } from '../explorer/TableActions';

const PREVIEW_PAGE_SIZE = 100;

// Row preview uses tabledata.list (free), which only reads types backed by
// BigQuery storage. Everything else (logical views, models, external/federated
// sources) has no stored rows to page through, so the Preview tab is hidden.
const PREVIEWABLE_TYPES = ['TABLE', 'MATERIALIZED_VIEW', 'SNAPSHOT'];

type Tab = 'schema' | 'details' | 'preview' | 'query';

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

function formatCell(value: PreviewCell): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
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

function SchemaTab({ meta }: { meta: ITableMeta }): JSX.Element {
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
  if (meta.description) {
    rows.push(['Description', meta.description]);
  }
  return (
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
  );
}

function PreviewTab({ tref }: { tref: ITableRef }): JSX.Element {
  const q = useInfiniteQuery({
    queryKey: ['preview', tref.projectId, tref.datasetId, tref.tableId],
    queryFn: ({ pageParam }: { pageParam: number }) =>
      previewTable(
        tref.projectId,
        tref.datasetId,
        tref.tableId,
        PREVIEW_PAGE_SIZE,
        pageParam
      ),
    initialPageParam: 0,
    getNextPageParam: (last: IPreviewPage, all: IPreviewPage[]) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.totalRows ? loaded : undefined;
    }
  });

  if (q.isLoading) {
    return <div className="bq-dt-empty">Loading preview…</div>;
  }
  if (q.isError) {
    return <div className="bq-dt-error">{errorMessage(q.error)}</div>;
  }
  const pages = q.data ? q.data.pages : [];
  const columns = pages.length > 0 ? pages[0].schema : [];
  const rows = pages.flatMap(p => p.rows);
  const total = pages.length > 0 ? pages[0].totalRows : 0;
  if (rows.length === 0) {
    return <div className="bq-dt-empty">No rows to display.</div>;
  }
  return (
    <div className="bq-dt-preview">
      <div className="bq-dt-preview-info">
        Showing {rows.length.toLocaleString()} of {total.toLocaleString()} rows
      </div>
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
                <td className="bq-dt-rownum">{r + 1}</td>
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
      {q.hasNextPage && (
        <button
          className="bq-dt-more"
          onClick={() => q.fetchNextPage()}
          disabled={q.isFetchingNextPage}
        >
          {q.isFetchingNextPage ? 'Loading more…' : 'Load more'}
        </button>
      )}
    </div>
  );
}

function QueryTab({ meta }: { meta: ITableMeta }): JSX.Element {
  if (!meta.viewQuery) {
    return <div className="bq-dt-empty">No query definition.</div>;
  }
  return <pre className="bq-dt-query">{meta.viewQuery}</pre>;
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
  const [tab, setTab] = useState<Tab>('schema');
  const meta = useQuery({
    queryKey: ['table', tref.projectId, tref.datasetId, tref.tableId],
    queryFn: () => getTable(tref.projectId, tref.datasetId, tref.tableId)
  });

  const tabs: [Tab, string][] = [
    ['schema', 'Schema'],
    ['details', 'Details']
  ];
  if (previewable) {
    tabs.push(['preview', 'Preview']);
  }
  if (isView) {
    tabs.push(['query', 'Query']);
  }

  const fqId = `${tref.projectId}.${tref.datasetId}.${tref.tableId}`;

  return (
    <div className="bq-dt">
      <div className="bq-dt-header">
        <div className="bq-dt-title">
          {tref.projectId}.{tref.datasetId}.<b>{tref.tableId}</b>
        </div>
        {onQuery && (
          <button
            className="bq-dt-query-btn"
            title="Open a query editor for this table"
            onClick={() => onQuery(`SELECT * FROM \`${fqId}\` LIMIT 1000`)}
          >
            Query table
          </button>
        )}
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
        {meta.data && tab === 'schema' && <SchemaTab meta={meta.data} />}
        {meta.data && tab === 'details' && <DetailsTab meta={meta.data} />}
        {tab === 'preview' && previewable && <PreviewTab tref={tref} />}
        {meta.data && tab === 'query' && <QueryTab meta={meta.data} />}
      </div>
    </div>
  );
}
