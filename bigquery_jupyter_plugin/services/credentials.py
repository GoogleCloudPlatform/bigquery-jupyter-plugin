# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Application Default Credentials for the BigQuery Jupyter plugin.

Authentication goes through :func:`google.auth.default`, so the plugin uses
end-user credentials on Workbench (managed EUC) and the service account
elsewhere -- without depending on gcloud or the Workbench proxy.
"""

import json
import urllib.request

import google.auth
from google.auth.transport.requests import Request

CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"
USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email"
SCOPES = [CLOUD_PLATFORM_SCOPE, USERINFO_EMAIL_SCOPE]

_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


def load_credentials():
    """Return ``(credentials, adc_project)`` from Application Default Credentials."""
    return google.auth.default(scopes=SCOPES)


def _principal_from_credentials(credentials):
    """Best-effort resolution of the identity behind ``credentials``."""
    sa_email = getattr(credentials, "service_account_email", None)
    if sa_email and sa_email != "default":
        return sa_email
    # End-user credentials: resolve the email via the OAuth2 userinfo endpoint.
    if not getattr(credentials, "valid", False):
        credentials.refresh(Request())
    req = urllib.request.Request(
        _USERINFO_URL, headers={"Authorization": f"Bearer {credentials.token}"}
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.load(resp).get("email")


def get_identity():
    """Resolve the active principal and default project.

    Returns a dict with ``principal``, ``project`` and ``credential_type``.
    ``principal`` is ``None`` when it cannot be resolved.
    """
    credentials, project = load_credentials()
    try:
        principal = _principal_from_credentials(credentials)
    except Exception:
        principal = None
    return {
        "principal": principal,
        "project": project,
        "credential_type": type(credentials).__name__,
    }
