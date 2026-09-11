/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { useEffect, useState } from 'react';
import { Clipboard, Notification } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import {
  getConfig,
  IDatasetPage,
  ITablePage,
  listDatasets,
  listTables
} from './api';
import { MenuProvider, useMenu } from './ContextMenu';
import { OpenTable, TableActionsProvider, useOpenTable } from './TableActions';

// While a dataset filter is active we auto-load pages so the filter is
// comprehensive; cap it so a project with a huge number of datasets can't
// trigger unbounded fetching.
const AUTO_LOAD_PAGE_CAP = 20;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAddedProjects(
  settings: ISettingRegistry.ISettings | null
): string[] {
  const value = settings?.composite.addedProjects;
  return Array.isArray(value) ? (value as string[]) : [];
}

function matches(name: string, filter: string): boolean {
  return name.toLowerCase().includes(filter.toLowerCase());
}

function copyId(id: string): void {
  Clipboard.copyToSystem(id);
  Notification.success(`Copied: ${id}`, { autoClose: 2000 });
}

const Caret = ({ open }: { open: boolean }): JSX.Element => (
  <span className="bq-caret">{open ? '\u25be' : '\u25b8'}</span>
);

function TableNode({
  projectId,
  datasetId,
  table
}: {
  projectId: string;
  datasetId: string;
  table: { id: string; type: string };
}): JSX.Element {
  const openMenu = useMenu();
  const openTable = useOpenTable();
  const fqId = `${projectId}.${datasetId}.${table.id}`;
  const open = (): void =>
    openTable({
      projectId,
      datasetId,
      tableId: table.id,
      tableType: table.type
    });
  return (
    <li
      className="bq-node bq-leaf"
      title="Double-click to open details"
      onDoubleClick={open}
      onContextMenu={e =>
        openMenu(e, [
          { label: 'Open details', onClick: open },
          { label: 'Copy table ID', onClick: () => copyId(fqId) }
        ])
      }
    >
      <span className="bq-label">{table.id}</span>
      <span className="bq-badge">{table.type.toLowerCase()}</span>
    </li>
  );
}

function LoadMore({
  onClick,
  loading
}: {
  onClick: () => void;
  loading: boolean;
}): JSX.Element {
  return (
    <li className="bq-more" onClick={onClick}>
      {loading ? 'Loading more…' : 'Load more…'}
    </li>
  );
}

function DatasetNode({
  projectId,
  datasetId
}: {
  projectId: string;
  datasetId: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const openMenu = useMenu();
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['tables', projectId, datasetId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listTables(projectId, datasetId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: ITablePage) => last.nextPageToken ?? undefined,
    enabled: open
  });
  const tables = q.data ? q.data.pages.flatMap(p => p.tables) : [];
  return (
    <li className="bq-node">
      <div
        className="bq-row"
        onClick={() => setOpen(o => !o)}
        onContextMenu={e =>
          openMenu(e, [
            {
              label: 'Copy dataset ID',
              onClick: () => copyId(`${projectId}.${datasetId}`)
            },
            {
              label: 'Refresh dataset',
              onClick: () =>
                queryClient.invalidateQueries({
                  queryKey: ['tables', projectId, datasetId]
                })
            }
          ])
        }
      >
        <Caret open={open} />
        <span className="bq-label">{datasetId}</span>
      </div>
      {open && (
        <ul className="bq-children">
          {q.isLoading && <li className="bq-info">Loading…</li>}
          {q.isError && <li className="bq-error">{errorMessage(q.error)}</li>}
          {q.data && tables.length === 0 && (
            <li className="bq-info">No tables</li>
          )}
          {tables.map(t => (
            <TableNode
              key={t.id}
              projectId={projectId}
              datasetId={datasetId}
              table={t}
            />
          ))}
          {q.hasNextPage && (
            <LoadMore
              onClick={() => q.fetchNextPage()}
              loading={q.isFetchingNextPage}
            />
          )}
        </ul>
      )}
    </li>
  );
}

