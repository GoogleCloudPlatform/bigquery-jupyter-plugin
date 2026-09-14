/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import {
  ILabShell,
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';
import {
  ICommandPalette,
  Notification,
  WidgetTracker
} from '@jupyterlab/apputils';
import { ILauncher } from '@jupyterlab/launcher';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { IStateDB } from '@jupyterlab/statedb';
import { requestAPI } from './handler';
import { ExplorerWidget } from './explorer/ExplorerWidget';
import { ITableRef } from './explorer/TableActions';
import { TableDetailsWidget } from './details/TableDetailsWidget';
import { QueryEditorWidget } from './query/QueryEditorWidget';
import { QueryHistoryWidget } from './query/QueryHistoryWidget';
import { datasetExplorerIcon, historyIcon, queryIcon } from './icons';

const PLUGIN_ID = 'bigquery-jupyter-plugin:plugin';
const OPEN_COMMAND = 'bigquery-jupyter-plugin:open-explorer';
const NEW_QUERY_COMMAND = 'bigquery-jupyter-plugin:new-query';
const OPEN_DETAILS_COMMAND = 'bigquery-jupyter-plugin:open-details';
const HISTORY_COMMAND = 'bigquery-jupyter-plugin:query-history';
const HISTORY_WIDGET_ID = 'bigquery-jupyter-plugin-history';
const LAUNCHER_STATE_KEY = 'bigquery-jupyter-plugin:launcher-open';

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
  optional: [ICommandPalette, ILauncher, ILayoutRestorer, ILabShell, IStateDB],
  activate: async (
    app: JupyterFrontEnd,
    settingRegistry: ISettingRegistry,
    palette: ICommandPalette | null,
    launcher: ILauncher | null,
    restorer: ILayoutRestorer | null,
    labShell: ILabShell | null,
    state: IStateDB | null
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
    let defaultProject: string | null = null;
    try {
      const config = await requestAPI<IPluginConfig>('config');
      defaultProject = config.project ?? null;
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

    const detailsTracker = new WidgetTracker<TableDetailsWidget>({
      namespace: 'bigquery-jupyter-plugin-details'
    });
    const queryTracker = new WidgetTracker<QueryEditorWidget>({
      namespace: 'bigquery-jupyter-plugin-query'
    });
    const historyTracker = new WidgetTracker<QueryHistoryWidget>({
      namespace: 'bigquery-jupyter-plugin-history'
    });

    const queryProjects = (): string[] => {
      const added = settings
        ? ((settings.composite.addedProjects as string[]) ?? [])
        : [];
      const projects: string[] = [];
      if (defaultProject) {
        projects.push(defaultProject);
      }
      for (const p of added) {
        if (!projects.includes(p)) {
          projects.push(p);
        }
      }
      return projects;
    };

    let queryCounter = 0;
    const openQueryEditor = (sql = ''): void => {
      void app.commands.execute(NEW_QUERY_COMMAND, { sql });
    };

    const openQueryHistory = (): void => {
      void app.commands.execute(HISTORY_COMMAND);
    };

    const openTables = new Map<string, TableDetailsWidget>();
    const openTableDetails = (ref: ITableRef): void => {
      const widgetId = `bq-details:${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
      const existing = openTables.get(widgetId);
      if (existing && !existing.isDisposed) {
        if (existing.isAttached) {
          app.shell.activateById(existing.id);
          return;
        }
        // Closing a tab detaches (but doesn't dispose) the widget, so a stale
        // entry can linger here; drop it and open a fresh one.
        existing.dispose();
        openTables.delete(widgetId);
      }
      const details = new TableDetailsWidget(ref, openQueryEditor);
      details.id = widgetId;
      details.title.label = ref.tableId;
      details.title.caption = `${ref.projectId}.${ref.datasetId}.${ref.tableId}`;
      details.title.icon = datasetExplorerIcon;
      details.title.closable = true;
      openTables.set(widgetId, details);
      details.disposed.connect(() => openTables.delete(widgetId));
      if (!detailsTracker.has(details)) {
        void detailsTracker.add(details);
      }
      app.shell.add(details, 'main');
      app.shell.activateById(details.id);
    };

    const explorer = new ExplorerWidget(settings, {
      openDetails: openTableDetails,
      openQuery: openQueryEditor,
      openHistory: openQueryHistory
    });
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

    app.commands.addCommand(NEW_QUERY_COMMAND, {
      label: 'Query editor',
      caption: 'Open a BigQuery query editor',
      icon: queryIcon,
      execute: args => {
        const sql = typeof args.sql === 'string' ? args.sql : '';
        let id = typeof args.id === 'string' ? args.id : '';
        if (!id) {
          queryCounter += 1;
          id = `bq-query-${Date.now()}-${queryCounter}`;
        }
        const editor = new QueryEditorWidget(
          sql,
          queryProjects(),
          defaultProject
        );
        editor.id = id;
        editor.title.label = 'Query editor';
        editor.title.icon = queryIcon;
        editor.title.closable = true;
        editor.saveState = () => {
          if (!editor.isDisposed) {
            void queryTracker.save(editor);
          }
        };
        void queryTracker.add(editor);
        app.shell.add(editor, 'main');
        app.shell.activateById(editor.id);
      }
    });

    app.commands.addCommand(OPEN_DETAILS_COMMAND, {
      label: 'Open BigQuery table details',
      execute: args => {
        openTableDetails({
          projectId: String(args.projectId ?? ''),
          datasetId: String(args.datasetId ?? ''),
          tableId: String(args.tableId ?? ''),
          tableType: String(args.tableType ?? 'TABLE')
        });
      }
    });

    // The query-history panel is a single reused main-area widget.
    let historyWidget: QueryHistoryWidget | null = null;
    app.commands.addCommand(HISTORY_COMMAND, {
      label: 'Query history',
      caption: 'Show recent BigQuery queries',
      icon: historyIcon,
      execute: () => {
        if (historyWidget && !historyWidget.isDisposed) {
          if (historyWidget.isAttached) {
            app.shell.activateById(historyWidget.id);
            return;
          }
          // Closing a tab detaches (but doesn't dispose) the widget; drop the
          // stale instance and open a fresh one so its data reloads.
          historyWidget.dispose();
          historyWidget = null;
        }
        const widget = new QueryHistoryWidget(
          queryProjects(),
          defaultProject,
          openQueryEditor
        );
        widget.id = HISTORY_WIDGET_ID;
        widget.title.label = 'Query history';
        widget.title.icon = historyIcon;
        widget.title.closable = true;
        historyWidget = widget;
        widget.disposed.connect(() => {
          if (historyWidget === widget) {
            historyWidget = null;
          }
        });
        if (!historyTracker.has(widget)) {
          void historyTracker.add(widget);
        }
        app.shell.add(widget, 'main');
        app.shell.activateById(widget.id);
      }
    });

    // Restore query editors and table-details panels across a page reload.
    if (restorer) {
      void restorer.restore(queryTracker, {
        command: NEW_QUERY_COMMAND,
        args: widget => ({ sql: widget.sql, id: widget.id }),
        name: widget => widget.id
      });
      void restorer.restore(detailsTracker, {
        command: OPEN_DETAILS_COMMAND,
        args: widget => ({
          projectId: widget.ref.projectId,
          datasetId: widget.ref.datasetId,
          tableId: widget.ref.tableId,
          tableType: widget.ref.tableType
        }),
        name: widget => widget.id
      });
      void restorer.restore(historyTracker, {
        command: HISTORY_COMMAND,
        name: () => HISTORY_WIDGET_ID
      });
    }

    if (palette) {
      palette.addItem({ command: OPEN_COMMAND, category: 'Dataset explorer' });
      palette.addItem({
        command: NEW_QUERY_COMMAND,
        category: 'Dataset explorer'
      });
      palette.addItem({
        command: HISTORY_COMMAND,
        category: 'Dataset explorer'
      });
    }
    if (launcher) {
      launcher.add({ command: OPEN_COMMAND, category: 'Other', rank: 1 });
      launcher.add({ command: NEW_QUERY_COMMAND, category: 'Other', rank: 2 });
      launcher.add({ command: HISTORY_COMMAND, category: 'Other', rank: 3 });
    }

    // JupyterLab doesn't persist the Launcher across reloads. Remember whether
    // one was open (in the state DB) and, after restoration, bring it back only
    // if it was open before -- so the pre-reload state is restored faithfully.
    const hasLauncherOpen = (): boolean =>
      Array.from(app.shell.widgets('main')).some(w =>
        w.id.startsWith('launcher')
      );

    if (state && labShell) {
      let lastLauncherOpen: boolean | null = null;
      labShell.layoutModified.connect(() => {
        const open = hasLauncherOpen();
        if (open !== lastLauncherOpen) {
          lastLauncherOpen = open;
          void state.save(LAUNCHER_STATE_KEY, open);
        }
      });
    }

    void app.restored.then(async () => {
      if (!state) {
        return;
      }
      let wasOpen = false;
      try {
        wasOpen = (await state.fetch(LAUNCHER_STATE_KEY)) === true;
      } catch {
        wasOpen = false;
      }
      if (
        wasOpen &&
        !hasLauncherOpen() &&
        app.commands.hasCommand('launcher:create')
      ) {
        await app.commands.execute('launcher:create');
      }
    });
  }
};

export default plugin;
