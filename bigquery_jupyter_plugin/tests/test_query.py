# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the query editor backend (BigQuery client mocked)."""

import decimal
from unittest import mock

from google.cloud import bigquery

from bigquery_jupyter_plugin.services import query


class _FakeJob:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _FakeRow:
    def __init__(self, values):
        self._values = values

    def values(self):
        return self._values


class _FakePage:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class _FakeRowIterator:
    def __init__(self, rows, schema, total_rows, next_page_token):
        self.pages = iter([_FakePage(rows)])
        self.schema = schema
        self.total_rows = total_rows
        self.next_page_token = next_page_token


def test_dry_run_estimates_bytes():
    job = _FakeJob(
        total_bytes_processed=12345, cache_hit=False, statement_type="SELECT"
    )
    client = mock.MagicMock()
    client.query.return_value = job
    with mock.patch.object(query._bq_client, "get_bq_client", return_value=client):
        out = query.dry_run("SELECT 1", "proj")

    assert out["totalBytesProcessed"] == 12345
    assert out["statementType"] == "SELECT"
    _, kwargs = client.query.call_args
    cfg = kwargs["job_config"]
    assert cfg.dry_run is True
    assert cfg.use_query_cache is False


def test_execute_query_returns_job_ref():
    job = _FakeJob(job_id="job123", project="proj", location="US", state="RUNNING")
    client = mock.MagicMock()
    client.query.return_value = job
    with mock.patch.object(query._bq_client, "get_bq_client", return_value=client):
        out = query.execute_query("SELECT 1", "proj", "US")

    assert out == {
        "jobId": "job123",
        "projectId": "proj",
        "location": "US",
        "state": "RUNNING",
    }
    args, kwargs = client.query.call_args
    assert args[0] == "SELECT 1"
    assert kwargs["location"] == "US"


def test_cancel_query():
    job = _FakeJob(job_id="job123", state="RUNNING")
    client = mock.MagicMock()
    client.cancel_job.return_value = job
    with mock.patch.object(query._bq_client, "get_bq_client", return_value=client):
        out = query.cancel_query("job123", "proj", "US")

    assert out == {"jobId": "job123", "state": "RUNNING"}
    args, kwargs = client.cancel_job.call_args
    assert args[0] == "job123"
    assert kwargs["location"] == "US"


def test_get_query_results_running_reports_state():
    job = _FakeJob(state="RUNNING")
    client = mock.MagicMock()
    client.get_job.return_value = job
    with mock.patch.object(query._bq_client, "get_bq_client", return_value=client):
        out = query.get_query_results("job123", "proj", "US")

    assert out["state"] == "RUNNING"
    assert out["rows"] == []
    assert out["schema"] == []


def test_get_query_results_done_typed_rows():
    schema = [
        bigquery.SchemaField("n", "INTEGER"),
        bigquery.SchemaField("amt", "NUMERIC"),
    ]
    rows = [
        _FakeRow((1, decimal.Decimal("2.50"))),
        _FakeRow((None, decimal.Decimal("0"))),
    ]
    row_iter = _FakeRowIterator(rows, schema, total_rows=2, next_page_token="tok")
    job = mock.MagicMock()
    job.state = "DONE"
    job.result.return_value = row_iter
    client = mock.MagicMock()
    client.get_job.return_value = job
    with mock.patch.object(query._bq_client, "get_bq_client", return_value=client):
        out = query.get_query_results("job123", "proj", "US", None, 100)

    assert out["state"] == "DONE"
    assert out["rows"] == [[1, "2.50"], [None, "0"]]
    assert [c["name"] for c in out["schema"]] == ["n", "amt"]
    assert out["totalRows"] == 2
    assert out["nextPageToken"] == "tok"
    _, kwargs = job.result.call_args
    assert kwargs["page_size"] == 100
