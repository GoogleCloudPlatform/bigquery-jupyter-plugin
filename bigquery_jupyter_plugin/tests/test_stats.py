# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for per-column table statistics (BigQuery client mocked)."""

from unittest import mock

from google.cloud import bigquery

from bigquery_jupyter_plugin.services import stats


class _FakeTable:
    def __init__(self, schema, num_rows=0):
        self.schema = schema
        self.num_rows = num_rows


class _FakeJob:
    def __init__(self, row, total_bytes_processed=4096):
        self._row = row
        self.total_bytes_processed = total_bytes_processed

    def result(self):
        return [self._row]


def _client_returning(table, row):
    client = mock.MagicMock()
    client.get_table.return_value = table
    client.query.return_value = _FakeJob(row)
    return client


def test_table_stats_profiles_scalars_and_skips_nested():
    schema = [
        bigquery.SchemaField("id", "INTEGER"),
        bigquery.SchemaField("amount", "FLOAT"),
        bigquery.SchemaField("name", "STRING"),
        bigquery.SchemaField("tags", "STRING", mode="REPEATED"),
        bigquery.SchemaField(
            "addr", "RECORD", fields=[bigquery.SchemaField("city", "STRING")]
        ),
    ]
    row = {
        "total_rows": 100,
        # id (INTEGER: numeric, not float)
        "c0_nulls": 0,
        "c0_distinct": 100,
        "c0_min": 1,
        "c0_max": 100,
        "c0_avg": 50.5,
        "c0_stddev": 29.0,
        "c0_zeros": 2,
        "c0_negatives": 0,
        # amount (FLOAT: numeric + float -> has infinite)
        "c1_nulls": 5,
        "c1_distinct": 80,
        "c1_min": -1.0,
        "c1_max": 1000.0,
        "c1_avg": 42.0,
        "c1_stddev": 10.0,
        "c1_zeros": 3,
        "c1_negatives": 4,
        "c1_infinite": 1,
        # name (STRING: non-numeric)
        "c2_nulls": 10,
        "c2_distinct": 90,
    }
    client = _client_returning(_FakeTable(schema, num_rows=100), row)
    with mock.patch.object(stats._bq_client, "get_bq_client", return_value=client):
        out = stats.table_stats("p", "d", "t")

    assert out["totalRows"] == 100
    assert out["bytesProcessed"] == 4096
    assert out["skipped"] == ["tags", "addr"]

    by_name = {c["name"]: c for c in out["columns"]}
    assert set(by_name) == {"id", "amount", "name"}

    idc = by_name["id"]
    assert idc["distinct"] == 100
    assert idc["distinctFraction"] == 1.0
    assert (idc["min"], idc["max"], idc["avg"], idc["stddev"]) == (1, 100, 50.5, 29.0)
    assert (idc["zeros"], idc["zeroFraction"]) == (2, 0.02)
    assert (idc["negatives"], idc["negativeFraction"]) == (0, 0.0)
    # INTEGER is not a float type, so infinite is not computed.
    assert idc["infinite"] is None and idc["infiniteFraction"] is None
    assert idc["topValues"] == []

    amt = by_name["amount"]
    assert (amt["infinite"], amt["infiniteFraction"]) == (1, 0.01)
    assert (amt["negatives"], amt["negativeFraction"]) == (4, 0.04)

    namec = by_name["name"]
    assert namec["nulls"] == 10
    assert namec["nullFraction"] == 0.1
    assert namec["distinct"] == 90
    assert namec["distinctFraction"] == 0.9
    # Non-numeric columns carry no numeric aggregates.
    for k in ("min", "max", "avg", "stddev", "zeros", "negatives", "infinite"):
        assert namec[k] is None

    sql = client.query.call_args[0][0]
    # Distinct is exact, not approximate.
    assert "COUNT(DISTINCT `id`) AS c0_distinct" in sql
    assert "APPROX_COUNT_DISTINCT" not in sql
    # Zero/negative counts on numerics; infinite only on the float column.
    assert "COUNTIF(`id` = 0) AS c0_zeros" in sql
    assert "COUNTIF(`id` < 0) AS c0_negatives" in sql
    assert "COUNTIF(IS_INF(`amount`)) AS c1_infinite" in sql
    assert "IS_INF(`id`)" not in sql
    # No top-N unless requested.
    assert "APPROX_TOP_COUNT" not in sql
    assert "FROM `p.d.t`" in sql


def test_table_stats_top_values_toggle():
    schema = [bigquery.SchemaField("name", "STRING")]
    row = {
        "total_rows": 15,
        "c0_nulls": 0,
        "c0_distinct": 2,
        "c0_top": [
            {"value": "a", "count": 10},
            {"value": "b", "count": 5},
        ],
    }
    client = _client_returning(_FakeTable(schema, num_rows=15), row)
    with mock.patch.object(stats._bq_client, "get_bq_client", return_value=client):
        out = stats.table_stats("p", "d", "t", top_values=5)

    sql = client.query.call_args[0][0]
    assert "APPROX_TOP_COUNT(`name`, 5) AS c0_top" in sql
    assert out["columns"][0]["topValues"] == [
        {"value": "a", "count": 10},
        {"value": "b", "count": 5},
    ]


def test_table_stats_no_scalar_columns_skips_query():
    schema = [
        bigquery.SchemaField("tags", "STRING", mode="REPEATED"),
        bigquery.SchemaField(
            "addr", "RECORD", fields=[bigquery.SchemaField("city", "STRING")]
        ),
    ]
    client = _client_returning(_FakeTable(schema, num_rows=7), row={})
    with mock.patch.object(stats._bq_client, "get_bq_client", return_value=client):
        out = stats.table_stats("p", "d", "t")

    assert out == {
        "totalRows": 7,
        "bytesProcessed": 0,
        "columns": [],
        "skipped": ["tags", "addr"],
    }
    client.query.assert_not_called()
