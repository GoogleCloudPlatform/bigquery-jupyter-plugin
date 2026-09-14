# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

import json
import re

import tornado
from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
from tornado.ioloop import IOLoop

from bigquery_jupyter_plugin.services import (
    credentials,
    details,
    explorer,
    query,
    query_history,
)


def _clean_error(e):
    """Turn a Google API error into a short, human-readable message.

    Prefers the structured error message BigQuery returns (e.g. "Syntax error:
    ...") over the raw ``str(e)``, which carries the HTTP verb, full request URL,
    a duplicated reason/message, and a trailing job id.
    """
    errors = getattr(e, "errors", None)
    if isinstance(errors, (list, tuple)):
        for err in errors:
            if isinstance(err, dict) and err.get("message"):
                return err["message"]
    msg = getattr(e, "message", None) or str(e)
    # Drop the "NNN VERB https://...: " API-call prefix, or a bare status code.
    msg = re.sub(r"^\d{3}\s+[A-Z]+\s+https?://\S+:\s*", "", msg)
    msg = re.sub(r"^\d{3}\s+", "", msg)
    # Drop the duplicated "; reason: ...; message: ..." tail and any job id tail.
    msg = re.split(r";\s*reason:", msg)[0]
    msg = re.sub(r"\s*Location:\s*\S+.*?Job ID:\s*\S+\s*$", "", msg)
    return msg.strip()


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
        handler.finish(json.dumps({"error": _clean_error(e)}))


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


class TableHandler(APIHandler):
    """Return schema and metadata for a single table."""

    @tornado.web.authenticated
    async def get(self):
        project_id = self.get_argument("project_id")
        dataset_id = self.get_argument("dataset_id")
        table_id = self.get_argument("table_id")
        await _finish_json(
            self, lambda: details.get_table(project_id, dataset_id, table_id)
        )


class PreviewHandler(APIHandler):
    """Return a page of table rows via tabledata.list (no query cost)."""

    @tornado.web.authenticated
    async def get(self):
        project_id = self.get_argument("project_id")
        dataset_id = self.get_argument("dataset_id")
        table_id = self.get_argument("table_id")
        max_results = int(self.get_argument("maxResults", default="100"))
        start_index = int(self.get_argument("startIndex", default="0"))
        await _finish_json(
            self,
            lambda: details.preview_table(
                project_id, dataset_id, table_id, max_results, start_index
            ),
        )


class DryRunHandler(APIHandler):
    """Estimate the bytes a query would process (no execution)."""

    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body or b"{}")
        sql = body.get("query", "")
        project_id = body.get("projectId") or None
        await _finish_json(self, lambda: query.dry_run(sql, project_id))


class QueryHandler(APIHandler):
    """Submit a query job and return its reference immediately."""

    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body or b"{}")
        sql = body.get("query", "")
        project_id = body.get("projectId") or None
        location = body.get("location") or None
        await _finish_json(
            self, lambda: query.execute_query(sql, project_id, location)
        )


class QueryResultsHandler(APIHandler):
    """Return a page of a query job's results (or its state if still running)."""

    @tornado.web.authenticated
    async def get(self):
        job_id = self.get_argument("jobId")
        project_id = self.get_argument("projectId", default="") or None
        location = self.get_argument("location", default="") or None
        page_token = self.get_argument("pageToken", default="") or None
        max_results = int(self.get_argument("maxResults", default="100"))
        await _finish_json(
            self,
            lambda: query.get_query_results(
                job_id, project_id, location, page_token, max_results
            ),
        )


class CancelQueryHandler(APIHandler):
    """Request cancellation of a running query job."""

    @tornado.web.authenticated
    async def post(self):
        body = json.loads(self.request.body or b"{}")
        job_id = body.get("jobId", "")
        project_id = body.get("projectId") or None
        location = body.get("location") or None
        await _finish_json(
            self, lambda: query.cancel_query(job_id, project_id, location)
        )


class QueryHistoryHandler(APIHandler):
    """List the caller's recent query jobs in a project (paginated)."""

    @tornado.web.authenticated
    async def get(self):
        project_id = self.get_argument("project_id", default="") or None
        max_results = int(self.get_argument("maxResults", default="50"))
        min_creation = self.get_argument("minCreationTime", default="")
        min_creation_ms = int(min_creation) if min_creation else None
        page_token = self.get_argument("pageToken", default="") or None
        await _finish_json(
            self,
            lambda: query_history.list_query_history(
                project_id, max_results, min_creation_ms, page_token
            ),
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
        "table": TableHandler,
        "preview": PreviewHandler,
        "dryRun": DryRunHandler,
        "query": QueryHandler,
        "queryResults": QueryResultsHandler,
        "cancelQuery": CancelQueryHandler,
        "queryHistory": QueryHistoryHandler,
    }
    handlers = [(full_path(name), handler) for name, handler in handlers_map.items()]
    web_app.add_handlers(host_pattern, handlers)
