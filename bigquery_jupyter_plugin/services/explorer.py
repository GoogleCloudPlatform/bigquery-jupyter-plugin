# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Explorer backend: list projects, datasets and tables for the tree view.

Projects are enumerated via the Cloud Resource Manager REST API (paginated, since
an end user may have access to a very large number of projects); datasets and
tables use the BigQuery client. All calls run under ADC / end-user credentials.
"""

from google.auth.transport.requests import AuthorizedSession
from google.cloud import bigquery

from . import bq_client as _bq_client
from . import credentials as _credentials

_RESOURCE_MANAGER_URL = "https://cloudresourcemanager.googleapis.com/v1/projects"
PUBLIC_PROJECT = "bigquery-public-data"
_DEFAULT_PAGE_SIZE = 100


def _authorized_session():
    creds, _ = _credentials.load_credentials()
    return AuthorizedSession(creds)


def list_projects(page_token=None, page_size=_DEFAULT_PAGE_SIZE):
    """One page of ACTIVE projects the caller can access, with a nextPageToken."""
    params = {"filter": "lifecycleState:ACTIVE", "pageSize": page_size}
    if page_token:
        params["pageToken"] = page_token
    resp = _authorized_session().get(_RESOURCE_MANAGER_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    projects = [
        {"projectId": p["projectId"], "name": p.get("name", p["projectId"])}
        for p in data.get("projects", [])
    ]
    return {"projects": projects, "nextPageToken": data.get("nextPageToken")}


def _first_page(iterator):
    """Return (items, next_page_token) for the first page of an HTTPIterator."""
    try:
        page = next(iterator.pages)
    except StopIteration:
        return [], None
    items = list(page)
    return items, iterator.next_page_token


def list_datasets(project_id, page_token=None, page_size=_DEFAULT_PAGE_SIZE):
    """One page of datasets in ``project_id``."""
    client = _bq_client.get_bq_client(project=project_id)
    it = client.list_datasets(
        project=project_id, max_results=page_size, page_token=page_token or None
    )
    items, token = _first_page(it)
    datasets = [
        {"id": d.dataset_id, "projectId": d.project, "friendlyName": d.friendly_name}
        for d in items
    ]
    return {"datasets": datasets, "nextPageToken": token}


def list_tables(project_id, dataset_id, page_token=None, page_size=_DEFAULT_PAGE_SIZE):
    """One page of tables/views in ``project_id.dataset_id``."""
    client = _bq_client.get_bq_client(project=project_id)
    ref = bigquery.DatasetReference(project_id, dataset_id)
    it = client.list_tables(ref, max_results=page_size, page_token=page_token or None)
    items, token = _first_page(it)
    tables = [{"id": t.table_id, "type": t.table_type} for t in items]
    return {"tables": tables, "nextPageToken": token}
