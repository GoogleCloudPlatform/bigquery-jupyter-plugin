/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { PreviewCell } from '../explorer/api';

// Render a typed cell as display text: null as literal "null", objects (nested
// RECORD / REPEATED) as JSON, everything else stringified.
export function formatCell(value: PreviewCell): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

// Condense a (possibly multi-line, formatted) query to one readable line: trim,
// collapse every run of whitespace to a single space, and truncate. Empty input
// returns "(no SQL)". Used by the query-history row so a formatted query shows
// its first clause instead of just "SELECT".
export function oneLine(sql: string | null, maxLen = 120): string {
  if (!sql) {
    return '(no SQL)';
  }
  const line = sql.trim().replace(/\s+/g, ' ');
  return line.length > maxLen ? `${line.slice(0, maxLen)}\u2026` : line;
}
