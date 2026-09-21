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
  useQueries,
  useQuery,
  useQueryClient
} from '@tanstack/react-query';
import {
  bigqueryStatus,
  dataplexStatus,
  enableBigquery,
  enableDataplex,
  getConfig,
  getTable,
  IDataset,
  IDatasetPage,
  ISchemaField,
  ISearchResult,
  ITablePage,
  listDatasets,
  listTables,
  searchTables
} from './api';
import { MenuProvider, useMenu } from './ContextMenu';
import {
  ITableActions,
  TableActionsProvider,
  useTableActions
} from './TableActions';
import {
  addIcon,
  columnIcon,
  datasetIcon,
  historyIcon,
  iconForTableType,
  projectIcon,
  queryIcon,
  searchClearIcon,
  searchIcon
} from '../icons';

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

// Render `text` with each (case-insensitive) occurrence of `term` wrapped in a
// highlight <mark>. Used to show what a search matched.
function Highlight({
  text,
  term
}: {
  text: string;
  term: string;
}): JSX.Element {
  if (!term) {
    return <>{text}</>;
  }
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const parts: JSX.Element[] = [];
  let i = 0;
  let key = 0;
  for (;;) {
    const idx = lowerText.indexOf(lowerTerm, i);
    if (idx === -1) {
      parts.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (idx > i) {
      parts.push(<span key={key++}>{text.slice(i, idx)}</span>);
    }
    parts.push(
      <mark key={key++} className="bq-hl">
        {text.slice(idx, idx + term.length)}
      </mark>
    );
    i = idx + term.length;
  }
  return <>{parts}</>;
}

function ColumnNode({ field }: { field: ISchemaField }): JSX.Element {
  const openMenu = useMenu();
  return (
    <li
      className="bq-node bq-leaf bq-column"
      onContextMenu={e =>
        openMenu(e, [
          { label: 'Copy column name', onClick: () => copyId(field.name) }
        ])
      }
    >
      <columnIcon.react
        tag="span"
        className="bq-type-icon"
        width="16px"
        height="16px"
      />
      <span className="bq-label">{field.name}</span>
      <span className="bq-badge">{field.type.toLowerCase()}</span>
    </li>
  );
}

function TableNode({
  projectId,
  datasetId,
  table,
  highlight
}: {
  projectId: string;
  datasetId: string;
  table: {
    id: string;
    type: string;
    partitioned?: boolean;
    clustered?: boolean;
  };
  highlight?: string;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const openMenu = useMenu();
  const actions = useTableActions();
  const fqId = `${projectId}.${datasetId}.${table.id}`;
  const openDetails = (): void =>
    actions.openDetails({
      projectId,
      datasetId,
      tableId: table.id,
      tableType: table.type
    });
  const queryTable = (): void =>
    actions.openQuery(`SELECT * FROM \`${fqId}\` LIMIT 1000`);
  const q = useQuery({
    queryKey: ['table', projectId, datasetId, table.id],
    queryFn: () => getTable(projectId, datasetId, table.id),
    enabled: open
  });
  const fields = q.data ? q.data.schema : [];
  const typeIcon = iconForTableType(table.type);
  return (
    <li className="bq-node">
      <div
        className="bq-row"
        title="Click to expand columns; double-click to open details"
        onClick={() => setOpen(o => !o)}
        onDoubleClick={openDetails}
        onContextMenu={e =>
          openMenu(e, [
            { label: 'Open details', onClick: openDetails },
            { label: 'Query table', onClick: queryTable },
            { label: 'Copy table ID', onClick: () => copyId(fqId) }
          ])
        }
      >
        <Caret open={open} />
        <typeIcon.react
          tag="span"
          className="bq-type-icon"
          width="16px"
          height="16px"
        />
        <span className="bq-label">
          <Highlight text={table.id} term={highlight ?? ''} />
        </span>
        <span className="bq-badge">
          {table.type.toLowerCase().replace(/_/g, ' ')}
        </span>
        {table.partitioned && (
          <span className="bq-badge bq-badge-attr" title="Partitioned">
            partitioned
          </span>
        )}
        {table.clustered && (
          <span className="bq-badge bq-badge-attr" title="Clustered">
            clustered
          </span>
        )}
      </div>
      {open && (
        <ul className="bq-children">
          {q.isLoading && <li className="bq-info">Loading…</li>}
          {q.isError && <li className="bq-error">{errorMessage(q.error)}</li>}
          {q.data && fields.length === 0 && (
            <li className="bq-info">No columns</li>
          )}
          {fields.map((f, i) => (
            <ColumnNode key={`${f.name}-${i}`} field={f} />
          ))}
        </ul>
      )}
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
  datasetId,
  highlight
}: {
  projectId: string;
  datasetId: string;
  highlight?: string;
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
        <datasetIcon.react
          tag="span"
          className="bq-type-icon"
          width="16px"
          height="16px"
        />
        <span className="bq-label">
          <Highlight text={datasetId} term={highlight ?? ''} />
        </span>
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
  onRemove,
  principal
}: {
  projectId: string;
  defaultOpen?: boolean;
  filter: string;
  onRemove?: () => void;
  principal?: string | null;
}): JSX.Element {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const filtering = Boolean(filter);
  const openMenu = useMenu();
  const queryClient = useQueryClient();
  const q = useInfiniteQuery({
    queryKey: ['datasets', projectId],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      listDatasets(projectId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: IDatasetPage) => last.nextPageToken ?? undefined,
    // While a filter is active, load every project (even collapsed ones) so a
    // matching dataset nested under an unexpanded project is still surfaced.
    enabled: open || filtering
  });
  const pageCount = q.data ? q.data.pages.length : 0;

  // Auto-load remaining pages while filtering so the dataset filter is
  // comprehensive (no manual "Load more" needed), up to a safety cap.
  useEffect(() => {
    if (
      filtering &&
      q.hasNextPage &&
      !q.isFetchingNextPage &&
      pageCount < AUTO_LOAD_PAGE_CAP
    ) {
      q.fetchNextPage();
    }
  }, [filtering, q.hasNextPage, q.isFetchingNextPage, pageCount]);

  const allDatasets = q.data ? q.data.pages.flatMap(p => p.datasets) : [];
  const datasets = filter
    ? allDatasets.filter(d => matches(d.id, filter))
    : allDatasets;
  const hasMatches = datasets.length > 0;
  // Unnest: when filtering, auto-expand a project iff it has a matching dataset
  // (projects with no match stay visually collapsed).
  const showChildren = open || (filtering && hasMatches);
  const autoLoading = filtering && q.isFetchingNextPage;
  const cappedWhileFiltering =
    filtering && q.hasNextPage && pageCount >= AUTO_LOAD_PAGE_CAP;

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
        <Caret open={showChildren} />
        <projectIcon.react
          tag="span"
          className="bq-type-icon"
          width="16px"
          height="16px"
        />
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
      {showChildren && (
        <ul className="bq-children">
          {open && q.isLoading && <li className="bq-info">Loading…</li>}
          {open && q.isError && (
            <li className="bq-error">{errorMessage(q.error)}</li>
          )}
          {open && !filtering && q.data && allDatasets.length === 0 && (
            <li className="bq-info bq-empty">
              <div>No datasets.</div>
              <div className="bq-empty-hint">
                If you expected datasets here,{' '}
                <code>{principal ?? 'the active identity'}</code> may not have
                permission to list them in <code>{projectId}</code>. Grant{' '}
                <code>roles/bigquery.dataViewer</code> on the project, e.g.{' '}
                <code>
                  gcloud projects add-iam-policy-binding {projectId}{' '}
                  --member=&quot;user-or-serviceAccount:
                  {principal ?? '…'}&quot; --role=roles/bigquery.dataViewer
                </code>
                .
              </div>
            </li>
          )}
          {datasets.map(d => (
            <DatasetNode key={d.id} projectId={projectId} datasetId={d.id} />
          ))}
          {open && autoLoading && <li className="bq-info">Filtering…</li>}
          {open &&
            filtering &&
            !autoLoading &&
            allDatasets.length > 0 &&
            !hasMatches && <li className="bq-info">No matching datasets</li>}
          {open && cappedWhileFiltering && (
            <li className="bq-info">Refine filter to load more…</li>
          )}
          {!filtering && q.hasNextPage && (
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

// Table search kicks in at this term length (debounced); shorter terms keep the
// instant client-side dataset-name filter.
const SEARCH_MIN_CHARS = 3;
const SEARCH_DEBOUNCE_MS = 500;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(handle);
  }, [value, ms]);
  return debounced;
}

// Cross-dataset name search combines two sources, because each entity type has
// a different authoritative catalog:
//   * Datasets come from the BigQuery datasets.list API (the same source the
//     browse tree uses), so dataset-name search is complete and consistent with
//     browse — even for huge projects like bigquery-public-data.
//   * Tables come from the Dataplex Universal Catalog (searchEntries), the only
//     cheap way to match table names across many datasets. Dataplex only indexes
//     a subset of very large public projects, so table results are best-effort
//     (hence the caveat) and gated on the Dataplex API being enabled.
function SearchResults({
  billingProject,
  roots,
  term
}: {
  billingProject: string | null;
  roots: string[];
  term: string;
}): JSX.Element {
  return (
    <div className="bq-search-results">
      <DatasetSearchSection roots={roots} term={term} />
      <TableSearchSection
        billingProject={billingProject}
        roots={roots}
        term={term}
      />
    </div>
  );
}

// One root project's dataset-name matches, rendered as browsable dataset nodes.
// Renders nothing when the project has no match, so only projects with hits show.
function DatasetSearchProject({
  projectId,
  term,
  datasets
}: {
  projectId: string;
  term: string;
  datasets: IDataset[];
}): JSX.Element | null {
  const openMenu = useMenu();
  const queryClient = useQueryClient();
  const matched = datasets.filter(d => matches(d.id, term));
  if (matched.length === 0) {
    return null;
  }
  const menuItems = [
    { label: 'Copy project ID', onClick: () => copyId(projectId) },
    {
      label: 'Refresh project',
      onClick: () => {
        queryClient.invalidateQueries({ queryKey: ['allDatasets', projectId] });
        queryClient.invalidateQueries({ queryKey: ['datasets', projectId] });
      }
    }
  ];
  return (
    <li className="bq-node">
      <div
        className="bq-row bq-project"
        onContextMenu={e => openMenu(e, menuItems)}
      >
        <projectIcon.react
          tag="span"
          className="bq-type-icon"
          width="16px"
          height="16px"
        />
        <span className="bq-label">{projectId}</span>
      </div>
      <ul className="bq-children">
        {matched.map(d => (
          <DatasetNode
            key={d.id}
            projectId={projectId}
            datasetId={d.id}
            highlight={term}
          />
        ))}
      </ul>
    </li>
  );
}

// "Datasets" section: authoritative dataset-name matches across all roots, from
// datasets.list (auto-paged up to a cap) filtered client-side by name.
function DatasetSearchSection({
  roots,
  term
}: {
  roots: string[];
  term: string;
}): JSX.Element {
  const queries = useQueries({
    queries: roots.map(project => ({
      queryKey: ['allDatasets', project],
      queryFn: async (): Promise<IDataset[]> => {
        const out: IDataset[] = [];
        let token: string | undefined = undefined;
        for (let i = 0; i < AUTO_LOAD_PAGE_CAP; i++) {
          const page: IDatasetPage = await listDatasets(project, token);
          out.push(...page.datasets);
          token = page.nextPageToken ?? undefined;
          if (!token) {
            break;
          }
        }
        return out;
      },
      staleTime: 5 * 60 * 1000
    }))
  });
  const loading = queries.some(q => q.isLoading);
  const firstError = queries.find(q => q.isError)?.error;
  const totalMatches = roots.reduce((n, _project, i) => {
    const data = queries[i].data ?? [];
    return n + data.filter(d => matches(d.id, term)).length;
  }, 0);
  return (
    <div className="bq-search-section">
      <div className="bq-search-section-label">Datasets</div>
      <ul className="bq-tree">
        {loading && totalMatches === 0 && (
          <li className="bq-info">Searching datasets…</li>
        )}
        {firstError && <li className="bq-error">{errorMessage(firstError)}</li>}
        {!loading && !firstError && totalMatches === 0 && (
          <li className="bq-info">No datasets match “{term}”.</li>
        )}
        {roots.map((project, i) => (
          <DatasetSearchProject
            key={project}
            projectId={project}
            term={term}
            datasets={queries[i].data ?? []}
          />
        ))}
      </ul>
    </div>
  );
}

// "Tables" section: best-effort table-name matches from the Dataplex catalog,
// gated on the Dataplex API being enabled. Dataset-name matches are handled by
// the authoritative Datasets section above, so Dataplex dataset hits are dropped.
function TableSearchSection({
  billingProject,
  roots,
  term
}: {
  billingProject: string | null;
  roots: string[];
  term: string;
}): JSX.Element {
  const queryClient = useQueryClient();
  const openMenu = useMenu();
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState('');

  const statusQ = useQuery({
    queryKey: ['dataplexStatus', billingProject],
    queryFn: () => dataplexStatus(billingProject as string),
    enabled: !!billingProject
  });
  const enabled = statusQ.data?.enabled === true;

  const searchQ = useQuery({
    queryKey: ['searchTables', billingProject, term, roots],
    queryFn: () => searchTables(billingProject as string, term, roots),
    enabled: !!billingProject && enabled
  });

  const onEnable = async (): Promise<void> => {
    if (!billingProject) {
      return;
    }
    setEnabling(true);
    setEnableError('');
    try {
      await enableDataplex(billingProject);
      await queryClient.invalidateQueries({
        queryKey: ['dataplexStatus', billingProject]
      });
    } catch (error) {
      setEnableError(errorMessage(error));
    } finally {
      setEnabling(false);
    }
  };

  // Keep table hits only; dataset-name matches come from the Datasets section.
  const tableHits = (searchQ.data?.results ?? []).filter(r => r.tableId);
  const byProject = new Map<string, Map<string, ISearchResult[]>>();
  for (const r of tableHits) {
    let datasets = byProject.get(r.projectId);
    if (!datasets) {
      datasets = new Map();
      byProject.set(r.projectId, datasets);
    }
    const list = datasets.get(r.datasetId) ?? [];
    list.push(r);
    datasets.set(r.datasetId, list);
  }

  let body: JSX.Element;
  if (!billingProject) {
    body = (
      <ul className="bq-tree">
        <li className="bq-info">
          No default project — table search unavailable.
        </li>
      </ul>
    );
  } else if (statusQ.isLoading) {
    body = (
      <ul className="bq-tree">
        <li className="bq-info">Checking Dataplex…</li>
      </ul>
    );
  } else if (statusQ.isError) {
    body = (
      <ul className="bq-tree">
        <li className="bq-error">{errorMessage(statusQ.error)}</li>
      </ul>
    );
  } else if (!enabled) {
    body = (
      <div className="bq-search-enable">
        <p className="bq-search-note">
          Table search uses the Dataplex Universal Catalog. Enable the Dataplex
          API on <code>{billingProject}</code> to search tables across datasets.
        </p>
        <button
          className="bq-enable-btn"
          onClick={() => void onEnable()}
          disabled={enabling}
        >
          {enabling ? 'Enabling…' : 'Enable Dataplex API'}
        </button>
        {enableError && <p className="bq-search-error">{enableError}</p>}
      </div>
    );
  } else if (searchQ.isLoading) {
    body = (
      <ul className="bq-tree">
        <li className="bq-info">Searching tables…</li>
      </ul>
    );
  } else if (searchQ.isError) {
    body = (
      <ul className="bq-tree">
        <li className="bq-error">{errorMessage(searchQ.error)}</li>
      </ul>
    );
  } else {
    body = (
      <ul className="bq-tree">
        {tableHits.length === 0 && (
          <li className="bq-info">No tables match “{term}”.</li>
        )}
        {Array.from(byProject.entries()).map(([proj, datasets]) => (
          <li className="bq-node" key={proj}>
            <div
              className="bq-row bq-project"
              onContextMenu={e =>
                openMenu(e, [
                  { label: 'Copy project ID', onClick: () => copyId(proj) },
                  {
                    label: 'Refresh project',
                    onClick: () => {
                      queryClient.invalidateQueries({
                        queryKey: ['searchTables']
                      });
                      queryClient.invalidateQueries({
                        queryKey: ['allDatasets', proj]
                      });
                      queryClient.invalidateQueries({
                        queryKey: ['datasets', proj]
                      });
                      queryClient.invalidateQueries({
                        queryKey: ['tables', proj]
                      });
                    }
                  }
                ])
              }
            >
              <projectIcon.react
                tag="span"
                className="bq-type-icon"
                width="16px"
                height="16px"
              />
              <span className="bq-label">{proj}</span>
            </div>
            <ul className="bq-children">
              {Array.from(datasets.entries()).map(([datasetId, tables]) => (
                <li className="bq-node" key={datasetId}>
                  <div className="bq-row">
                    <datasetIcon.react
                      tag="span"
                      className="bq-type-icon"
                      width="16px"
                      height="16px"
                    />
                    <span className="bq-label">{datasetId}</span>
                  </div>
                  <ul className="bq-children">
                    {tables.map(t => (
                      <TableNode
                        key={t.tableId as string}
                        projectId={t.projectId}
                        datasetId={t.datasetId}
                        table={{ id: t.tableId as string, type: t.type }}
                        highlight={term}
                      />
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
        {searchQ.data?.partial && (
          <li className="bq-info">Partial results — refine your search.</li>
        )}
      </ul>
    );
  }

  return (
    <div className="bq-search-section">
      <div className="bq-search-section-label">Tables</div>
      {enabled && (
        <p className="bq-search-caveat">
          Table results come from the Dataplex catalog, which may not include
          every table in large public projects.
        </p>
      )}
      {body}
    </div>
  );
}

// A banner shown at the top of the explorer only when the BigQuery API is
// positively known to be disabled on the billing project (browse/query would
// otherwise fail with raw errors). Offers a one-click enable. Fails open: shows
// nothing while the status is loading, errored, or enabled.
function BigQueryApiNotice({
  billingProject
}: {
  billingProject: string | null;
}): JSX.Element | null {
  const queryClient = useQueryClient();
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState('');
  const statusQ = useQuery({
    queryKey: ['bigqueryStatus', billingProject],
    queryFn: () => bigqueryStatus(billingProject as string),
    enabled: !!billingProject
  });
  if (!billingProject || statusQ.data?.enabled !== false) {
    return null;
  }
  const onEnable = async (): Promise<void> => {
    setEnabling(true);
    setEnableError('');
    try {
      await enableBigquery(billingProject);
      await queryClient.invalidateQueries({
        queryKey: ['bigqueryStatus', billingProject]
      });
      // Datasets/tables likely failed while the API was off; refetch them.
      await queryClient.invalidateQueries({ queryKey: ['datasets'] });
    } catch (error) {
      setEnableError(errorMessage(error));
    } finally {
      setEnabling(false);
    }
  };
  return (
    <div className="bq-api-notice">
      <p className="bq-search-note">
        The BigQuery API is not enabled on <code>{billingProject}</code>. Enable
        it to browse datasets and run queries.
      </p>
      <button
        className="bq-enable-btn"
        onClick={() => void onEnable()}
        disabled={enabling}
      >
        {enabling ? 'Enabling…' : 'Enable the BigQuery API'}
      </button>
      {enableError && <p className="bq-search-error">{enableError}</p>}
    </div>
  );
}

function ExplorerTreeInner({
  settings
}: {
  settings: ISettingRegistry.ISettings | null;
}): JSX.Element {
  const queryClient = useQueryClient();
  const actions = useTableActions();
  const cfg = useQuery({ queryKey: ['config'], queryFn: getConfig });
  const [added, setAdded] = useState<string[]>(() =>
    readAddedProjects(settings)
  );
  const [input, setInput] = useState('');
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebounced(filter, SEARCH_DEBOUNCE_MS);
  const searchMode = debouncedFilter.trim().length >= SEARCH_MIN_CHARS;

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
        <span className="bq-title">Dataset explorer</span>
        <span className="bq-header-actions">
          <button
            className="bq-icon-btn"
            title="Open query editor"
            aria-label="Open query editor"
            onClick={() => actions.openQuery('')}
          >
            <queryIcon.react tag="span" width="18px" height="18px" />
          </button>
          <button
            className="bq-icon-btn"
            title="Query history"
            aria-label="Query history"
            onClick={() => actions.openHistory()}
          >
            <historyIcon.react tag="span" width="18px" height="18px" />
          </button>
          <button
            className="bq-icon-btn"
            title="Refresh all"
            aria-label="Refresh all"
            onClick={() => queryClient.invalidateQueries()}
          >
            {'\u27f3'}
          </button>
        </span>
      </div>
      <div className="bq-principal" title="Active identity">
        {cfg.data ? (cfg.data.principal ?? 'no identity') : '…'}
      </div>
      <BigQueryApiNotice billingProject={cfg.data?.project ?? null} />
      <form className="bq-add" onSubmit={onAdd}>
        <input
          className="bq-add-input"
          type="text"
          placeholder="Add project by ID"
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <button
          className="bq-add-btn"
          type="submit"
          title="Add project"
          aria-label="Add project"
          disabled={!input.trim()}
        >
          <addIcon.react tag="span" width="18px" height="18px" />
        </button>
      </form>
      <div className="bq-search">
        <searchIcon.react
          tag="span"
          className="bq-search-icon"
          width="18px"
          height="18px"
        />
        <input
          className="bq-search-input"
          type="text"
          placeholder="Search tables & datasets (3+ chars)"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && (
          <button
            className="bq-search-clear"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setFilter('')}
          >
            <searchClearIcon.react tag="span" width="16px" height="16px" />
          </button>
        )}
      </div>
      {searchMode ? (
        <SearchResults
          billingProject={cfg.data?.project ?? null}
          roots={roots}
          term={debouncedFilter.trim()}
        />
      ) : (
        <ul className="bq-tree">
          {roots.map((p, i) => (
            <ProjectNode
              key={p}
              projectId={p}
              defaultOpen={i === 0}
              filter={filter}
              principal={cfg.data?.principal ?? null}
              onRemove={
                added.includes(p)
                  ? () => persist(added.filter(x => x !== p))
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export function ExplorerTree({
  settings,
  actions
}: {
  settings: ISettingRegistry.ISettings | null;
  actions: ITableActions;
}): JSX.Element {
  return (
    <MenuProvider>
      <TableActionsProvider actions={actions}>
        <ExplorerTreeInner settings={settings} />
      </TableActionsProvider>
    </MenuProvider>
  );
}
