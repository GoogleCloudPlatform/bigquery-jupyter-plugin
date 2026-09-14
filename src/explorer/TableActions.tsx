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

export type OpenTable = (ref: ITableRef) => void;

const TableActionsContext = createContext<OpenTable>(() => undefined);

export function TableActionsProvider({
  open,
  children
}: {
  open: OpenTable;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <TableActionsContext.Provider value={open}>
      {children}
    </TableActionsContext.Provider>
  );
}

export function useOpenTable(): OpenTable {
  return useContext(TableActionsContext);
}
