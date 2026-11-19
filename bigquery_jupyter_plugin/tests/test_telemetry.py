# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

import json
import os
import re
from unittest import mock

import pytest

from bigquery_jupyter_plugin import handlers, telemetry

FIXED_TIME = "2026-11-19T17:02:13.481Z"
GOLDEN = os.path.join(os.path.dirname(__file__), "telemetry_golden.jsonl")
TIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")


def _job(**fields):
    return {"bigquery_job": fields}


def _feature(name):
    return {"bigquery_feature_use": {"feature": name}}


def _success(kind, **extra):
    return _job(
        surface="QUERY_EDITOR",
        outcome="SUCCEEDED",
        statement_kind=kind,
        cache_hit=False,
        processed_bytes=104857600,
        duration_ms=3400,
        ran_selection=False,
        **extra,
    )


GOLDEN_EVENTS = (
    [
        _success("SELECT"),
        _job(
            surface="QUERY_EDITOR",
            outcome="SUCCEEDED",
            statement_kind="DML",
            cache_hit=False,
            processed_bytes=0,
            duration_ms=120,
            ran_selection=True,
        ),
        _job(
            surface="QUERY_EDITOR",
            outcome="SUCCEEDED",
            statement_kind="DDL",
            cache_hit=False,
            duration_ms=900,
            ran_selection=False,
        ),
        _job(
            surface="QUERY_EDITOR",
            outcome="SUCCEEDED",
            statement_kind="SCRIPT",
            cache_hit=False,
            processed_bytes=2048,
            duration_ms=15000,
            ran_selection=False,
        ),
        _job(
            surface="QUERY_EDITOR",
            outcome="SUCCEEDED",
            statement_kind="OTHER_STATEMENT",
            cache_hit=True,
            processed_bytes=0,
            duration_ms=250,
            ran_selection=False,
        ),
    ]
    + [
        _job(
            surface="QUERY_EDITOR",
            outcome="FAILED",
            failure_reason=reason,
            duration_ms=500,
            ran_selection=False,
        )
        for reason in telemetry._FAILURE_REASONS
    ]
    + [
        _job(
            surface="QUERY_EDITOR",
            outcome="CANCELLED",
            duration_ms=1800,
            ran_selection=False,
        ),
        _job(
            surface="QUERY_EDITOR",
            outcome="TIMED_OUT",
            duration_ms=180000,
            ran_selection=True,
        ),
        _job(
            surface="TABLE_STATS",
            outcome="SUCCEEDED",
            statement_kind="SELECT",
            processed_bytes=9223372036854775807,
            duration_ms=7300,
        ),
        _job(
            surface="TABLE_STATS",
            outcome="FAILED",
            failure_reason="ACCESS_DENIED",
            statement_kind="SELECT",
            duration_ms=410,
        ),
        _job(surface="QUERY_EDITOR", outcome="CANCELLED"),
    ]
    + [_feature(name) for name in telemetry._FEATURES]
)


@pytest.fixture
def events_dir(tmp_path, monkeypatch):
    d = tmp_path / "wbi_telemetry"
    d.mkdir()
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(d))
    return d


def _lines(d):
    path = d / telemetry.FILE_NAME
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_writes_valid_job_line(events_dir):
    assert telemetry.record(_success("SELECT"))
    raw = (events_dir / telemetry.FILE_NAME).read_text()
    assert raw.endswith("\n") and raw.count("\n") == 1
    line = json.loads(raw)
    assert list(line) == ["event_time", "bigquery_job"]
    assert TIME_RE.match(line["event_time"])
    assert line["bigquery_job"] == {
        "surface": "QUERY_EDITOR",
        "outcome": "SUCCEEDED",
        "statement_kind": "SELECT",
        "cache_hit": False,
        "processed_bytes": 104857600,
        "duration_ms": 3400,
        "ran_selection": False,
    }


def test_writes_valid_feature_line(events_dir):
    assert telemetry.record(_feature("FORMAT_SQL"))
    (line,) = _lines(events_dir)
    assert TIME_RE.match(line["event_time"])
    assert line["bigquery_feature_use"] == {"feature": "FORMAT_SQL"}


