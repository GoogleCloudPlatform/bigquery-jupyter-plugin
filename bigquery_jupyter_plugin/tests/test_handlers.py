# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd


async def test_get_example(jp_fetch):
    response = await jp_fetch("bigquery-jupyter-plugin", "health")
    assert response.code == 200
    assert response.body.decode("utf-8") == "ok"
