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
import { LabIcon } from '@jupyterlab/ui-components';
import { requestAPI } from './handler';
import { ExplorerWidget } from './explorer/ExplorerWidget';

const PLUGIN_ID = 'bigquery-jupyter-plugin:plugin';
const OPEN_COMMAND = 'bigquery-jupyter-plugin:open-explorer';

const bigQueryIconSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">' +
  '<path class="jp-icon3" fill="#5f6368" fill-rule="evenodd" clip-rule="evenodd" d="M8.5 15C9.93884 15 11.2684 14.5326 12.3451 13.7414L15.2677 16.664L16.6819 15.2498L13.7566 12.3245C14.5386 11.2514 15 9.92963 15 8.5C15 4.90979 12.0902 2 8.5 2C4.90979 2 2 4.90979 2 8.5C2 12.0902 4.90979 15 8.5 15ZM13 8.5C13 10.9853 10.9853 13 8.5 13C6.01472 13 4 10.9853 4 8.5C4 6.01472 6.01472 4 8.5 4C10.9853 4 13 6.01472 13 8.5ZM11 10.9495C10.7129 11.2424 10.3748 11.4851 10 11.6632V9H11V10.9495ZM6 10.9495C6.28706 11.2424 6.6252 11.4851 7 11.6632V8H6V10.9495ZM8.5 12C8.66976 12 8.8367 11.9879 9 11.9646V7H8V11.9646C8.1633 11.9879 8.33024 12 8.5 12Z"/>' +
  '</svg>';

const bigQueryIcon = new LabIcon({
  name: 'bigquery-jupyter-plugin:icon',
  svgstr: bigQueryIconSvg
});

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

    const explorer = new ExplorerWidget(settings);
    explorer.id = 'bigquery-jupyter-plugin-explorer';
    explorer.title.icon = bigQueryIcon;
    explorer.title.caption = 'BigQuery';
    app.shell.add(explorer, 'left', { rank: 250 });

    app.commands.addCommand(OPEN_COMMAND, {
      label: 'BigQuery Explorer',
      caption: 'Open the BigQuery explorer',
      icon: bigQueryIcon,
      execute: () => {
        app.shell.activateById(explorer.id);
      }
    });
    if (palette) {
      palette.addItem({ command: OPEN_COMMAND, category: 'BigQuery' });
    }
    if (launcher) {
      launcher.add({ command: OPEN_COMMAND, category: 'Other', rank: 1 });
    }
  }
};

export default plugin;