def test_event_time_is_utc_with_millis():
    with mock.patch.object(telemetry, "datetime") as dt:
        from datetime import datetime, timezone

        dt.now.return_value = datetime(
            2026, 11, 19, 17, 2, 13, 481999, tzinfo=timezone.utc
        )
        assert telemetry._timestamp() == FIXED_TIME


def test_appends_lines(events_dir):
    telemetry.record(_feature("SEARCH"))
    telemetry.record(_feature("OPEN_HISTORY"))
    assert [ln["bigquery_feature_use"]["feature"] for ln in _lines(events_dir)] == [
        "SEARCH",
        "OPEN_HISTORY",
    ]


def test_noop_when_directory_missing(tmp_path, monkeypatch):
    missing = tmp_path / "nope"
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(missing))
    assert not telemetry.is_enabled()
    assert not telemetry.record(_feature("SEARCH"))
    # Never creates the directory.
    assert not missing.exists()


def test_noop_when_directory_is_symlink(tmp_path, monkeypatch):
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    link.symlink_to(real)
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(link))
    assert not telemetry.is_enabled()
    assert not telemetry.record(_feature("SEARCH"))
    assert list(real.iterdir()) == []


def test_noop_when_directory_owned_by_other_uid(events_dir):
    with mock.patch.object(telemetry.os, "getuid", return_value=os.getuid() + 1):
        assert not telemetry.is_enabled()
        assert not telemetry.record(_feature("SEARCH"))
    assert _lines(events_dir) == []


def test_noop_when_path_is_a_file(tmp_path, monkeypatch):
    f = tmp_path / "file"
    f.write_text("")
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(f))
    assert not telemetry.is_enabled()


def test_refuses_symlinked_event_file(events_dir, tmp_path):
    target = tmp_path / "elsewhere.txt"
    target.write_text("")
    (events_dir / telemetry.FILE_NAME).symlink_to(target)
    assert not telemetry.record(_feature("SEARCH"))
    assert target.read_text() == ""


def test_write_errors_are_swallowed(events_dir):
    with mock.patch.object(telemetry.os, "write", side_effect=OSError("disk full")):
        assert not telemetry.record(_feature("SEARCH"))


@pytest.mark.parametrize(
    "event",
    [
        None,
        [],
        "string",
        {},
        {"unknown_event": {"feature": "FORMAT_SQL"}},
        # exactly one event key
        {**_feature("FORMAT_SQL"), **_job(surface="QUERY_EDITOR", outcome="FAILED")},
        {"bigquery_job": "not-a-dict"},
        # unknown field
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", query="SELECT 1"),
        {"bigquery_feature_use": {"feature": "FORMAT_SQL", "x": 1}},
        # unknown enum values
        _job(surface="NOTEBOOK", outcome="SUCCEEDED"),
        _job(surface="QUERY_EDITOR", outcome="succeeded"),
        _job(surface="QUERY_EDITOR", outcome="FAILED", failure_reason="BOOM"),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", statement_kind="select"),
        _feature("NOT_A_FEATURE"),
        _feature("format_sql"),
        # wrong types
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", cache_hit=1),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", cache_hit="true"),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", ran_selection=0),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", processed_bytes=True),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=False),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", processed_bytes=-1),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms="12"),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=1.5),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=2**63),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=None),
        _job(surface=["QUERY_EDITOR"], outcome="SUCCEEDED"),
        _job(surface={"a": 1}, outcome="SUCCEEDED"),
        {"bigquery_feature_use": {"feature": 3}},
        # missing required
        _job(surface="QUERY_EDITOR"),
        _job(outcome="SUCCEEDED"),
        {"bigquery_job": {}},
        {"bigquery_feature_use": {}},
        # cross-field rules
        _job(
            surface="QUERY_EDITOR", outcome="SUCCEEDED", failure_reason="OTHER_FAILURE"
        ),
        _job(surface="TABLE_STATS", outcome="SUCCEEDED", ran_selection=False),
    ],
)
def test_invalid_events_are_dropped(events_dir, event):
    assert not telemetry.record(event)
    assert _lines(events_dir) == []
    assert not (events_dir / telemetry.FILE_NAME).exists()


def test_accepts_int_bounds(events_dir):
    assert telemetry.record(
        _job(
            surface="QUERY_EDITOR",
            outcome="SUCCEEDED",
            processed_bytes=2**63 - 1,
            duration_ms=0,
        )
    )


