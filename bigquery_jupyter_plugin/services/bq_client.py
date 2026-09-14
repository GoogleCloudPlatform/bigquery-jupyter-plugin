# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Cached BigQuery client factory built on ADC credentials."""

import threading
import time

from google.cloud import bigquery

from . import credentials as _credentials

_DEFAULT_TTL_SECONDS = 30 * 60
_lock = threading.Lock()
_cache = {}  # cache_key -> (client, created_at)


def get_bq_client(project=None, ttl_seconds=_DEFAULT_TTL_SECONDS):
    """Return a cached :class:`google.cloud.bigquery.Client` for ``project``.

    ``project`` defaults to the ADC project. Clients are cached per project
    and rebuilt after ``ttl_seconds`` so refreshed credentials are picked up.
    """
    key = project or "__adc_default__"
    now = time.time()
    with _lock:
        entry = _cache.get(key)
        if entry is not None and (now - entry[1]) < ttl_seconds:
            return entry[0]
        creds, adc_project = _credentials.load_credentials()
        client = bigquery.Client(project=project or adc_project, credentials=creds)
        _cache[key] = (client, now)
        return client


def clear_cache():
    """Drop all cached clients (used by tests and on credential changes)."""
    with _lock:
        _cache.clear()
