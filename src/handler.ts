/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { URLExt } from '@jupyterlab/coreutils';
import { ServerConnection } from '@jupyterlab/services';

/**
 * A failed extension request. Extends ResponseError (which has the HTTP
 * status on `response`) with the API's short `reason` token, if the server
 * sent one (e.g. `quotaExceeded`).
 */
export class RequestError extends ServerConnection.ResponseError {
  reason?: string;
  // BigQuery's statement type of a query job that failed, when it parsed it.
  statementType?: string;
}

/**
 * Call the BigQuery Jupyter Plugin server extension.
 *
 * @param endPoint API REST end point for the extension
 * @param init Initial values for the request
 * @returns The response body interpreted as JSON (or text when not JSON)
 */
export async function requestAPI<T>(
  endPoint = '',
  init: RequestInit = {}
): Promise<T> {
  const settings = ServerConnection.makeSettings();
  const requestUrl = URLExt.join(
    settings.baseUrl,
    'bigquery-jupyter-plugin',
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(requestUrl, init, settings);
  } catch (error) {
    throw new ServerConnection.NetworkError(error as Error);
  }

  let data: any = await response.text();
  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch (error) {
      // Health endpoint returns plain text ("ok"); keep as-is.
    }
  }

  if (!response.ok) {
    let message = response.statusText;
    let reason: string | undefined;
    let statementType: string | undefined;
    if (data && typeof data === 'object') {
      message = data.error || data.message || message;
      if (typeof data.reason === 'string') {
        reason = data.reason;
      }
      if (typeof data.statementType === 'string') {
        statementType = data.statementType;
      }
    }
    const error = new RequestError(response, message);
    error.reason = reason;
    error.statementType = statementType;
    throw error;
  }

  return data;
}
