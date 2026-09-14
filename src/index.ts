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
import { ICommandPalette, Notification } from '@jupyterlab/apputils';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { requestAPI } from './handler';
import { ExplorerWidget } from './explorer/ExplorerWidget';
import { ITableRef } from './explorer/TableActions';
import { TableDetailsWidget } from './details/TableDetailsWidget';
import { datasetExplorerIcon } from './icons';

const PLUGIN_ID = 'bigquery-jupyter-plugin:plugin';
const OPEN_COMMAND = 'bigquery-jupyter-plugin:open-explorer';

interface IPluginConfig {
  principal: string | null;
  project: string | null;
  credential_type?: string;
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'BigQuery JupyterLab 4 plugin',
  autoStart: true,
  requires: [ISettingRegistry],
  optional: [ICommandPalette, ILauncher],
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry,
    palette: ICommandPalette | null,
    launcher: ILauncher | null
  ): Promise<void> => {
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
    try {
      const config = await requestAPI<IPluginConfig>('config');
      console.log(
        `[bigquery-jupyter-plugin] identity: ${config.principal} (project: ${config.project})`
      );
    } catch (error) {
      console.error('[bigquery-jupyter-plugin] failed to load config:', error);
    }

    let settings: ISettingRegistry.ISettings | null = null;
    try {
      settings = await settingRegistry.load(PLUGIN_ID);
    } catch (error) {
      console.warn('[bigquery-jupyter-plugin] settings unavailable:', error);
    }

    const openTables = new Map<string, TableDetailsWidget>();
    const openTableDetails = (ref: ITableRef): void => {
      const widgetId = `bq-details:${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
      const existing = openTables.get(widgetId);
      if (existing && !existing.isDisposed) {
        app.shell.activateById(existing.id);
        return;
      }
      const details = new TableDetailsWidget(ref);
      details.id = widgetId;
      details.title.label = ref.tableId;
      details.title.caption = `${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
      details.title.icon = datasetExplorerIcon;
      details.title.closable = true;
      openTables.set(widgetId, details);
      details.disposed.connect(() => openTables.delete(widgetId));
      app.shell.add(details, 'main');
      app.shell.activateById(details.id);
    };

    const explorer = new ExplorerWidget(settings, openTableDetails);
    explorer.id = 'bigquery-jupyter-plugin-explorer';
    explorer.title.icon = datasetExplorerIcon;
    explorer.title.caption = 'Dataset explorer';
    app.shell.add(explorer, 'left', { rank: 250 });

    app.commands.addCommand(OPEN_COMMAND, {
      label: 'Dataset explorer',
      caption: 'Open the dataset explorer',
      icon: datasetExplorerIcon,
      execute: () => {
        app.shell.activateById(explorer.id);
      }
    });
    if (palette) {
      palette.addItem({ command: OPEN_COMMAND, category: 'Dataset explorer' });
    }
    if (launcher) {
      launcher.add({ command: OPEN_COMMAND, category: 'Other', rank: 1 });
    }
  }
};

export default plugin;
