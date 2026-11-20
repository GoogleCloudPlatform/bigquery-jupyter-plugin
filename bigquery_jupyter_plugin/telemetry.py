# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Workbench usage telemetry: append validated events to a JSON-lines file.

Vertex AI Workbench instances with usage telemetry turned on run an agent that
reads ``*.jsonl`` files in ``EVENTS_DIR``. Anywhere else the directory does not
exist and this module writes nothing (it never creates the directory).

Privacy: events are rebuilt from fixed enum values, bools and integers only.
Nothing a user typed, no resource name, and no error text can reach a line --
invalid events are dropped, never sanitized.
"""

import json
import logging
import os
import stat
import threading
from datetime import datetime, timezone

log = logging.getLogger(__name__)

EVENTS_DIR = "/var/log/notebooks/wbi_telemetry"
FILE_NAME = "bigquery_jupyter_plugin.jsonl"
# Must not end in ".jsonl" or the agent would read the rotated file as well.
ROTATED_NAME = FILE_NAME + ".1"
MAX_FILE_BYTES = 1_000_000
MAX_INT64 = 2**63 - 1

_lock = threading.Lock()

_SURFACES = ("QUERY_EDITOR", "TABLE_STATS")
_OUTCOMES = ("SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT")
_FAILURE_REASONS = (
    "ACCESS_DENIED",
    "NOT_FOUND",
    "INVALID_REQUEST",
    "QUOTA_EXCEEDED",
    "RESOURCES_EXCEEDED",
    "RESPONSE_TOO_LARGE",
    "BILLING_NOT_ENABLED",
    "POLICY_VIOLATION",
    "BACKEND_ERROR",
    "OTHER_FAILURE",
)
_STATEMENT_KINDS = ("SELECT", "DML", "DDL", "SCRIPT", "OTHER_STATEMENT")
_FEATURES = (
    "FORMAT_SQL",
    "COPY_DATAFRAME_CODE",
    "COPY_TABLE_ID",
    "COPY_SELECT_STATEMENT",
    "SEARCH",
    "TABLE_PREVIEW",
    "OPEN_DETAILS",
    "OPEN_HISTORY",
    "GENERATE_STATS",
    "OTHER_FEATURE",
)

# Field kinds. Enum kinds hold the allowed values; "bool"/"int" are scalar kinds.
# Declaration order is the output key order.
_JOB_FIELDS = (
    ("surface", _SURFACES),
    ("outcome", _OUTCOMES),
    ("failure_reason", _FAILURE_REASONS),
    ("statement_kind", _STATEMENT_KINDS),
    ("cache_hit", "bool"),
    ("processed_bytes", "int"),
    ("duration_ms", "int"),
    ("ran_selection", "bool"),
)
_JOB_REQUIRED = ("surface", "outcome")
_FEATURE_FIELDS = (("feature", _FEATURES),)
_FEATURE_REQUIRED = ("feature",)

_EVENTS = {
    "bigquery_job": (_JOB_FIELDS, _JOB_REQUIRED),
    "bigquery_feature_use": (_FEATURE_FIELDS, _FEATURE_REQUIRED),
}


def _clean_field(kind, value):
    """Return the canonical value for ``value`` or raise ValueError.

    Enum values are returned from the fixed tuple, not the input object.
    """
    if kind == "bool":
        if value is True:
            return True
        if value is False:
            return False
        raise ValueError
    if kind == "int":
        if type(value) is int and 0 <= value <= MAX_INT64:
            return int(value)
        raise ValueError
    if isinstance(value, str):
        for allowed in kind:
            if value == allowed:
                return allowed
    raise ValueError


def validate_event(event):
    """Return a clean ``{event_key: {field: value}}`` dict, or None if invalid."""
    if not isinstance(event, dict) or len(event) != 1:
        return None
    (key,) = event.keys()
    spec = _EVENTS.get(key) if isinstance(key, str) else None
    payload = event[key] if spec else None
    if spec is None or not isinstance(payload, dict):
        return None
    fields, required = spec
    known = {name for name, _ in fields}
    if any(k not in known for k in payload):
        return None
    if any(name not in payload for name in required):
        return None
    clean = {}
    try:
        for name, kind in fields:
            if name in payload:
                clean[name] = _clean_field(kind, payload[name])
    except ValueError:
        return None
    if key == "bigquery_job":
        if "failure_reason" in clean and clean["outcome"] != "FAILED":
            return None
        if "ran_selection" in clean and clean["surface"] != "QUERY_EDITOR":
            return None
    return {key: clean}


def _timestamp():
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (now.microsecond // 1000)


def is_enabled(events_dir=None):
    """True only if the events directory is a real directory we own."""
    d = events_dir or EVENTS_DIR
    try:
        st = os.lstat(d)
    except OSError:
        return False
    return stat.S_ISDIR(st.st_mode) and st.st_uid == os.getuid()


def format_line(clean_event):
    """Serialize a validated event with a fresh ``event_time``."""
    line = {"event_time": _timestamp()}
    line.update(clean_event)
    return json.dumps(line, separators=(",", ":"))


def record(event, events_dir=None):
    """Validate ``event`` and append it as one line. Never raises.

    Returns True if a line was written. Invalid events and an unusable
    directory are dropped silently.
    """
    try:
        clean = validate_event(event)
        if clean is None:
            log.debug("telemetry event dropped: invalid")
            return False
        d = events_dir or EVENTS_DIR
        if not is_enabled(d):
            return False
        data = (format_line(clean) + "\n").encode("utf-8")
        path = os.path.join(d, FILE_NAME)
        with _lock:
            try:
                if os.lstat(path).st_size >= MAX_FILE_BYTES:
                    os.replace(path, os.path.join(d, ROTATED_NAME))
            except FileNotFoundError:
                pass
            fd = os.open(
                path,
                os.O_WRONLY | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW,
                0o644,
            )
            try:
                os.write(fd, data)
            finally:
                os.close(fd)
        return True
    except Exception:  # noqa: BLE001 - telemetry must never affect the caller
        log.debug("telemetry write failed")
        return False