def test_rotates_at_threshold(events_dir):
    path = events_dir / telemetry.FILE_NAME
    path.write_text("x" * (telemetry.MAX_FILE_BYTES - 1))
    telemetry.record(_feature("SEARCH"))
    assert not (events_dir / telemetry.ROTATED_NAME).exists()
    assert path.stat().st_size > telemetry.MAX_FILE_BYTES - 1

    path.write_text("x" * telemetry.MAX_FILE_BYTES)
    telemetry.record(_feature("OPEN_HISTORY"))
    rotated = events_dir / telemetry.ROTATED_NAME
    assert rotated.read_text() == "x" * telemetry.MAX_FILE_BYTES
    assert not telemetry.ROTATED_NAME.endswith(".jsonl")
    (line,) = _lines(events_dir)
    assert line["bigquery_feature_use"] == {"feature": "OPEN_HISTORY"}


def test_golden_lines(events_dir, monkeypatch):
    monkeypatch.setattr(telemetry, "_timestamp", lambda: FIXED_TIME)
    for event in GOLDEN_EVENTS:
        assert telemetry.record(event)
    produced = (events_dir / telemetry.FILE_NAME).read_text().splitlines()
    with open(GOLDEN) as f:
        golden = f.read().splitlines()
    assert len(produced) == len(golden) == len(GOLDEN_EVENTS)

    def strip(line):
        obj = json.loads(line)
        assert TIME_RE.match(obj.pop("event_time"))
        return obj

    assert [strip(x) for x in produced] == [strip(x) for x in golden]
    # Byte-level formatting (compact separators, key order) matches too.
    assert produced == golden


def test_golden_covers_every_shape():
    with open(GOLDEN) as f:
        lines = [json.loads(x) for x in f.read().splitlines()]
    jobs = [x["bigquery_job"] for x in lines if "bigquery_job" in x]
    feats = [
        x["bigquery_feature_use"]["feature"]
        for x in lines
        if "bigquery_feature_use" in x
    ]
    assert {j["outcome"] for j in jobs} == set(telemetry._OUTCOMES)
    assert {j["surface"] for j in jobs} == set(telemetry._SURFACES)
    assert {j["failure_reason"] for j in jobs if "failure_reason" in j} == set(
        telemetry._FAILURE_REASONS
    )
    assert {j["statement_kind"] for j in jobs if "statement_kind" in j} == set(
        telemetry._STATEMENT_KINDS
    )
    assert set(feats) == set(telemetry._FEATURES)


MARKERS = ("MARKER_SQL_9f3c", "MARKER_TABLE_7a1e", "MARKER_ERR_55bd")


def test_privacy_markers_never_written(events_dir):
    sql, table, err = MARKERS
    bodies = [
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", query=sql, table=table),
        _job(surface=sql, outcome="FAILED", failure_reason=err),
        _job(
            surface="QUERY_EDITOR",
            outcome="FAILED",
            failure_reason="OTHER_FAILURE",
            error=err,
        ),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=sql),
        _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", statement_kind=table),
        {"bigquery_feature_use": {"feature": sql, "term": table}},
        {"bigquery_feature_use": {"feature": "SEARCH", "term": table}},
        {sql: {"feature": "SEARCH"}},
        {"bigquery_feature_use": {sql: "SEARCH"}},
        # valid event with extra top-level marker keys
        {**_feature("SEARCH"), table: sql},
    ]
    for body in bodies:
        telemetry.record(body)
    path = events_dir / telemetry.FILE_NAME
    text = path.read_text() if path.exists() else ""
    for marker in MARKERS:
        assert marker not in text
    # Nothing at all was written for these invalid bodies.
    assert text == ""


async def test_privacy_markers_via_handler(jp_fetch, events_dir):
    sql, table, err = MARKERS
    body = {
        "event": {
            "bigquery_job": {
                "surface": "QUERY_EDITOR",
                "outcome": "SUCCEEDED",
                "query": sql,
                "table": table,
                "error": err,
            }
        }
    }
    r = await jp_fetch(
        "bigquery-jupyter-plugin", "telemetry", method="POST", body=json.dumps(body)
    )
    assert r.code == 204
    path = events_dir / telemetry.FILE_NAME
    assert not path.exists() or not any(m in path.read_text() for m in MARKERS)


