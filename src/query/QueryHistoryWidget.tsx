/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { ReactWidget } from '@jupyterlab/apputils';
import React from 'react';
import { QueryHistory } from './QueryHistory';

export class QueryHistoryWidget extends ReactWidget {
  private _projects: string[];
  private _defaultProject: string | null;
  private _openQuery: (sql: string) => void;

  constructor(
    projects: string[],
    defaultProject: string | null,
    openQuery: (sql: string) => void
  ) {
    super();
    this._projects = projects;
    this._defaultProject = defaultProject;
    this._openQuery = openQuery;
    this.addClass('bq-qh-widget');
  }

  render(): JSX.Element {
    return (
      <QueryHistory
        projects={this._projects}
        defaultProject={this._defaultProject}
        openQuery={this._openQuery}
      />
    );
  }
}
