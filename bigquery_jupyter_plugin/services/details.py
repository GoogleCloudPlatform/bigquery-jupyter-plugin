# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Table details and data preview.

``get_table`` returns schema and metadata; ``preview_table`` returns a page of
rows via ``tabledata.list`` (``client.list_rows``), which reads stored rows
directly and incurs no query cost. Cells are serialized to JSON-friendly,
already-typed values here on the server, so the frontend renders them without
reconstructing types. All calls run under ADC / end-user credentials.
"""

import base64
import datetime
import decimal

from google.cloud import bigquery

from . import bq_client as _bq_client

_DEFAULT_PREVIEW_ROWS = 100


def _schema_to_json(fields):
    """Recursively serialize a sequence of ``SchemaField`` to plain dicts.

    Nested ``RECORD``/``STRUCT`` fields and the ``REPEATED`` mode are preserved
    so the frontend can render nested and repeated columns faithfully.
    """
    return [
        {
            "name": f.name,
            "type": f.field_type,
            "mode": f.mode,
            "description": f.description,
            "fields": _schema_to_json(f.fields) if f.fields else [],
        }
        for f in fields
    ]


def _time_partitioning(tp, require_partition_filter=None):
    if tp is None:
        return None
    return {
        "type": tp.type_,
        "field": tp.field,
        "expirationMs": tp.expiration_ms,
        "requirePartitionFilter": require_partition_filter,
    }


def get_table(project_id, dataset_id, table_id):
    """Return schema and metadata for ``project_id.dataset_id.table_id``."""
    client = _bq_client.get_bq_client(project=project_id)
    ref = bigquery.TableReference(
        bigquery.DatasetReference(project_id, dataset_id), table_id
    )
    table = client.get_table(ref)
    return {
        "id": table.table_id,
        "projectId": table.project,
        "datasetId": table.dataset_id,
        "type": table.table_type,
        "schema": _schema_to_json(table.schema),
        "numRows": table.num_rows,
        "sizeBytes": table.num_bytes,
        "location": table.location,
        "description": table.description,
        "friendlyName": table.friendly_name,
        "created": table.created.isoformat() if table.created else None,
        "modified": table.modified.isoformat() if table.modified else None,
        "expires": table.expires.isoformat() if table.expires else None,
        "timePartitioning": _time_partitioning(
            table.time_partitioning, table.require_partition_filter
        ),
        "clusteringFields": table.clustering_fields,
        "viewQuery": table.view_query,
    }


def _cell(value):
    """Serialize one BigQuery cell to a JSON-friendly, typed value.

    Recurses into ``RECORD`` (dict) and ``REPEATED`` (list) values. Temporal,
    decimal and bytes values become strings so no precision or type is lost in
    transit; ``None`` is preserved so the UI can distinguish null from empty.
    """
    if value is None:
        return None
    if isinstance(value, (str, bool, int, float)):
        return value
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, (datetime.date, datetime.datetime, datetime.time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("ascii")
    if isinstance(value, dict):
        return {k: _cell(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_cell(v) for v in value]
    return str(value)


def preview_table(
    project_id, dataset_id, table_id, max_results=_DEFAULT_PREVIEW_ROWS, start_index=0
):
    """Return one page of rows via ``tabledata.list`` (no query cost).

    Returns ``{schema, rows, totalRows}`` where ``rows`` is a list of rows, each
    a list of typed cells in schema order. Not valid for logical views or
    models (no stored rows); the caller hides preview for those types and the
    handler maps any resulting error to a clean status.
    """
    client = _bq_client.get_bq_client(project=project_id)
    ref = bigquery.TableReference(
        bigquery.DatasetReference(project_id, dataset_id), table_id
    )
    row_iter = client.list_rows(
        ref, max_results=max_results, start_index=start_index or 0
    )
    rows = [[_cell(v) for v in row.values()] for row in row_iter]
    return {
        "schema": _schema_to_json(row_iter.schema),
        "rows": rows,
        "totalRows": row_iter.total_rows,
    }