async def test_handler_get_enabled(jp_fetch, events_dir):
    r = await jp_fetch("bigquery-jupyter-plugin", "telemetry")
    assert r.code == 200
    assert json.loads(r.body) == {"enabled": True}


async def test_handler_get_disabled(jp_fetch, tmp_path, monkeypatch):
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(tmp_path / "missing"))
    r = await jp_fetch("bigquery-jupyter-plugin", "telemetry")
    assert json.loads(r.body) == {"enabled": False}


async def test_handler_post_writes_valid_event(jp_fetch, events_dir):
    body = json.dumps({"event": _feature("COPY_TABLE_ID")})
    r = await jp_fetch("bigquery-jupyter-plugin", "telemetry", method="POST", body=body)
    assert r.code == 204
    (line,) = _lines(events_dir)
    assert line["bigquery_feature_use"] == {"feature": "COPY_TABLE_ID"}


@pytest.mark.parametrize(
    "body",
    [
        "",
        "not json",
        "[]",
        "null",
        json.dumps({}),
        json.dumps({"event": None}),
        json.dumps({"event": {"nope": {}}}),
        json.dumps({"event": _feature("BAD")}),
        json.dumps(
            {"event": _job(surface="QUERY_EDITOR", outcome="SUCCEEDED", duration_ms=-5)}
        ),
    ],
)
async def test_handler_post_succeeds_for_invalid_bodies(jp_fetch, events_dir, body):
    r = await jp_fetch("bigquery-jupyter-plugin", "telemetry", method="POST", body=body)
    assert r.code == 204
    assert _lines(events_dir) == []


async def test_handler_post_succeeds_when_disabled(jp_fetch, tmp_path, monkeypatch):
    monkeypatch.setattr(telemetry, "EVENTS_DIR", str(tmp_path / "missing"))
    body = json.dumps({"event": _feature("SEARCH")})
    r = await jp_fetch("bigquery-jupyter-plugin", "telemetry", method="POST", body=body)
    assert r.code == 204


async def test_handler_post_succeeds_when_record_raises(jp_fetch, events_dir):
    body = json.dumps({"event": _feature("SEARCH")})
    with mock.patch.object(telemetry, "record", side_effect=RuntimeError("boom")):
        r = await jp_fetch(
            "bigquery-jupyter-plugin", "telemetry", method="POST", body=body
        )
    assert r.code == 204


class _ApiError(Exception):
    def __init__(self, code, errors):
        super().__init__("boom")
        self.code = code
        self.errors = errors


def test_error_reason_extracted():
    e = _ApiError(403, [{"reason": "quotaExceeded", "message": "m"}])
    assert handlers._error_reason(e) == "quotaExceeded"


def test_error_reason_absent():
    assert handlers._error_reason(Exception("x")) is None
    assert handlers._error_reason(_ApiError(400, [])) is None
    assert handlers._error_reason(_ApiError(400, [{"message": "m"}])) is None
    assert handlers._error_reason(_ApiError(400, ["junk"])) is None
    assert handlers._error_reason(_ApiError(400, [{"reason": 5}])) is None


class _FakeHandler:
    def __init__(self):
        self.status = None
        self.body = None
        self.log = mock.Mock()

    def set_status(self, s):
        self.status = s

    def finish(self, body=None):
        self.body = body


async def test_finish_json_includes_reason():
    h = _FakeHandler()

    def fn():
        raise _ApiError(403, [{"reason": "rateLimitExceeded", "message": "slow down"}])

    await handlers._finish_json(h, fn)
    assert h.status == 403
    assert json.loads(h.body) == {"error": "slow down", "reason": "rateLimitExceeded"}


async def test_finish_json_includes_statement_type():
    h = _FakeHandler()

    def fn():
        e = _ApiError(403, [{"reason": "accessDenied", "message": "denied"}])
        e.statement_type = "DELETE"
        raise e

    await handlers._finish_json(h, fn)
    assert json.loads(h.body) == {
        "error": "denied",
        "reason": "accessDenied",
        "statementType": "DELETE",
    }


async def test_finish_json_without_reason_unchanged():
    h = _FakeHandler()

    def fn():
        raise ValueError("plain")

    await handlers._finish_json(h, fn)
    assert h.status == 500
    assert json.loads(h.body) == {"error": "plain"}
