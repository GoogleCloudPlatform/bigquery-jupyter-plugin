# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Query history: list the current user's recent BigQuery query jobs.

``list_query_history`` wraps ``client.list_jobs`` (``all_users=False``, so only
the caller's own jobs) and returns lean per-job summaries -- the SQL text, state,
timing, and bytes processed/billed -- so the frontend can show a history panel
and re-open a past query in the editor. Jobs are listed in the given project
(the ADC project by default); ``min_creation_time_ms`` supports incremental
refresh and ``page_token`` supports "load more". All calls run under ADC /
end-user credentials.
"""

import datetime

from . import bq_client as _bq_client

_DEFAULT_MAX_RESULTS = 50


def _job_summary(job):
    """Serialize one job to a JSON-friendly summary (only query jobs are kept)."""
    err = getattr(job, "error_result", None)
    error_message = None
    if isinstance(err, dict):
        error_message = err.get("message")
    return {
        "jobId": job.job_id,
        "projectId": job.project,
        "location": job.location,
        "state": job.state,
        "query": getattr(job, "query", None),
        "statementType": getattr(job, "statement_type", None),
        "created": job.created.isoformat() if job.created else None,
        "started": job.started.isoformat() if job.started else None,
        "ended": job.ended.isoformat() if job.ended else None,
        "totalBytesProcessed": getattr(job, "total_bytes_processed", None),
        "totalBytesBilled": getattr(job, "total_bytes_billed", None),
        "cacheHit": getattr(job, "cache_hit", None),
        "errored": bool(err),
        "errorMessage": error_message,
        "userEmail": getattr(job, "user_email", None),
    }


def list_query_history(
    project_id=None,
    max_results=_DEFAULT_MAX_RESULTS,
    min_creation_time_ms=None,
    page_token=None,
):
    """Return the caller's recent query jobs in ``project_id`` (newest first).

    Only ``query``-type jobs are returned; ``load``/``copy``/``extract`` jobs in
    the same project are filtered out. ``min_creation_time_ms`` (epoch millis)
    caps how far back to look; ``page_token`` resumes a prior page.
    """
    client = _bq_client.get_bq_client(project=project_id)
    kwargs = {"max_results": max_results, "all_users": False}
    if min_creation_time_ms:
        kwargs["min_creation_time"] = datetime.datetime.fromtimestamp(
            min_creation_time_ms / 1000, tz=datetime.timezone.utc
        )
    if page_token:
        kwargs["page_token"] = page_token
    iterator = client.list_jobs(**kwargs)
    jobs = [
        _job_summary(job)
        for job in iterator
        if getattr(job, "job_type", None) == "query"
    ]
    return {"jobs": jobs, "nextPageToken": iterator.next_page_token}
