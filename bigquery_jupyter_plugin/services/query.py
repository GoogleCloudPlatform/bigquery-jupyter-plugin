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


def _job_stats(job):
    """Post-run statistics for a finished query job.

    Mirrors the fields the Query history panel shows (bytes processed/billed,
    cache hit, statement type) plus slot time, so the query editor can surface
    them inline after a run. Uses ``getattr`` defensively since a non-SELECT or
    script job may not populate every attribute.
    """
    return {
        "totalBytesProcessed": getattr(job, "total_bytes_processed", None),
        "totalBytesBilled": getattr(job, "total_bytes_billed", None),
        "cacheHit": getattr(job, "cache_hit", None),
        "statementType": getattr(job, "statement_type", None),
        "slotMillis": getattr(job, "slot_millis", None),
    }


def get_query_results(
    job_id,
    project_id=None,
    location=None,
    start_index=0,
    max_results=_DEFAULT_PAGE_SIZE,
):
    """Return one page of a job's results, or its state if not yet finished.

    While the job is still running, returns ``{state, ...}`` with empty rows so
    the frontend can poll. Once ``DONE``, ``start_index`` selects the row offset,
    so the UI can jump to any page (first/prev/next/last) rather than only
    appending:

    * ``start_index == 0`` uses ``job.result()``, which raises on a failed query
      (mapped by the handler to a real HTTP status) and also handles non-SELECT
      statements that have no destination table.
    * ``start_index > 0`` reads the finished query's destination table via
      ``tabledata.list`` (free), which accepts a start offset for random access.

    ``totalRows`` is the full result-set size (independent of the page), which
    the UI uses to compute the page count and enable the last-page jump.
    """
    client = _bq_client.get_bq_client(project=project_id)
    job = client.get_job(job_id, project=project_id or None, location=location or None)
    if job.state != "DONE":
        return {
            "state": job.state,
            "schema": [],
            "rows": [],
            "totalRows": None,
            "startIndex": start_index,
        }
    if start_index:
        row_iter = client.list_rows(
            job.destination, start_index=start_index, max_results=max_results
        )
    else:
        row_iter = job.result(page_size=max_results)
    rows, schema, total_rows, _ = _first_page(row_iter)
    return {
        "state": "DONE",
        "schema": _schema_to_json(schema),
        "rows": rows,
        "totalRows": total_rows,
        "startIndex": start_index,
        "stats": _job_stats(job),
    }
