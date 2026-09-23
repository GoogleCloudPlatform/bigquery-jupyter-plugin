/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { requestAPI } from '../handler';

export interface IConfig {
  principal: string | null;
  project: string | null;
  credential_type?: string;
}

export interface IDataset {
  id: string;
  projectId: string;
  friendlyName?: string | null;
}

export interface ITable {
  id: string;
  type: string;
  partitioned?: boolean;
  clustered?: boolean;
}

export interface IDatasetPage {
  datasets: IDataset[];
  nextPageToken?: string | null;
}

export interface ITablePage {
  tables: ITable[];
  nextPageToken?: string | null;
}

export interface ISchemaField {
  name: string;
  type: string;
  mode?: string | null;
  description?: string | null;
  fields: ISchemaField[];
}

export interface ITimePartitioning {
  type?: string | null;
  field?: string | null;
  expirationMs?: number | null;
  requirePartitionFilter?: boolean | null;
}

export interface ITableMeta {
  id: string;
  projectId: string;
  datasetId: string;
  type: string;
  schema: ISchemaField[];
  numRows?: number | null;
  sizeBytes?: number | null;
  location?: string | null;
  description?: string | null;
  friendlyName?: string | null;
  created?: string | null;
  modified?: string | null;
  expires?: string | null;
  timePartitioning?: ITimePartitioning | null;
  clusteringFields?: string[] | null;
  viewQuery?: string | null;
}

export type PreviewCell = string | number | boolean | null | object;

export interface IPreviewPage {
  schema: ISchemaField[];
  rows: PreviewCell[][];
  totalRows: number;
}

export function getConfig(): Promise<IConfig> {
  return requestAPI<IConfig>('config');
}

export interface IResolvedProject {
  projectId: string | null;
  projectNumber?: string | null;
  name?: string | null;
}

// Resolve a project id OR number to its canonical id (so a number typed into
// "Add project" becomes the readable id in the tree).
export function resolveProject(project: string): Promise<IResolvedProject> {
  return requestAPI(`resolveProject?project=${encodeURIComponent(project)}`);
}

export function listDatasets(
  projectId: string,
  pageToken?: string
): Promise<IDatasetPage> {
  const t = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
  return requestAPI(`datasets?project_id=${encodeURIComponent(projectId)}${t}`);
}

export function listTables(
  projectId: string,
  datasetId: string,
  pageToken?: string
): Promise<ITablePage> {
  const t = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
  return requestAPI(
    `tables?project_id=${encodeURIComponent(projectId)}&dataset_id=${encodeURIComponent(
      datasetId
    )}${t}`
  );
}

export function getTable(
  projectId: string,
  datasetId: string,
  tableId: string
): Promise<ITableMeta> {
  return requestAPI(
    `table?project_id=${encodeURIComponent(projectId)}&dataset_id=${encodeURIComponent(
      datasetId
    )}&table_id=${encodeURIComponent(tableId)}`
  );
}

export interface ITopValue {
  value: PreviewCell;
  count: number;
}

export interface IColumnStats {
  name: string;
  type: string;
  nulls: number;
  nullFraction: number | null;
  distinct: number;
  distinctFraction: number | null;
  min: PreviewCell;
  max: PreviewCell;
  avg: PreviewCell;
  stddev: PreviewCell;
  zeros: number | null;
  zeroFraction: number | null;
  negatives: number | null;
  negativeFraction: number | null;
  infinite: number | null;
  infiniteFraction: number | null;
  topValues: ITopValue[];
}

export interface ITableStats {
  totalRows: number | null;
  bytesProcessed?: number | null;
  columns: IColumnStats[];
  skipped: string[];
}

// Compute a per-column statistics profile. This runs a scanning query on the
// server, so it is billable and only invoked on explicit user action. Passing
// `topValues > 0` adds an approximate top-N value/count list per column for a
// value-distribution chart (still one query).
export function tableStats(
  projectId: string,
  datasetId: string,
  tableId: string,
  topValues = 0
): Promise<ITableStats> {
  const top = topValues ? `&topValues=${topValues}` : '';
  return requestAPI(
    `tableStats?project_id=${encodeURIComponent(projectId)}&dataset_id=${encodeURIComponent(
      datasetId
    )}&table_id=${encodeURIComponent(tableId)}${top}`
  );
}

