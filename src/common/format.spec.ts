/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { formatCell, oneLine } from './format';

describe('formatCell', () => {
  it('renders null/undefined as the literal "null"', () => {
    expect(formatCell(null)).toBe('null');
    expect(formatCell(undefined as unknown as null)).toBe('null');
  });

  it('stringifies primitives, including falsy ones', () => {
    expect(formatCell(42)).toBe('42');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(false)).toBe('false');
    expect(formatCell('hi')).toBe('hi');
  });

  it('JSON-encodes objects and arrays (nested RECORD / REPEATED)', () => {
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
    expect(formatCell([1, 2])).toBe('[1,2]');
  });
});

describe('oneLine', () => {
  it('returns "(no SQL)" for empty input', () => {
    expect(oneLine(null)).toBe('(no SQL)');
    expect(oneLine('')).toBe('(no SQL)');
  });

  it('collapses newlines/whitespace to single spaces (formatted query)', () => {
    expect(oneLine('SELECT\n  *\nFROM\n  t')).toBe('SELECT * FROM t');
  });

  it('trims surrounding whitespace', () => {
    expect(oneLine('   SELECT 1   ')).toBe('SELECT 1');
  });

  it('truncates with an ellipsis past maxLen', () => {
    const out = oneLine('x'.repeat(200), 10);
    expect(out).toBe(`${'x'.repeat(10)}\u2026`);
    expect(out.length).toBe(11);
  });

  it('leaves short lines unchanged', () => {
    expect(oneLine('SELECT 1', 10)).toBe('SELECT 1');
  });
});
