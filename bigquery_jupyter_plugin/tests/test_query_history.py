# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the query-history backend (BigQuery client mocked)."""

import datetime
from unittest import mock

from bigquery_jupyter_plugin.services import query_history


class _FakeJob:
    def __init__(self, **kwargs):
        # Sensible defaults so summaries serialize without every field set.
        self.job_id = None
        self.project = None
        self.location = None
        self.state = None
        self.query = None
        self.statement_type = None
        self.created = None
        self.started = None
        self.ended = None
        self.total_bytes_processed = None
        self.total_bytes_billed = None
        self.cache_hit = None
        self.error_result = None
        self.user_email = None
        self.job_type = "query"
        self.__dict__.update(kwargs)


class _FakeIterator:
    def __init__(self, jobs, next_page_token=None):
        self._jobs = jobs
        self.next_page_token = next_page_token

    def __iter__(self):
        return iter(self._jobs)


def _client_with(jobs, next_page_token=None):
    client = mock.MagicMock()
    client.list_jobs.return_value = _FakeIterator(jobs, next_page_token)
    return client


def test_only_query_jobs_are_returned():
    jobs = [
        _FakeJob(job_id="q1", job_type="query", query="SELECT 1"),
        _FakeJob(job_id="load1", job_type="load"),
        _FakeJob(job_id="q2", job_type="query", query="SELECT 2"),
    ]
    client = _client_with(jobs, next_page_token="tok")
    with mock.patch.object(
        query_history._bq_client, "get_bq_client", return_value=client
    ):
        out = query_history.list_query_history("proj")

    assert [j["jobId"] for j in out["jobs"]] == ["q1", "q2"]
    assert out["nextPageToken"] == "tok"
    _, kwargs = client.list_jobs.call_args
    assert kwargs["all_users"] is False
    assert kwargs["max_results"] == 50


def test_job_summary_fields_and_error():
    created = datetime.datetime(2026, 9, 14, 10, 0, 0, tzinfo=datetime.timezone.utc)
    started = datetime.datetime(2026, 9, 14, 10, 0, 1, tzinfo=datetime.timezone.utc)
    ended = datetime.datetime(2026, 9, 14, 10, 0, 3, tzinfo=datetime.timezone.utc)
    job = _FakeJob(
        job_id="q1",
        project="proj",
        location="US",
        state="DONE",
        query="SELECT 1",
        statement_type="SELECT",
        created=created,
        started=started,
        ended=ended,
        total_bytes_processed=2048,
        total_bytes_billed=10485760,
        cache_hit=False,
        error_result={"reason": "invalidQuery", "message": "Syntax error: ..."},
        user_email="bcreddy@google.com",
    )
    client = _client_with([job])
    with mock.patch.object(
        query_history._bq_client, "get_bq_client", return_value=client
    ):
        out = query_history.list_query_history("proj")

    (summary,) = out["jobs"]
    assert summary["jobId"] == "q1"
    assert summary["location"] == "US"
    assert summary["query"] == "SELECT 1"
    assert summary["created"] == created.isoformat()
    assert summary["ended"] == ended.isoformat()
    assert summary["totalBytesProcessed"] == 2048
    assert summary["totalBytesBilled"] == 10485760
    assert summary["errored"] is True
    assert summary["errorMessage"] == "Syntax error: ..."
    assert summary["userEmail"] == "bcreddy@google.com"


def test_min_creation_time_and_page_token_are_passed():
    client = _client_with([])
    with mock.patch.object(
        query_history._bq_client, "get_bq_client", return_value=client
    ):
        query_history.list_query_history(
            "proj",
            max_results=25,
            min_creation_time_ms=1_600_000_000_000,
            page_token="page2",
        )

    _, kwargs = client.list_jobs.call_args
    assert kwargs["max_results"] == 25
    assert kwargs["page_token"] == "page2"
    assert isinstance(kwargs["min_creation_time"], datetime.datetime)
    assert kwargs["min_creation_time"].tzinfo is not None


def test_no_min_creation_time_omits_kwarg():
    client = _client_with([])
    with mock.patch.object(
        query_history._bq_client, "get_bq_client", return_value=client
    ):
        query_history.list_query_history("proj")

    _, kwargs = client.list_jobs.call_args
    assert "min_creation_time" not in kwargs
    assert "page_token" not in kwargs
