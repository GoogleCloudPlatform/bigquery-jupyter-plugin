# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd


from .handlers import setup_handlers


def _jupyter_labextension_paths():
    return [{
        "src": "labextension",
        "dest": "bigquery-jupyter-plugin"
    }]


def _jupyter_server_extension_points():
    return [{
        "module": "bigquery_jupyter_plugin"
    }]


def _link_jupyter_server_extension(server_app):
    c = server_app.config
    c.DataprocPluginConfig.enable_bigquery_integration = True


def _load_jupyter_server_extension(server_app):
    """Registers the API handler to receive HTTP requests from the frontend extension.

    Args:
        server_app: [jupyterlab.labapp.LabApp] The JupyterLab application
    """
    setup_handlers(server_app.web_app)
    server_app.log.info(f"Registered the 'bigquery_jupyter_plugin' server extension")
