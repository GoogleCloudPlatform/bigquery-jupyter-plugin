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
