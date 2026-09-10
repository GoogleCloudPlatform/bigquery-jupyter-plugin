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

from bigquery_jupyter_plugin.services import credentials


class HealthCheckHandler(APIHandler):
    """Report whether the BigQuery Jupyter Plugin server extension is healthy."""

    @tornado.web.authenticated
    def get(self):
        self.finish("ok")


class ConfigHandler(APIHandler):
    """Return the active principal and default project (Application Default Creds)."""

    @tornado.web.authenticated
    async def get(self):
        try:
            identity = await IOLoop.current().run_in_executor(
                None, credentials.get_identity
            )
            self.finish(json.dumps(identity))
        except Exception as e:  # noqa: BLE001 - surface a clean error to the client
            self.log.exception("Error resolving identity")
            self.set_status(500)
            self.finish(json.dumps({"error": str(e)}))


def setup_handlers(web_app):
    host_pattern = ".*$"
    base_url = web_app.settings["base_url"]
    application_url = "bigquery-jupyter-plugin"

    def full_path(name):
        return url_path_join(base_url, application_url, name)

    handlers_map = {
        "health": HealthCheckHandler,
        "config": ConfigHandler,
    }
    handlers = [(full_path(name), handler) for name, handler in handlers_map.items()]
    web_app.add_handlers(host_pattern, handlers)
