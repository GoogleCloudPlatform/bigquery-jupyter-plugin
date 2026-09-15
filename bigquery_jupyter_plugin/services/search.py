# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Cross-dataset table/dataset name search via the Dataplex Universal Catalog.

Search matches datasets and tables/views by name only (``displayname:``), not by
column names or descriptions. It uses Dataplex ``searchEntries`` (a single
catalog query that spans all datasets/projects the caller can see), which
requires the Dataplex API to be enabled on the search (billing) project. Because
that is a separate API, the
plugin gates on it: ``dataplex_status`` reports whether it is enabled (via the
Service Usage API) and ``enable_dataplex`` turns it on, so the UI can offer an
"enable" affordance instead of silently failing. All calls run under ADC /
end-user credentials.
"""

from google.auth.transport.requests import AuthorizedSession

from . import credentials as _credentials
from . import serviceusage as _serviceusage

_DATAPLEX_URL = "https://dataplex.googleapis.com/v1"
_PAGE_SIZE = 500
_MAX_PAGES = 20  # safety cap on searchEntries pagination


def _authorized_session():
    creds, _ = _credentials.load_credentials()
    return AuthorizedSession(creds)


def dataplex_status(project_id):
    """Report whether the Dataplex API is enabled on ``project_id``."""
    return _serviceusage.service_status(project_id, _serviceusage.DATAPLEX_SERVICE)


def enable_dataplex(project_id):
    """Enable the Dataplex API on ``project_id`` (needs serviceusage.services.enable)."""
    return _serviceusage.enable_service(project_id, _serviceusage.DATAPLEX_SERVICE)


def _entry_type(entry):
    """Map a Dataplex entry's entryType to a BigQuery table type."""
    entry_type = (entry.get("entryType") or "").rsplit("/", 1)[-1].lower()
    if "view" in entry_type:
        return "VIEW"
    if "model" in entry_type:
        return "MODEL"
    return "TABLE"


def _parse_entry(item):
    """Turn one searchEntries result into a dataset or table/view row.

    A 2-part FQN (``bigquery:project.dataset``) is a dataset match; a 3-part FQN
    is a table/view match. Returns ``None`` for anything else.
    """
    entry = item.get("dataplexEntry") or {}
    fqn = entry.get("fullyQualifiedName") or ""
    if not fqn.startswith("bigquery:"):
        return None
    parts = fqn.split(":", 1)[1].split(".")
    if len(parts) == 2:
        return {
            "projectId": parts[0],
            "datasetId": parts[1],
            "tableId": None,
            "type": "DATASET",
        }
    if len(parts) >= 3:
        table_type = _entry_type(entry)
        if table_type == "MODEL":
            return None  # models aren't shown in the explorer tree; skip
        return {
            "projectId": parts[0],
            "datasetId": parts[1],
            "tableId": ".".join(parts[2:]),
            "type": table_type,
        }
    return None


def search_tables(project_id, term, projects=None):
    """Search datasets and tables/views by name via Dataplex searchEntries.

    Matches the ``term`` against entry names only (datasets and every table
    subtype), not column names. ``project_id`` is the project the search runs
    under (Dataplex must be enabled there); ``projects`` scopes the catalog query
    to those project ids (defaults to ``[project_id]``). Returns
    ``{results:[{projectId,datasetId,tableId,type}], partial}``.
    """
    if not term or not term.strip():
        return {"results": [], "partial": False}
    scope = projects or [project_id]
    # ``displayname:`` matches the entry's own name only, so this surfaces
    # datasets and tables/views by name without matching (and unnesting) column
    # names or descriptions. Omitting a type filter keeps every table subtype
    # (plain tables, views, materialized views, external, snapshots); MODEL
    # entries are dropped later in ``_parse_entry``.
    query_parts = [
        f"displayname:{term.strip()}",
        "system=BIGQUERY",
    ]
    project_filter = " OR ".join(f"projectid={p}" for p in scope if p)
    if project_filter:
        query_parts.append(f"({project_filter})")
    query = " AND ".join(query_parts)

    session = _authorized_session()
    endpoint = (
        f"{_DATAPLEX_URL}/projects/{project_id}/locations/global:searchEntries"
    )
    headers = {"X-Goog-User-Project": project_id}
    results = []
    page_token = None
    partial = False
    for page in range(_MAX_PAGES):
        body = {"query": query, "pageSize": _PAGE_SIZE}
        if page_token:
            body["pageToken"] = page_token
        resp = session.post(endpoint, json=body, headers=headers, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        for item in data.get("results", []):
            row = _parse_entry(item)
            if row is not None:
                results.append(row)
        page_token = data.get("nextPageToken")
        if not page_token:
            break
        if page == _MAX_PAGES - 1:
            partial = True
    return {"results": results, "partial": partial}
