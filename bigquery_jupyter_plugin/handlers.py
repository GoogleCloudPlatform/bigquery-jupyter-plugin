# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

import json

from jupyter_server.base.handlers import APIHandler
from jupyter_server.utils import url_path_join
import tornado


class HealthCheckHandler(APIHandler):
    """APIHandler to report whether the BigQuery Jupyter Plugin is healthy."""
    @tornado.web.authenticated
    def get(self):
        self.finish("ok")


def setup_handlers(web_app):
    host_pattern = ".*$"

    base_url = web_app.settings["base_url"]
    application_url = "bigquery-jupyter-plugin"

    def full_path(name):
        return url_path_join(base_url, application_url, name)

    handlers_map = {
        "health": HealthCheckHandler,
    }
    handlers = [(full_path(name), handler) for name, handler in handlers_map.items()]
    web_app.add_handlers(host_pattern, handlers)
