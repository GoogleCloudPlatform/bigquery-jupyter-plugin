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
