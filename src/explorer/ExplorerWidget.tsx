/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { ReactWidget } from '@jupyterlab/apputils';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ExplorerTree } from './ExplorerTree';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
});

export class ExplorerWidget extends ReactWidget {
  private _settings: ISettingRegistry.ISettings | null;

  constructor(settings: ISettingRegistry.ISettings | null) {
    super();
    this._settings = settings;
    this.addClass('bq-explorer-widget');
  }

  render(): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <ExplorerTree settings={this._settings} />
      </QueryClientProvider>
    );
  }
}
