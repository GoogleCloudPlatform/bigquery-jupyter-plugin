# Copyright 2024 Google LLC
#
# Use of this source code is governed by a BSD-style
# license that can be found in the LICENSE file or at
# https://developers.google.com/open-source/licenses/bsd

"""Per-column table statistics ("Generate Statistics").

Runs a single profiling query over a table's top-level scalar columns and
returns, per column:

* null count and fraction,
* exact distinct count and fraction (``COUNT(DISTINCT ...)``), and
* for numeric columns: min/max/avg/stddev plus zero and negative counts, and
  (for floating-point columns) an infinite count.

When ``top_values`` is set, each column additionally gets an approximate
top-N value/count list (``APPROX_TOP_COUNT``) for a value-distribution chart;
this stays within the same single query, so it is an opt-in toggle rather than
a per-column query fan-out.

Nested (``RECORD``/``STRUCT``) and ``REPEATED`` columns are skipped because they
cannot be aggregated directly. Unlike the legacy notebook ``%bigquery_stats``
magic, this computes the profile server-side and returns it to the plugin UI. It
runs under ADC / end-user credentials and scans the profiled columns, so it is a
billable query (the caller triggers it explicitly and the UI surfaces the bytes
processed).
"""

from google.cloud import bigquery

from . import bq_client as _bq_client
from .details import _cell

_NUMERIC_TYPES = frozenset(
    {"INTEGER", "INT64", "FLOAT", "FLOAT64", "NUMERIC", "BIGNUMERIC"}
)
# Only floating-point columns can hold +/-inf; IS_INF is meaningless elsewhere.
_FLOAT_TYPES = frozenset({"FLOAT", "FLOAT64"})
_NESTED_TYPES = frozenset({"RECORD", "STRUCT"})


def _quote_ident(name):
    """Backtick-quote a BigQuery identifier, escaping embedded backticks."""
    escaped = name.replace("\\", "\\\\").replace("`", "\\`")
    return f"`{escaped}`"


def _is_numeric(field_type):
    return field_type.upper() in _NUMERIC_TYPES


def _is_float(field_type):
    return field_type.upper() in _FLOAT_TYPES


def _build_query(fqn, profiled, top_values):
    """Build the single-row aggregation query for the profiled columns."""
    selects = ["COUNT(*) AS total_rows"]
    for i, f in enumerate(profiled):
        col = _quote_ident(f.name)
        selects.append(f"COUNTIF({col} IS NULL) AS c{i}_nulls")
        selects.append(f"COUNT(DISTINCT {col}) AS c{i}_distinct")
        if _is_numeric(f.field_type):
            selects.append(f"MIN({col}) AS c{i}_min")
            selects.append(f"MAX({col}) AS c{i}_max")
            selects.append(f"AVG({col}) AS c{i}_avg")
            selects.append(f"STDDEV({col}) AS c{i}_stddev")
            selects.append(f"COUNTIF({col} = 0) AS c{i}_zeros")
            selects.append(f"COUNTIF({col} < 0) AS c{i}_negatives")
        if _is_float(f.field_type):
            selects.append(f"COUNTIF(IS_INF({col})) AS c{i}_infinite")
        if top_values:
            selects.append(
                f"APPROX_TOP_COUNT({col}, {int(top_values)}) AS c{i}_top"
            )
    return "SELECT " + ", ".join(selects) + f" FROM {fqn}"


def _fraction(count, total):
    return (count / total) if total else None


def _top_list(raw):
    """Serialize an APPROX_TOP_COUNT array to ``[{value, count}, ...]``."""
    out = []
    for item in raw or []:
        out.append({"value": _cell(item["value"]), "count": item["count"]})
    return out


def table_stats(project_id, dataset_id, table_id, top_values=0):
    """Compute a per-column profile for a table via one aggregation query.

    Returns ``{totalRows, bytesProcessed, columns, skipped}``. Each entry in
    ``columns`` is ``{name, type, nulls, nullFraction, distinct,
    distinctFraction, min, max, avg, stddev, zeros, zeroFraction, negatives,
    negativeFraction, infinite, infiniteFraction, topValues}``. Numeric-only
    fields are ``None`` for non-numeric columns, ``infinite*`` is ``None`` for
    non-float columns, and ``topValues`` is populated only when ``top_values``
    is set. ``skipped`` lists nested/repeated column names excluded from the
    profile.
    """
    client = _bq_client.get_bq_client(project=project_id)
    ref = bigquery.TableReference(
        bigquery.DatasetReference(project_id, dataset_id), table_id
    )
    table = client.get_table(ref)

    profiled = []
    skipped = []
    for f in table.schema:
        if f.mode == "REPEATED" or f.field_type.upper() in _NESTED_TYPES:
            skipped.append(f.name)
        else:
            profiled.append(f)

    if not profiled:
        return {
            "totalRows": table.num_rows,
            "bytesProcessed": 0,
            "columns": [],
            "skipped": skipped,
        }

    fqn = _quote_ident(f"{project_id}.{dataset_id}.{table_id}")
    job = client.query(_build_query(fqn, profiled, top_values))
    row = list(job.result())[0]
    total = row["total_rows"] or 0

    columns = []
    for i, f in enumerate(profiled):
        numeric = _is_numeric(f.field_type)
        floaty = _is_float(f.field_type)
        nulls = row[f"c{i}_nulls"]
        distinct = row[f"c{i}_distinct"]
        zeros = row[f"c{i}_zeros"] if numeric else None
        negatives = row[f"c{i}_negatives"] if numeric else None
        infinite = row[f"c{i}_infinite"] if floaty else None
        columns.append(
            {
                "name": f.name,
                "type": f.field_type,
                "nulls": nulls,
                "nullFraction": _fraction(nulls, total),
                "distinct": distinct,
                "distinctFraction": _fraction(distinct, total),
                "min": _cell(row[f"c{i}_min"]) if numeric else None,
                "max": _cell(row[f"c{i}_max"]) if numeric else None,
                "avg": _cell(row[f"c{i}_avg"]) if numeric else None,
                "stddev": _cell(row[f"c{i}_stddev"]) if numeric else None,
                "zeros": zeros,
                "zeroFraction": _fraction(zeros, total) if numeric else None,
                "negatives": negatives,
                "negativeFraction": (
                    _fraction(negatives, total) if numeric else None
                ),
                "infinite": infinite,
                "infiniteFraction": (
                    _fraction(infinite, total) if floaty else None
                ),
                "topValues": _top_list(row[f"c{i}_top"]) if top_values else [],
            }
        )

    return {
        "totalRows": total,
        "bytesProcessed": job.total_bytes_processed,
        "columns": columns,
        "skipped": skipped,
    }
