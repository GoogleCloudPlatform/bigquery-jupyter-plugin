# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the Dataplex-backed table-search backend (HTTP mocked)."""

from unittest import mock

from bigquery_jupyter_plugin.services import search, serviceusage


def _resp(payload):
    r = mock.MagicMock()
    r.json.return_value = payload
    r.raise_for_status.return_value = None
    return r


def _session(get=None, post=None):
    session = mock.MagicMock()
    if get is not None:
        session.get.return_value = get
    if post is not None:
        if isinstance(post, list):
            session.post.side_effect = post
        else:
            session.post.return_value = post
    return session


def test_dataplex_status_enabled():
    # dataplex_status delegates to serviceusage.service_status.
    session = _session(get=_resp({"state": "ENABLED"}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = search.dataplex_status("proj")
    assert out == {"enabled": True, "state": "ENABLED"}
    (url,), _ = session.get.call_args
    assert url.endswith("projects/proj/services/dataplex.googleapis.com")


def test_dataplex_status_disabled():
    session = _session(get=_resp({"state": "DISABLED"}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = search.dataplex_status("proj")
    assert out["enabled"] is False
    assert out["state"] == "DISABLED"


def test_enable_dataplex():
    session = _session(post=_resp({"name": "operations/abc", "done": True}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = search.enable_dataplex("proj")
    assert out == {"requested": True, "done": True}
    (url,), _ = session.post.call_args
    assert url.endswith("services/dataplex.googleapis.com:enable")


def test_search_empty_term_makes_no_call():
    session = mock.MagicMock()
    with mock.patch.object(search, "_authorized_session", return_value=session):
        out = search.search_tables("proj", "   ")
    assert out == {"results": [], "partial": False}
    session.post.assert_not_called()


def test_search_parses_entries_and_builds_query():
    payload = {
        "results": [
            {
                "dataplexEntry": {
                    "fullyQualifiedName": "bigquery:proj.ds1.users",
                    "entryType": ".../entryTypes/bigquery-table",
                }
            },
            {
                "dataplexEntry": {
                    "fullyQualifiedName": "bigquery:proj.ds2.user_view",
                    "entryType": ".../entryTypes/bigquery-view",
                }
            },
            # dataset-level entry (2-part FQN) -> returned as a DATASET match
            {"dataplexEntry": {"fullyQualifiedName": "bigquery:proj.ds1"}},
        ]
    }
    session = _session(post=_resp(payload))
    with mock.patch.object(search, "_authorized_session", return_value=session):
        out = search.search_tables("proj", "user", ["proj", "other"])

    assert out["partial"] is False
    assert out["results"] == [
        {"projectId": "proj", "datasetId": "ds1", "tableId": "users", "type": "TABLE"},
        {
            "projectId": "proj",
            "datasetId": "ds2",
            "tableId": "user_view",
            "type": "VIEW",
        },
        {
            "projectId": "proj",
            "datasetId": "ds1",
            "tableId": None,
            "type": "DATASET",
        },
    ]
    (url,), kwargs = session.post.call_args
    assert url.endswith("projects/proj/locations/global:searchEntries")
    query = kwargs["json"]["query"]
    assert "system=BIGQUERY" in query
    # Name-only search: match the entry's own name, not columns, and with no
    # type filter (so every table subtype, incl. materialized views, is kept).
    assert "displayname:user" in query
    assert "type=" not in query
    assert "projectid=proj" in query and "projectid=other" in query
    assert kwargs["headers"]["X-Goog-User-Project"] == "proj"


def test_search_skips_model_entries():
    payload = {
        "results": [
            {
                "dataplexEntry": {
                    "fullyQualifiedName": "bigquery:proj.ds1.my_model",
                    "entryType": ".../entryTypes/bigquery-model",
                }
            },
            {
                "dataplexEntry": {
                    "fullyQualifiedName": "bigquery:proj.ds1.users",
                    "entryType": ".../entryTypes/bigquery-table",
                }
            },
        ]
    }
    session = _session(post=_resp(payload))
    with mock.patch.object(search, "_authorized_session", return_value=session):
        out = search.search_tables("proj", "my", ["proj"])

    # The MODEL entry is dropped; only the table survives.
    assert out["results"] == [
        {"projectId": "proj", "datasetId": "ds1", "tableId": "users", "type": "TABLE"},
    ]


def test_search_paginates_with_page_token():
    page1 = _resp(
        {
            "results": [
                {
                    "dataplexEntry": {
                        "fullyQualifiedName": "bigquery:p.d.t1",
                        "entryType": "bigquery-table",
                    }
                }
            ],
            "nextPageToken": "tok",
        }
    )
    page2 = _resp(
        {
            "results": [
                {
                    "dataplexEntry": {
                        "fullyQualifiedName": "bigquery:p.d.t2",
                        "entryType": "bigquery-table",
                    }
                }
            ]
        }
    )
    session = _session(post=[page1, page2])
    with mock.patch.object(search, "_authorized_session", return_value=session):
        out = search.search_tables("p", "t", ["p"])

    assert [r["tableId"] for r in out["results"]] == ["t1", "t2"]
    assert session.post.call_count == 2
    assert session.post.call_args_list[1].kwargs["json"]["pageToken"] == "tok"
