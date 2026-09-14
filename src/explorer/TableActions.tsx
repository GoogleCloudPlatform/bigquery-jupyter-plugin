/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, { createContext, useContext } from 'react';

export interface ITableRef {
  projectId: string;
  datasetId: string;
  tableId: string;
  tableType: string;
}

export interface ITableActions {
  openDetails: (ref: ITableRef) => void;
  openQuery: (sql: string) => void;
  openHistory: () => void;
}

const noop = (): void => undefined;

const TableActionsContext = createContext<ITableActions>({
  openDetails: noop,
  openQuery: noop,
  openHistory: noop
});

export function TableActionsProvider({
  actions,
  children
}: {
  actions: ITableActions;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <TableActionsContext.Provider value={actions}>
      {children}
    </TableActionsContext.Provider>
  );
}

export function useTableActions(): ITableActions {
  return useContext(TableActionsContext);
}
