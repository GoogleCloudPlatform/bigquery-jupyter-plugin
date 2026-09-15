# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Service Usage API helpers.

Report whether a Google API is enabled on a project, and enable it, so the UI
can gate a feature that needs a separate API (BigQuery itself, or Dataplex for
cross-dataset search) behind a friendly "enable" affordance instead of a raw
error. All calls run under ADC / end-user credentials.
"""

from google.auth.transport.requests import AuthorizedSession

from . import credentials as _credentials

_SERVICE_USAGE_URL = "https://serviceusage.googleapis.com/v1"

BIGQUERY_SERVICE = "bigquery.googleapis.com"
DATAPLEX_SERVICE = "dataplex.googleapis.com"


def _authorized_session():
    creds, _ = _credentials.load_credentials()
    return AuthorizedSession(creds)


def service_status(project_id, service):
    """Report whether ``service`` is enabled on ``project_id``."""
    session = _authorized_session()
    resp = session.get(
        f"{_SERVICE_USAGE_URL}/projects/{project_id}/services/{service}",
        timeout=30,
    )
    resp.raise_for_status()
    state = resp.json().get("state")
    return {"enabled": state == "ENABLED", "state": state}


def enable_service(project_id, service):
    """Enable ``service`` on ``project_id`` (needs serviceusage.services.enable)."""
    session = _authorized_session()
    resp = session.post(
        f"{_SERVICE_USAGE_URL}/projects/{project_id}/services/{service}:enable",
        json={},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    # Enabling returns a (usually already-done) long-running Operation.
    return {"requested": True, "done": bool(data.get("done", False))}


def bigquery_status(project_id):
    """Report whether the BigQuery API is enabled on ``project_id``."""
    return service_status(project_id, BIGQUERY_SERVICE)


def enable_bigquery(project_id):
    """Enable the BigQuery API on ``project_id``."""
    return enable_service(project_id, BIGQUERY_SERVICE)
