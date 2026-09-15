/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { ReactWidget } from '@jupyterlab/apputils';
import { Message } from '@lumino/messaging';
import React from 'react';
import { QueryHistory } from './QueryHistory';

export class QueryHistoryWidget extends ReactWidget {
  private _projects: string[];
  private _defaultProject: string | null;
  private _openQuery: (sql: string) => void;
  private _reload: (() => void) | null = null;
  private _shownOnce = false;

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

  // Re-fetch whenever the panel becomes visible again (e.g. the user switches
  // back to this tab after running a query), so newly-run jobs show up without a
  // manual refresh. The initial show is skipped -- the component loads on mount.
  protected onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    if (this._shownOnce) {
      this._reload?.();
    }
    this._shownOnce = true;
  }

  render(): JSX.Element {
    return (
      <QueryHistory
        projects={this._projects}
        defaultProject={this._defaultProject}
        openQuery={this._openQuery}
        registerReload={fn => {
          this._reload = fn;
        }}
      />
    );
  }
}
