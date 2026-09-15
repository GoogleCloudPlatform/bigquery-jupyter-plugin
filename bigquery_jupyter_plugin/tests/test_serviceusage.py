# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the Service Usage helpers (HTTP mocked)."""

from unittest import mock

from bigquery_jupyter_plugin.services import serviceusage


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
        session.post.return_value = post
    return session


def test_service_status_enabled():
    session = _session(get=_resp({"state": "ENABLED"}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = serviceusage.service_status("proj", "some.googleapis.com")
    assert out == {"enabled": True, "state": "ENABLED"}
    (url,), _ = session.get.call_args
    assert url.endswith("projects/proj/services/some.googleapis.com")


def test_service_status_disabled():
    session = _session(get=_resp({"state": "DISABLED"}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = serviceusage.service_status("proj", "some.googleapis.com")
    assert out["enabled"] is False
    assert out["state"] == "DISABLED"


def test_enable_service():
    session = _session(post=_resp({"name": "operations/x", "done": True}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = serviceusage.enable_service("proj", "some.googleapis.com")
    assert out == {"requested": True, "done": True}
    (url,), _ = session.post.call_args
    assert url.endswith("services/some.googleapis.com:enable")


def test_bigquery_status_uses_bigquery_service():
    session = _session(get=_resp({"state": "ENABLED"}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = serviceusage.bigquery_status("proj")
    assert out["enabled"] is True
    (url,), _ = session.get.call_args
    assert url.endswith("projects/proj/services/bigquery.googleapis.com")


def test_enable_bigquery_uses_bigquery_service():
    session = _session(post=_resp({"done": False}))
    with mock.patch.object(serviceusage, "_authorized_session", return_value=session):
        out = serviceusage.enable_bigquery("proj")
    assert out == {"requested": True, "done": False}
    (url,), _ = session.post.call_args
    assert url.endswith("services/bigquery.googleapis.com:enable")
