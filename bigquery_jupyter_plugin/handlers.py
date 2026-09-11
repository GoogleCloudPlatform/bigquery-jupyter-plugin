# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

import json

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.ioloop import IOLoop

from bigquery_jupyter_plugin.services import credentials, explorer


async def _finish_json(handler, fn):
    """Run a blocking service call in an executor and finish with JSON.

    Known Google API errors (NotFound, Forbidden, BadRequest, ...) carry an
    HTTP ``code``; surface it and a clean message instead of a blanket 500.
    """
    try:
        result = await IOLoop.current().run_in_executor(None, fn)
        handler.finish(json.dumps(result))
    except Exception as e:  # noqa: BLE001 - surface a clean error to the client
        status = getattr(e, "code", None)
        if not isinstance(status, int) or not 400 <= status <= 599:
            status = 500
        handler.log.exception("BigQuery plugin request failed")
        handler.set_status(status)
        handler.finish(json.dumps({"error": str(e)}))


class HealthCheckHandler(APIHandler):
    """Report whether the BigQuery Jupyter Plugin server extension is healthy."""

    @tornado.web.authenticated
    def get(self):
        self.finish("ok")


class ConfigHandler(APIHandler):
    """Return the active principal and default project (Application Default Creds)."""

    @tornado.web.authenticated
    async def get(self):
        await _finish_json(self, credentials.get_identity)


class ProjectsHandler(APIHandler):
    """List ACTIVE projects the user can access (paginated)."""

    @tornado.web.authenticated
    async def get(self):
        page_token = self.get_argument("pageToken", default="") or None
        page_size = int(self.get_argument("pageSize", default="100"))
        await _finish_json(self, lambda: explorer.list_projects(page_token, page_size))


class DatasetsHandler(APIHandler):
    """List datasets in a project (paginated)."""

    @tornado.web.authenticated
    async def get(self):
        project_id = self.get_argument("project_id")
        page_token = self.get_argument("pageToken", default="") or None
        page_size = int(self.get_argument("pageSize", default="100"))
        await _finish_json(
            self, lambda: explorer.list_datasets(project_id, page_token, page_size)
        )


class TablesHandler(APIHandler):
    """List tables/views in a dataset (paginated)."""

    @tornado.web.authenticated
    async def get(self):
        project_id = self.get_argument("project_id")
        dataset_id = self.get_argument("dataset_id")
        page_token = self.get_argument("pageToken", default="") or None
        page_size = int(self.get_argument("pageSize", default="100"))
        await _finish_json(
            self,
            lambda: explorer.list_tables(project_id, dataset_id, page_token, page_size),
        )


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    application_url = "bigquery-jupyter-plugin"

    def full_path(name):
        return url_path_join(base_url, application_url, name)

    handlers_map = {
        "health": HealthCheckHandler,
        "config": ConfigHandler,
        "projects": ProjectsHandler,
        "datasets": DatasetsHandler,
        "tables": TablesHandler,
    }
    handlers = [(full_path(name), handler) for name, handler in handlers_map.items()]
    web_app.add_handlers(host_pattern, handlers)
