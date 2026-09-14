# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for table details/preview serialization (BigQuery client mocked)."""

import base64
import datetime
import decimal
from unittest import mock

from google.cloud import bigquery

from bigquery_jupyter_plugin.services import details


class _FakeTable:
    def __init__(self, **kwargs):
        self.__dict__.update(kwargs)


class _FakeRow:
    def __init__(self, values):
        self._values = values

    def values(self):
        return self._values


class _FakeRowIterator:
    def __init__(self, rows, schema, total_rows):
        self._rows = rows
        self.schema = schema
        self.total_rows = total_rows

    def __iter__(self):
        return iter(self._rows)


def test_schema_to_json_preserves_nested_and_repeated():
    schema = [
        bigquery.SchemaField("id", "INTEGER", mode="REQUIRED", description="pk"),
        bigquery.SchemaField("tags", "STRING", mode="REPEATED"),
        bigquery.SchemaField(
            "addr",
            "RECORD",
            mode="NULLABLE",
            fields=[
                bigquery.SchemaField("city", "STRING"),
                bigquery.SchemaField("zip", "STRING"),
            ],
        ),
    ]
    out = details._schema_to_json(schema)
    assert out[0] == {
        "name": "id",
        "type": "INTEGER",
        "mode": "REQUIRED",
        "description": "pk",
        "fields": [],
    }
    assert out[1]["mode"] == "REPEATED"
    assert out[2]["type"] == "RECORD"
    assert [f["name"] for f in out[2]["fields"]] == ["city", "zip"]


def test_get_table_shape_and_serialization():
    created = datetime.datetime(2024, 1, 2, 3, 4, 5, tzinfo=datetime.timezone.utc)
    table = _FakeTable(
        table_id="t",
        project="p",
        dataset_id="d",
        table_type="TABLE",
        schema=[bigquery.SchemaField("id", "INTEGER")],
        num_rows=42,
        num_bytes=1024,
        location="US",
        description="desc",
        friendly_name="Friendly",
        created=created,
        modified=created,
        expires=None,
        time_partitioning=bigquery.TimePartitioning(type_="DAY", field="ts"),
        require_partition_filter=True,
        clustering_fields=["id"],
        view_query=None,
    )
    client = mock.MagicMock()
    client.get_table.return_value = table
    with mock.patch.object(details._bq_client, "get_bq_client", return_value=client):
        out = details.get_table("p", "d", "t")

    assert out["id"] == "t"
    assert out["type"] == "TABLE"
    assert out["numRows"] == 42
    assert out["sizeBytes"] == 1024
    assert out["created"] == created.isoformat()
    assert out["expires"] is None
    assert out["timePartitioning"]["type"] == "DAY"
    assert out["timePartitioning"]["field"] == "ts"
    assert out["timePartitioning"]["requirePartitionFilter"] is True
    assert out["clusteringFields"] == ["id"]
    assert out["schema"][0]["name"] == "id"

    assert out["viewQuery"] is None

    ref = client.get_table.call_args[0][0]
    assert (ref.project, ref.dataset_id, ref.table_id) == ("p", "d", "t")


def test_get_table_view_exposes_query():
    view = _FakeTable(
        table_id="v",
        project="p",
        dataset_id="d",
        table_type="VIEW",
        schema=[bigquery.SchemaField("word", "STRING")],
        num_rows=0,
        num_bytes=0,
        location="US",
        description=None,
        friendly_name=None,
        created=None,
        modified=None,
        expires=None,
        time_partitioning=None,
        require_partition_filter=None,
        clustering_fields=None,
        view_query="SELECT word FROM t",
    )
    client = mock.MagicMock()
    client.get_table.return_value = view
    with mock.patch.object(details._bq_client, "get_bq_client", return_value=client):
        out = details.get_table("p", "d", "v")
    assert out["type"] == "VIEW"
    assert out["viewQuery"] == "SELECT word FROM t"
    assert out["timePartitioning"] is None


def test_cell_typed_serialization():
    assert details._cell(None) is None
    assert details._cell("s") == "s"
    assert details._cell(7) == 7
    assert details._cell(True) is True
    assert details._cell(decimal.Decimal("1.50")) == "1.50"
    assert details._cell(datetime.date(2024, 5, 6)) == "2024-05-06"
    ts = datetime.datetime(2024, 5, 6, 7, 8, 9, tzinfo=datetime.timezone.utc)
    assert details._cell(ts) == ts.isoformat()
    assert details._cell(b"ab") == base64.b64encode(b"ab").decode("ascii")
    assert details._cell({"k": decimal.Decimal("2")}) == {"k": "2"}
    assert details._cell([1, b"x"]) == [1, base64.b64encode(b"x").decode("ascii")]


def test_preview_table_typed_rows():
    schema = [
        bigquery.SchemaField("id", "INTEGER"),
        bigquery.SchemaField("amt", "NUMERIC"),
    ]
    rows = [
        _FakeRow((1, decimal.Decimal("2.50"))),
        _FakeRow((None, decimal.Decimal("0"))),
    ]
    row_iter = _FakeRowIterator(rows, schema, total_rows=2)
    client = mock.MagicMock()
    client.list_rows.return_value = row_iter
    with mock.patch.object(details._bq_client, "get_bq_client", return_value=client):
        out = details.preview_table("p", "d", "t", max_results=10, start_index=0)

    assert out["totalRows"] == 2
    assert out["rows"] == [[1, "2.50"], [None, "0"]]
    assert [c["name"] for c in out["schema"]] == ["id", "amt"]

    _, kwargs = client.list_rows.call_args
    assert kwargs["max_results"] == 10
    assert kwargs["start_index"] == 0
