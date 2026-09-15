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
import { QueryEditor } from './QueryEditor';

export class QueryEditorWidget extends ReactWidget {
  private _sql: string;
  private _projects: string[];
  private _defaultProject: string | null;
  private _saveTimer: number | null = null;

  /** Set by the extension so edits can be persisted for layout restoration. */
  saveState: (() => void) | null = null;

  constructor(
    initialQuery = '',
    projects: string[] = [],
    defaultProject: string | null = null
  ) {
    super();
    this._sql = initialQuery;
    this._projects = projects;
    this._defaultProject = defaultProject;
    this.addClass('bq-qe-widget');
  }

  /** The current SQL text (for layout restoration). */
  get sql(): string {
    return this._sql;
  }

  private _onSqlChange = (sql: string): void => {
    this._sql = sql;
    if (this._saveTimer !== null) {
      window.clearTimeout(this._saveTimer);
    }
    this._saveTimer = window.setTimeout(() => {
      this._saveTimer = null;
      this.saveState?.();
    }, 800);
  };

  render(): JSX.Element {
    return (
      <QueryEditor
        initialQuery={this._sql}
        projects={this._projects}
        defaultProject={this._defaultProject}
        onSqlChange={this._onSqlChange}
      />
    );
  }
}
