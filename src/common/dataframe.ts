/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

// Escape a string for embedding inside a Python single-quoted literal.
function pyStr(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

// Generate a self-contained Python snippet that runs the SQL and returns the
// results as a pandas DataFrame, using the same google-cloud-bigquery client the
// plugin's backend uses. The SQL goes in a triple-double-quoted string (its
// backslashes and any embedded `"""` are escaped so the snippet stays valid).
// An empty `project` yields `bigquery.Client()`, which bills to the notebook's
// default project -- the correct choice for public datasets you cannot bill to.
export function dataframeCode(sql: string, project: string): string {
  const escapedSql = sql.replace(/\\/g, '\\\\').replace(/"""/g, '\\"\\"\\"');
  const clientArgs = project ? `project=${pyStr(project)}` : '';
  return [
    '# Run the query and load the results into a pandas DataFrame.',
    'from google.cloud import bigquery',
    '',
    `client = bigquery.Client(${clientArgs})`,
    'df = client.query(',
    `    """${escapedSql}"""`,
    ').to_dataframe()',
    'df'
  ].join('\n');
}
