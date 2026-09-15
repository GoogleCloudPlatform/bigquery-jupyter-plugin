# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd


async def test_get_example(jp_fetch):
    response = await jp_fetch("bigquery-jupyter-plugin", "health")
    assert response.code == 200
    assert response.body.decode("utf-8") == "ok"


from bigquery_jupyter_plugin import handlers  # noqa: E402


class _FakeError(Exception):
    def __init__(self, text, errors=None, message=None):
        super().__init__(text)
        if errors is not None:
            self.errors = errors
        if message is not None:
            self.message = message


def test_clean_error_prefers_structured_message():
    e = _FakeError(
        "400 POST https://bigquery.googleapis.com/bigquery/v2/projects/p/jobs"
        "?prettyPrint=false: Syntax error: Unclosed identifier literal at [1:70]",
        errors=[
            {
                "reason": "invalidQuery",
                "message": "Syntax error: Unclosed identifier literal at [1:70]",
            }
        ],
    )
    assert (
        handlers._clean_error(e)
        == "Syntax error: Unclosed identifier literal at [1:70]"
    )


def test_clean_error_strips_url_prefix():
    e = _FakeError(
        "404 GET https://bigquery.googleapis.com/bigquery/v2/projects/p/datasets/"
        "samples/tables/nope: Not found: Table p:samples.nope"
    )
    assert handlers._clean_error(e) == "Not found: Table p:samples.nope"


def test_clean_error_strips_reason_and_job_tail():
    e = _FakeError(
        "400 Syntax error: Unclosed identifier literal at [1:70]; reason: "
        "invalidQuery, location: query, message: Syntax error: Unclosed "
        "identifier literal at [1:70] Location: US Job ID: abc123"
    )
    assert (
        handlers._clean_error(e)
        == "Syntax error: Unclosed identifier literal at [1:70]"
    )
