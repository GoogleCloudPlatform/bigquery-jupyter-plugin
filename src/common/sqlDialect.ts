/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { SQLDialect } from '@codemirror/lang-sql';

// BigQuery SQL dialect: StandardSQL keywords/types, but with backtick-quoted
// identifiers so a fully-qualified `project.dataset.table` is one identifier
// token (StandardSQL would otherwise lex the words inside the backticks and
// mis-highlight ones like `public` as keywords). Also enables BigQuery's
// `#` line comments, double-quoted strings, and backslash escapes.
//
// Shared by the query editor (live CodeMirror) and the query-history static
// highlighter so both tokenize identically.
export const BIGQUERY_SQL = SQLDialect.define({
  identifierQuotes: '`',
  doubleQuotedStrings: true,
  hashComments: true,
  backslashEscapes: true
});
