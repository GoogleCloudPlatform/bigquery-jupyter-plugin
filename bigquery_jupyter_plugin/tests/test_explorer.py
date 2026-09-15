# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the explorer backend (BigQuery client mocked)."""

from unittest import mock

from bigquery_jupyter_plugin.services import explorer


class _TableItem:
    def __init__(
        self,
        table_id,
        table_type="TABLE",
        time_partitioning=None,
        partitioning_type=None,
        clustering_fields=None,
    ):
        self.table_id = table_id
        self.table_type = table_type
        self.time_partitioning = time_partitioning
        self.partitioning_type = partitioning_type
        self.clustering_fields = clustering_fields


class _DatasetItem:
    def __init__(self, dataset_id, project, friendly_name=None):
        self.dataset_id = dataset_id
        self.project = project
        self.friendly_name = friendly_name


class _Page:
    def __init__(self, items):
        self._items = items

    def __iter__(self):
        return iter(self._items)


class _Iterator:
    def __init__(self, items, next_page_token=None):
        self.pages = iter([_Page(items)])
        self.next_page_token = next_page_token


def test_list_tables_flags_partitioned_and_clustered():
    items = [
        _TableItem("plain"),
        _TableItem("part", time_partitioning=object()),
        _TableItem("part_legacy", partitioning_type="DAY"),
        _TableItem("clust", clustering_fields=["a", "b"]),
        _TableItem("both", time_partitioning=object(), clustering_fields=["x"]),
        _TableItem("mv", table_type="MATERIALIZED_VIEW"),
        _TableItem("v", table_type="VIEW"),
    ]
    client = mock.MagicMock()
    client.list_tables.return_value = _Iterator(items, next_page_token="tok")
    with mock.patch.object(explorer._bq_client, "get_bq_client", return_value=client):
        out = explorer.list_tables("proj", "ds")

    assert out["nextPageToken"] == "tok"
    by_id = {t["id"]: t for t in out["tables"]}
    assert by_id["plain"] == {
        "id": "plain",
        "type": "TABLE",
        "partitioned": False,
        "clustered": False,
    }
    assert by_id["part"]["partitioned"] is True
    assert by_id["part"]["clustered"] is False
    assert by_id["part_legacy"]["partitioned"] is True
    assert by_id["clust"]["clustered"] is True
    assert by_id["clust"]["partitioned"] is False
    assert by_id["both"]["partitioned"] is True
    assert by_id["both"]["clustered"] is True
    # Type is passed through verbatim (the UI maps it to icon + badge).
    assert by_id["mv"]["type"] == "MATERIALIZED_VIEW"
    assert by_id["v"]["type"] == "VIEW"


def test_list_datasets_shape():
    items = [
        _DatasetItem("ds1", "proj", friendly_name="First"),
        _DatasetItem("ds2", "proj"),
    ]
    client = mock.MagicMock()
    client.list_datasets.return_value = _Iterator(items, next_page_token=None)
    with mock.patch.object(explorer._bq_client, "get_bq_client", return_value=client):
        out = explorer.list_datasets("proj")

    assert out["nextPageToken"] is None
    assert out["datasets"] == [
        {"id": "ds1", "projectId": "proj", "friendlyName": "First"},
        {"id": "ds2", "projectId": "proj", "friendlyName": None},
    ]
