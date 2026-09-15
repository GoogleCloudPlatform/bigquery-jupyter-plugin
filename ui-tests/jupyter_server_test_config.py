# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Server configuration for integration tests.

!! Never use this configuration in production because it opens the server to the
world and provides access to JupyterLab JavaScript objects through the global
window variable.
"""

from jupyterlab.galata import configure_jupyter_server

configure_jupyter_server(c)  # noqa: F821

# Uncomment to set server log level to debug level.
# c.ServerApp.log_level = "DEBUG"
