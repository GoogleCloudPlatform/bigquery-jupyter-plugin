/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import { Notification } from '@jupyterlab/apputils';
import { requestAPI } from './handler';

const PLUGIN_ID = 'bigquery-jupyter-plugin:plugin';

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'BigQuery JupyterLab 4 plugin',
  autoStart: true,
  activate: async (app: JupyterFrontEnd): Promise<void> => {
    console.log(`JupyterLab extension ${PLUGIN_ID} is activated.`);
    try {
      const reply = await requestAPI<string>('health');
      console.log(`[bigquery-jupyter-plugin] backend health: ${reply}`);
    } catch (error) {
      console.error(
        '[bigquery-jupyter-plugin] backend health check failed:',
        error
      );
      Notification.error('BigQuery plugin backend is unreachable.');
    }
  }
};

export default plugin;
