/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import { expect, test } from '@jupyterlab/galata';

// These smoke tests deliberately avoid any real BigQuery access (no ADC needed):
// they check that the server extension is reachable, the frontend extension
// activates and registers its commands, and the Dataset explorer UI renders.

test('backend health endpoint is reachable', async ({ page }) => {
  const resp = await page.request.get(
    'http://localhost:8888/bigquery-jupyter-plugin/health'
  );
  expect(resp.ok()).toBeTruthy();
  expect((await resp.text()).trim()).toBe('ok');
});

test('frontend extension activates and registers its commands', async ({
  page
}) => {
  const commands = await page.evaluate(() => {
    const app = (window as any).jupyterapp;
    return {
      explorer: app.commands.hasCommand(
        'bigquery-jupyter-plugin:open-explorer'
      ),
      query: app.commands.hasCommand('bigquery-jupyter-plugin:new-query'),
      history: app.commands.hasCommand('bigquery-jupyter-plugin:query-history')
    };
  });
  expect(commands.explorer).toBe(true);
  expect(commands.query).toBe(true);
  expect(commands.history).toBe(true);
});

test('Dataset explorer sidebar opens and renders its header', async ({
  page
}) => {
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('bigquery-jupyter-plugin:open-explorer');
  });
  await expect(page.locator('.bq-title')).toHaveText('Dataset explorer');
  await expect(page.locator('.bq-search-input')).toBeVisible();
});

test('opening the query editor adds a "Query editor" tab', async ({ page }) => {
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('bigquery-jupyter-plugin:new-query');
  });
  await expect(page.getByRole('tab', { name: 'Query editor' })).toBeVisible();
});

// CUJ-44: the "Copy DataFrame code" button is wired end-to-end. It generates the
// snippet client-side (no BigQuery access needed), copies it, and shows a success
// notification. We open the editor pre-filled via the command's `sql` arg so the
// button is enabled without driving the CodeMirror editor.
test('Copy DataFrame code button copies a snippet and notifies', async ({
  page
}) => {
  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('bigquery-jupyter-plugin:new-query', {
      sql: 'SELECT 1'
    });
  });
  const editor = page.locator('.bq-qe');
  const button = editor.getByRole('button', { name: 'Copy DataFrame code' });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await button.click();
  // JupyterLab surfaces a success toast for the copy.
  await expect(page.getByText('Copied DataFrame code')).toBeVisible();
});

// CUJ-43: after a run, the editor shows an inline query-statistics line. The
// plugin's backend endpoints are mocked via route interception so the test needs
// no real BigQuery access, consistent with the rest of this smoke suite.
test('inline query statistics render after a run', async ({ page }) => {
  const MB = 1024 * 1024;
  // ServerConnection.makeRequest appends a cache-busting `?<nonce>` to every
  // request URL, so the route patterns must tolerate a trailing query string.
  // A plain glob like `.../query` misses `.../query?123` and the request falls
  // through to the real backend (which then fails on missing ADC in CI). The
  // `query` matcher is anchored with `(\?|$)` so it does not also swallow
  // `queryResults`/`queryHistory`.
  await page.route(/\/bigquery-jupyter-plugin\/dryRun(\?|$)/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        totalBytesProcessed: 1.3 * MB,
        cacheHit: false,
        statementType: 'SELECT'
      })
    })
  );
  await page.route(/\/bigquery-jupyter-plugin\/query(\?|$)/, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        jobId: 'job-e2e',
        projectId: 'p',
        location: 'US',
        state: 'RUNNING'
      })
    })
  );
  await page.route('**/bigquery-jupyter-plugin/queryResults**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        state: 'DONE',
        schema: [{ name: 'n', type: 'INTEGER', fields: [] }],
        rows: [[1]],
        totalRows: 1,
        startIndex: 0,
        stats: {
          totalBytesProcessed: 1.3 * MB,
          totalBytesBilled: 10 * MB,
          cacheHit: false,
          statementType: 'SELECT',
          slotMillis: 700
        }
      })
    })
  );

  await page.evaluate(async () => {
    const app = (window as any).jupyterapp;
    await app.commands.execute('bigquery-jupyter-plugin:new-query', {
      sql: 'SELECT 1'
    });
  });
  const editor = page.locator('.bq-qe');
  await editor.getByRole('button', { name: 'Run', exact: true }).click();

  const stats = editor.locator('.bq-qe-results-meta');
  await expect(stats).toBeVisible();
  await expect(stats).toContainText('Processed 1.3 MB');
  await expect(stats).toContainText('billed 10.0 MB');
  await expect(stats).toContainText('slot time 0.7s');
});
