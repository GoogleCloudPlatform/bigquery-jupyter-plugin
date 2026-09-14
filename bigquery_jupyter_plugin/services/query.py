# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Query editor backend: dry-run cost estimate, execute, and paginated results.

``dry_run`` estimates bytes processed without running the query. ``execute_query``
submits the job and returns its reference immediately (non-blocking).
``get_query_results`` pages through a finished job's rows, reusing the typed
cell/schema serialization from :mod:`details`. All calls run under ADC /
end-user credentials.
"""

from google.cloud import bigquery

from . import bq_client as _bq_client
from .details import _cell, _schema_to_json

_DEFAULT_PAGE_SIZE = 100


def dry_run(query, project_id=None):
    """Estimate the bytes a query would process, without running it."""
    client = _bq_client.get_bq_client(project=project_id)
    job = client.query(
        query,
        job_config=bigquery.QueryJobConfig(dry_run=True, use_query_cache=False),
    )
    return {
        "totalBytesProcessed": job.total_bytes_processed,
        "cacheHit": job.cache_hit,
        "statementType": job.statement_type,
    }


def execute_query(query, project_id=None, location=None):
    """Submit a query job and return its reference immediately (non-blocking)."""
    client = _bq_client.get_bq_client(project=project_id)
    job = client.query(query, location=location or None)
    return {
        "jobId": job.job_id,
        "projectId": job.project,
        "location": job.location,
        "state": job.state,
    }


def cancel_query(job_id, project_id=None, location=None):
    """Request cancellation of a running query job (best-effort)."""
    client = _bq_client.get_bq_client(project=project_id)
    job = client.cancel_job(
        job_id, project=project_id or None, location=location or None
    )
    return {"jobId": job.job_id, "state": job.state}


def _first_page(row_iter):
    """Extract (rows, schema, total_rows, next_page_token) for one page."""
    try:
        page = next(row_iter.pages)
        rows = [[_cell(v) for v in row.values()] for row in page]
    except StopIteration:
        rows = []
    return rows, row_iter.schema, row_iter.total_rows, row_iter.next_page_token


def get_query_results(
    job_id,
    project_id=None,
    location=None,
    page_token=None,
    max_results=_DEFAULT_PAGE_SIZE,
):
    """Return one page of a job's results, or its state if not yet finished.

    While the job is still running, returns ``{state, ...}`` with empty rows so
    the frontend can poll. Once ``DONE``: the first page comes from
    ``job.result()`` (which raises on a failed query, mapped by the handler to a
    real HTTP status); subsequent pages read the job's destination table via
    ``tabledata.list`` (free), which -- unlike ``job.result()`` -- accepts a
    page token to resume.
    """
    client = _bq_client.get_bq_client(project=project_id)
    job = client.get_job(job_id, project=project_id or None, location=location or None)
    if job.state != "DONE":
        return {
            "state": job.state,
            "schema": [],
            "rows": [],
            "totalRows": None,
            "nextPageToken": None,
        }
    if page_token:
        row_iter = client.list_rows(
            job.destination, max_results=max_results, page_token=page_token
        )
    else:
        row_iter = job.result(page_size=max_results)
    rows, schema, total_rows, next_token = _first_page(row_iter)
    return {
        "state": "DONE",
        "schema": _schema_to_json(schema),
        "rows": rows,
        "totalRows": total_rows,
        "nextPageToken": next_token,
    }
