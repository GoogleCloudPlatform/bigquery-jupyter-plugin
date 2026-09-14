/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { LabIcon } from '@jupyterlab/ui-components';

// Icons ported from the Dataproc Jupyter plugin. Paths carry the `jp-icon3`
// class so they follow the JupyterLab theme (with the original fill as a
// fallback), plus the explicit fill so the sidebar icon is never invisible.
function makeIcon(name: string, viewBox: string, body: string): LabIcon {
  return new LabIcon({
    name,
    svgstr: `<svg viewBox="${viewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`
  });
}

// Magnifying glass over bar plots — the "Dataset explorer" logo.
export const datasetExplorerIcon = makeIcon(
  'bigquery-jupyter-plugin:dataset-explorer',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#616161" fill-rule="evenodd" clip-rule="evenodd" d="M8.5 15C9.93884 15 11.2684 14.5326 12.3451 13.7414L15.2677 16.664L16.6819 15.2498L13.7566 12.3245C14.5386 11.2514 15 9.92963 15 8.5C15 4.90979 12.0902 2 8.5 2C4.90979 2 2 4.90979 2 8.5C2 12.0902 4.90979 15 8.5 15ZM13 8.5C13 10.9853 10.9853 13 8.5 13C6.01472 13 4 10.9853 4 8.5C4 6.01472 6.01472 4 8.5 4C10.9853 4 13 6.01472 13 8.5ZM11 10.9495C10.7129 11.2424 10.3748 11.4851 10 11.6632V9H11V10.9495ZM6 10.9495C6.28706 11.2424 6.6252 11.4851 7 11.6632V8H6V10.9495ZM8.5 12C8.66976 12 8.8367 11.9879 9 11.9646V7H8V11.9646C8.1633 11.9879 8.33024 12 8.5 12Z"/>'
);

// Project (interlocking hexagons).
export const projectIcon = makeIcon(
  'bigquery-jupyter-plugin:project',
  '0 0 22 22',
  '<path class="jp-icon3" fill="#444746" d="M2.875 22L2.98023e-08 17.05L2.875 12H8.6L11.5 17.05L8.625 22H2.875ZM2.875 10L2.98023e-08 5.05L2.875 -9.53674e-07H8.6L11.5 5.05L8.6 10H2.875ZM4.025 20H7.45L9.175 17.05L7.45 14H4.025L2.3 17.05L4.025 20ZM4.025 8H7.45L9.175 5.05L7.45 2H4.025L2.3 5.05L4.025 8ZM13.375 16L10.475 11.05L13.35 6H19.1L22 11.05L19.125 16H13.375ZM14.5 14H17.95L19.675 11.05L17.95 8H14.525L12.8 11.05L14.5 14Z"/>'
);

// Dataset (rounded square with a grid of cells).
export const datasetIcon = makeIcon(
  'bigquery-jupyter-plugin:dataset',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#444746" d="M4 14H8V10H4V14ZM10 14H14V10H10V14ZM4 8H8V4H4V8ZM10 8H14V4H10V8ZM2 18C1.45 18 0.975 17.8083 0.575 17.425C0.191667 17.025 0 16.55 0 16V2C0 1.45 0.191667 0.983333 0.575 0.599999C0.975 0.199999 1.45 -1.43051e-06 2 -1.43051e-06H16C16.55 -1.43051e-06 17.0167 0.199999 17.4 0.599999C17.8 0.983333 18 1.45 18 2V16C18 16.55 17.8 17.025 17.4 17.425C17.0167 17.8083 16.55 18 16 18H2ZM2 16H16V2H2V16Z"/>'
);

// Table (grid with a header row).
export const tableIcon = makeIcon(
  'bigquery-jupyter-plugin:table',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#616161" fill-rule="evenodd" clip-rule="evenodd" d="M16 2H2V16H16V2ZM6 8H4V10H6V8ZM4 4H14V6H4V4ZM6 12H4V14H6V12ZM8 8H10V10H8V8ZM14 8H12V10H14V8ZM8 12H10V14H8V12ZM14 12H12V14H14V12Z"/>'
);

// View (eye) — for views and other non-table entries.
export const viewIcon = makeIcon(
  'bigquery-jupyter-plugin:view',
  '0 0 24 24',
  '<path class="jp-icon3" fill="#616161" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>'
);

// Column (three vertical bars).
export const columnIcon = makeIcon(
  'bigquery-jupyter-plugin:column',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#616161" fill-rule="evenodd" clip-rule="evenodd" d="M6.375 4.125H2.625V13.875H6.375V4.125ZM7.125 4.125H10.875V13.875H7.125V4.125ZM11.625 4.125H15.375V13.875H11.625V4.125Z"/>'
);

// Query editor: "SQL" inside code brackets, i.e. <SQL>. Sized to fill most of
// the icon box (bold + stretched to width) so it stays legible at small sizes.
export const queryIcon = makeIcon(
  'bigquery-jupyter-plugin:query',
  '0 0 24 24',
  '<text x="12" y="16.2" text-anchor="middle" textLength="22" lengthAdjust="spacingAndGlyphs" font-family="sans-serif" font-weight="700" font-size="12" class="jp-icon3" fill="#616161">&lt;SQL&gt;</text>'
);

// Add (plus) — for the "Add project by ID" box.
export const addIcon = makeIcon(
  'bigquery-jupyter-plugin:add',
  '0 0 24 24',
  '<path class="jp-icon3" fill="#616161" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>'
);

// Search (magnifying glass) — for the search field prefix.
export const searchIcon = makeIcon(
  'bigquery-jupyter-plugin:search',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#616161" fill-rule="evenodd" clip-rule="evenodd" d="M9.76831 11.1645C8.97573 11.6924 8.02383 12 7 12C4.2383 12 2 9.7617 2 7C2 4.2383 4.2383 2 7 2C9.7617 2 12 4.2383 12 7C12 8.01451 11.698 8.95839 11.1789 9.74663L15.682 14.2497L14.2678 15.664L9.76831 11.1645ZM7 10C8.65685 10 10 8.65685 10 7C10 5.34315 8.65685 4 7 4C5.34315 4 4 5.34315 4 7C4 8.65685 5.34315 10 7 10Z"/>'
);

// Clear (X) — for the search field's clear button.
export const searchClearIcon = makeIcon(
  'bigquery-jupyter-plugin:search-clear',
  '0 0 18 18',
  '<path class="jp-icon3" fill="#616161" d="M3.4 16L2 14.6L7.6 9L2 3.4L3.4 2L9 7.6L14.6 2L16 3.4L10.4 9L16 14.6L14.6 16L9 10.4L3.4 16Z"/>'
);

// Pick the row icon for a table-list entry by its BigQuery type. Storage-backed
// tabular types keep the table icon; views and any other non-table type get the
// view icon.
export function iconForTableType(type: string): LabIcon {
  const t = (type || '').toUpperCase();
  if (t === 'TABLE' || t === 'EXTERNAL' || t === 'SNAPSHOT') {
    return tableIcon;
  }
  return viewIcon;
}
