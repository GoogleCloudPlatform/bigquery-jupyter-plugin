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

export interface IQueryResults {
  state: string;
  schema: ISchemaField[];
  rows: PreviewCell[][];
  totalRows: number | null;
  nextPageToken?: string | null;
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
  pageToken: string | null,
  maxResults: number
): Promise<IQueryResults> {
  const params = new URLSearchParams({ jobId, maxResults: String(maxResults) });
  if (projectId) {
    params.set('projectId', projectId);
  }
  if (location) {
    params.set('location', location);
  }
  if (pageToken) {
    params.set('pageToken', pageToken);
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
