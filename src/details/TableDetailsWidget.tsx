/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { ReactWidget } from '@jupyterlab/apputils';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ITableRef } from '../explorer/TableActions';
import { TableDetails } from './TableDetails';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } }
});

export class TableDetailsWidget extends ReactWidget {
  private _tref: ITableRef;

  constructor(tref: ITableRef) {
    super();
    this._tref = tref;
    this.addClass('bq-details-widget');
  }

  render(): JSX.Element {
    return (
      <QueryClientProvider client={queryClient}>
        <TableDetails tref={this._tref} />
      </QueryClientProvider>
    );
  }
}
