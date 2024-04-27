# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

import pytest

pytest_plugins = ["pytest_jupyter.jupyter_server"]

@pytest.fixture
def jp_server_config(jp_server_config):
    return {
        "ServerApp": {
            "jpserver_extensions": {
                "bigquery_jupyter_plugin": True,
            },
        },
    }
