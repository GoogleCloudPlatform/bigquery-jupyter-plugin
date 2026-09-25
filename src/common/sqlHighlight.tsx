/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React from 'react';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { BIGQUERY_SQL } from './sqlDialect';

// Highlight SQL for read-only display (the query-history code block) using the
// *same* CodeMirror grammar the live query editor uses, so tokenization matches
// the editor exactly. `classHighlighter` emits stable `tok-*` class names, which
// style/base.css maps to JupyterLab's `--jp-mirror-editor-*` theme colors — the
// same variables the editor's highlight style uses, so colors match too.
//
// Returns one array of React nodes per source line, for the line-numbered <ol>.
export function highlightSqlLines(code: string): React.ReactNode[][] {
  const lines: React.ReactNode[][] = [[]];
  let key = 0;

  // Append `text` (which may contain newlines) to the current line, splitting
  // into new lines on '\n', wrapping in a <span> when a highlight class applies.
  const emit = (text: string, cls: string | null): void => {
    const parts = text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        lines.push([]);
      }
      if (!part) {
        return;
      }
      const cur = lines[lines.length - 1];
      cur.push(
        cls ? (
          <span key={key++} className={cls}>
            {part}
          </span>
        ) : (
          part
        )
      );
    });
  };

  let tree;
  try {
    tree = BIGQUERY_SQL.language.parser.parse(code);
  } catch {
    // Parser failure: degrade to plain, line-split text rather than throwing.
    return code.split('\n').map(line => (line ? [line] : []));
  }

  let pos = 0;
  // highlightTree only reports styled ranges; fill the gaps with plain text.
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > pos) {
      emit(code.slice(pos, from), null);
    }
    emit(code.slice(from, to), classes);
    pos = to;
  });
  if (pos < code.length) {
    emit(code.slice(pos), null);
  }
  return lines;
}