function ProjectNode({
  projectId,
  defaultOpen,
  filter,
  onRemove
}: {
  projectId: string;
  defaultOpen?: boolean;
  filter: string;
  onRemove?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const openMenu = useMenu();
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['datasets', projectId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listDatasets(projectId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: IDatasetPage) => last.nextPageToken ?? undefined,
    enabled: open
  });
  const pageCount = q.data ? q.data.pages.length : 0;

  // Auto-load remaining pages while filtering so the dataset filter is
  // comprehensive (no manual "Load more" needed), up to a safety cap.
  useEffect(() => {
    if (
      open &&
      filter &&
      q.hasNextPage &&
      !q.isFetchingNextPage &&
      pageCount < AUTO_LOAD_PAGE_CAP
    ) {
      q.fetchNextPage();
    }
  }, [open, filter, q.hasNextPage, q.isFetchingNextPage, pageCount]);

  const allDatasets = q.data ? q.data.pages.flatMap(p => p.datasets) : [];
  const datasets = filter
    ? allDatasets.filter(d => matches(d.id, filter))
    : allDatasets;
  const autoLoading = Boolean(filter) && q.isFetchingNextPage;
  const cappedWhileFiltering =
    Boolean(filter) && q.hasNextPage && pageCount >= AUTO_LOAD_PAGE_CAP;

  const menuItems = [
    { label: 'Copy project ID', onClick: () => copyId(projectId) },
    {
      label: 'Refresh project',
      onClick: () =>
        queryClient.invalidateQueries({ queryKey: ['datasets', projectId] })
    }
  ];
  if (onRemove) {
    menuItems.push({ label: 'Remove project', onClick: onRemove });
  }
  return (
    <li className="bq-node">
      <div
        className="bq-row bq-project"
        onClick={() => setOpen(o => !o)}
        onContextMenu={e => openMenu(e, menuItems)}
      >
        <Caret open={open} />
        <span className="bq-label">{projectId}</span>
        {onRemove && (
          <button
            className="bq-remove"
            title="Remove project"
            onClick={e => {
              e.stopPropagation();
              onRemove();
            }}
          >
            {'\u00d7'}
          </button>
        )}
      </div>
      {open && (
        <ul className="bq-children">
          {q.isLoading && <li className="bq-info">Loading…</li>}
          {q.isError && <li className="bq-error">{errorMessage(q.error)}</li>}
          {q.data && allDatasets.length === 0 && (
            <li className="bq-info">No datasets</li>
          )}
          {datasets.map(d => (
            <DatasetNode key={d.id} projectId={projectId} datasetId={d.id} />
          ))}
          {autoLoading && <li className="bq-info">Filtering…</li>}
          {Boolean(filter) &&
            !autoLoading &&
            allDatasets.length > 0 &&
            datasets.length === 0 && (
              <li className="bq-info">No matching datasets</li>
            )}
          {cappedWhileFiltering && (
            <li className="bq-info">Refine filter to load more…</li>
          )}
          {!filter && q.hasNextPage && (
            <LoadMore
              onClick={() => q.fetchNextPage()}
              loading={q.isFetchingNextPage}
            />
          )}
        </ul>
      )}
    </li>
  );
}

function ExplorerTreeInner({
  settings
}: {
  settings: ISettingRegistry.ISettings | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const cfg = useQuery({ queryKey: ['config'], queryFn: getConfig });
  const [added, setAdded] = useState<string[]>(() =>
    readAddedProjects(settings)
  );
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (!settings) {
      return;
    }
    const onChanged = (): void => setAdded(readAddedProjects(settings));
    settings.changed.connect(onChanged);
    return () => {
      settings.changed.disconnect(onChanged);
    };
  }, [settings]);

  const persist = (next: string[]): void => {
    setAdded(next);
    if (settings) {
      settings
        .set('addedProjects', next)
        .catch(error =>
          console.error(
            '[bigquery-jupyter-plugin] failed to save projects:',
            error
          )
        );
    }
  };

  const roots: string[] = [];
  if (cfg.data && cfg.data.project) {
    roots.push(cfg.data.project);
  }
  roots.push('bigquery-public-data');
  for (const p of added) {
    if (!roots.includes(p)) {
      roots.push(p);
    }
  }

  const onAdd = (e: React.FormEvent): void => {
    e.preventDefault();
    const v = input.trim();
    if (v && !roots.includes(v)) {
      persist([...added, v]);
    }
    setInput('');
  };

  return (
    <div className="bq-explorer">
      <div className="bq-header">
        <span className="bq-title">BigQuery</span>
        <button
          className="bq-icon-btn"
          title="Refresh all"
          onClick={() => queryClient.invalidateQueries()}
        >
          {'\u27f3'}
        </button>
      </div>
      <div className="bq-principal" title="Active identity">
        {cfg.data ? (cfg.data.principal ?? 'no identity') : '…'}
      </div>
      <form className="bq-add" onSubmit={onAdd}>
        <input
          className="bq-add-input"
          placeholder="Add project by ID"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
      </form>
      <div className="bq-filter">
        <input
          className="bq-add-input"
          placeholder="Filter datasets by name"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>
      <ul className="bq-tree">
        {roots.map((p, i) => (
          <ProjectNode
            key={p}
            projectId={p}
            defaultOpen={i === 0}
            filter={filter}
            onRemove={
              added.includes(p)
                ? () => persist(added.filter(x => x !== p))
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}

export function ExplorerTree({
  settings,
  onOpenTable
}: {
  settings: ISettingRegistry.ISettings | null;
  onOpenTable: OpenTable;
}): JSX.Element {
  return (
    <MenuProvider>
      <TableActionsProvider open={onOpenTable}>
        <ExplorerTreeInner settings={settings} />
      </TableActionsProvider>
    </MenuProvider>
  );
}
