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
