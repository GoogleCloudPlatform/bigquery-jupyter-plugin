# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Unit tests for the ADC credentials helper (google.auth mocked)."""

import io
import json
from unittest import mock

from bigquery_jupyter_plugin.services import credentials


class _FakeUserCreds:
    valid = True
    token = "fake-user-token"

    def refresh(self, request):  # pragma: no cover - not hit when valid
        self.valid = True


class _FakeServiceAccountCreds:
    valid = True
    token = "fake-sa-token"

    def __init__(self, email):
        self.service_account_email = email


def test_get_identity_service_account_uses_email():
    creds = _FakeServiceAccountCreds("svc@proj.iam.gserviceaccount.com")
    with mock.patch.object(credentials, "load_credentials", return_value=(creds, "proj")):
        identity = credentials.get_identity()
    assert identity["principal"] == "svc@proj.iam.gserviceaccount.com"
    assert identity["project"] == "proj"
    assert identity["credential_type"] == "_FakeServiceAccountCreds"


def test_get_identity_end_user_resolves_via_userinfo():
    creds = _FakeUserCreds()
    body = io.BytesIO(json.dumps({"email": "user@example.com"}).encode())
    cm = mock.MagicMock()
    cm.__enter__.return_value = body
    with mock.patch.object(credentials, "load_credentials", return_value=(creds, "proj")), \
         mock.patch.object(credentials.urllib.request, "urlopen", return_value=cm):
        identity = credentials.get_identity()
    assert identity["principal"] == "user@example.com"
    assert identity["project"] == "proj"


def test_get_identity_swallows_userinfo_errors():
    creds = _FakeUserCreds()
    with mock.patch.object(credentials, "load_credentials", return_value=(creds, "proj")), \
         mock.patch.object(credentials.urllib.request, "urlopen", side_effect=OSError("boom")):
        identity = credentials.get_identity()
    assert identity["principal"] is None
    assert identity["project"] == "proj"