export function previewTable(
  projectId: string,
  datasetId: string,
  tableId: string,
  maxResults: number,
  startIndex: number
): Promise<IPreviewPage> {
  return requestAPI(
    `preview?project_id=${encodeURIComponent(projectId)}&dataset_id=${encodeURIComponent(
      datasetId
    )}&table_id=${encodeURIComponent(
      tableId
    )}&maxResults=${maxResults}&startIndex=${startIndex}`
  );
}

export interface IDryRun {
  totalBytesProcessed?: number | null;
  cacheHit?: boolean | null;
  statementType?: string | null;
}

export interface IQueryJob {
  jobId: string;
  projectId: string;
  location: string | null;
  state: string;
}

export interface IQueryStats {
  totalBytesProcessed?: number | null;
  totalBytesBilled?: number | null;
  cacheHit?: boolean | null;
  statementType?: string | null;
  slotMillis?: number | null;
}

export interface IQueryResults {
  state: string;
  schema: ISchemaField[];
  rows: PreviewCell[][];
  totalRows: number | null;
  startIndex?: number;
  stats?: IQueryStats | null;
}

export function dryRun(query: string, projectId?: string): Promise<IDryRun> {
  return requestAPI('dryRun', {
    method: 'POST',
    body: JSON.stringify({ query, projectId })
  });
}

export function executeQuery(
  query: string,
  projectId?: string,
  location?: string
): Promise<IQueryJob> {
  return requestAPI('query', {
    method: 'POST',
    body: JSON.stringify({ query, projectId, location })
  });
}

export function getQueryResults(
  jobId: string,
  projectId: string | null,
  location: string | null,
  startIndex: number,
  maxResults: number
): Promise<IQueryResults> {
  const params = new URLSearchParams({
    jobId,
    maxResults: String(maxResults),
    startIndex: String(startIndex)
  });
  if (projectId) {
    params.set('projectId', projectId);
  }
  if (location) {
    params.set('location', location);
  }
  return requestAPI(`queryResults?${params.toString()}`);
}

export function cancelQuery(
  jobId: string,
  projectId: string | null,
  location: string | null
): Promise<{ jobId: string; state: string }> {
  return requestAPI('cancelQuery', {
    method: 'POST',
    body: JSON.stringify({ jobId, projectId, location })
  });
}

export interface IQueryHistoryJob {
  jobId: string;
  projectId: string;
  location: string | null;
  state: string;
  query: string | null;
  statementType: string | null;
  created: string | null;
  started: string | null;
  ended: string | null;
  totalBytesProcessed: number | null;
  totalBytesBilled: number | null;
  cacheHit: boolean | null;
  errored: boolean;
  errorMessage: string | null;
  userEmail: string | null;
}

export interface IQueryHistoryPage {
  jobs: IQueryHistoryJob[];
  nextPageToken?: string | null;
}

export function listQueryHistory(
  projectId?: string,
  maxResults = 50,
  pageToken?: string | null
): Promise<IQueryHistoryPage> {
  const params = new URLSearchParams({ maxResults: String(maxResults) });
  if (projectId) {
    params.set('project_id', projectId);
  }
  if (pageToken) {
    params.set('pageToken', pageToken);
  }
  return requestAPI(`queryHistory?${params.toString()}`);
}

export interface ISearchResult {
  projectId: string;
  datasetId: string;
  tableId: string | null;
  type: string;
}

export interface ISearchPage {
  results: ISearchResult[];
  partial: boolean;
}

export interface IServiceStatus {
  enabled: boolean;
  state?: string | null;
}

export function searchTables(
  projectId: string,
  term: string,
  projects: string[]
): Promise<ISearchPage> {
  const params = new URLSearchParams({ project_id: projectId, term });
  if (projects.length) {
    params.set('projects', projects.join(','));
  }
  return requestAPI(`searchTables?${params.toString()}`);
}

export function dataplexStatus(projectId: string): Promise<IServiceStatus> {
  return requestAPI(
    `dataplexStatus?project_id=${encodeURIComponent(projectId)}`
  );
}

export function enableDataplex(
  projectId: string
): Promise<{ requested: boolean; done: boolean }> {
  return requestAPI('enableDataplex', {
    method: 'POST',
    body: JSON.stringify({ projectId })
  });
}

export function bigqueryStatus(projectId: string): Promise<IServiceStatus> {
  return requestAPI(
    `bigqueryStatus?project_id=${encodeURIComponent(projectId)}`
  );
}

export function enableBigquery(
  projectId: string
): Promise<{ requested: boolean; done: boolean }> {
  return requestAPI('enableBigquery', {
    method: 'POST',
    body: JSON.stringify({ projectId })
  });
}
