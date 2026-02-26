"""
Chart generator — produces Recharts-compatible JSON specs from query results.
Frontend renders these with Recharts (already in project stack).

Output shape:
{
  "type": "bar" | "line" | "pie" | "scatter",
  "data": [...],          # array of objects
  "x_key": "...",         # key for X axis
  "y_keys": ["..."],      # keys for Y axis (can be multiple for grouped charts)
  "title": "...",
}
"""
from __future__ import annotations

import pandas as pd


_INTERNAL_COLUMNS = {
    "id",
    "project_id",
    "site_id",
    "camera_id",
    "user_id",
    "zone_id",
    "task_id",
    "note_id",
    "membership_id",
    "invitation_id",
    "created_by",
    "updated_by",
    "invited_by",
    "assigned_to",
    "assigned_by",
}

_CHART_WORDS = ("graph", "chart", "plot", "visual", "trend", "over time", "by day", "by week", "by zone")


def generate_chart(df: pd.DataFrame, intent: str, question: str) -> dict | None:
    """
    Generate a Recharts-compatible chart spec or return None if not applicable.
    """
    if df.empty:
        return None

    numeric_cols = [c for c in df.select_dtypes(include="number").columns.tolist() if not _is_internal_col(c)]
    date_col = _find_date_col(df)
    str_cols = [c for c in df.select_dtypes(include="object").columns.tolist() if not _is_internal_col(c)]

    if not numeric_cols:
        return None

    if len(df) <= 1 and not _asks_for_chart(question):
        return None

    # Time-series → line chart
    if date_col and len(df) >= 3:
        data = _safe_records(df, date_col, numeric_cols[:3])
        if data:
            return {
                "type": "line",
                "data": data,
                "x_key": date_col,
                "y_keys": numeric_cols[:3],
                "x_label": _friendly_label(date_col),
                "y_labels": {c: _friendly_label(c) for c in numeric_cols[:3]},
                "title": _title(question),
            }

    # Categorical grouping → bar chart
    if str_cols and numeric_cols:
        group_col = _best_group_col(str_cols)
        if group_col:
            grouped = (
                df.groupby(group_col)[numeric_cols[0]]
                .sum()
                .reset_index()
                .sort_values(numeric_cols[0], ascending=False)
                .head(15)
            )
            data = grouped.to_dict(orient="records")
            data = _clean_records(data)
            if data:
                return {
                    "type": "bar",
                    "data": data,
                    "x_key": group_col,
                    "y_keys": [numeric_cols[0]],
                    "x_label": _friendly_label(group_col),
                    "y_labels": {numeric_cols[0]: _friendly_label(numeric_cols[0])},
                    "title": _title(question),
                }

    # Pie chart for small categorical distributions
    if str_cols and numeric_cols and len(df) <= 10 and _asks_for_chart(question):
        group_col = _best_group_col(str_cols)
        if group_col:
            data = df[[group_col, numeric_cols[0]]].copy()
            data.columns = ["name", "value"]
            data = _clean_records(data.to_dict(orient="records"))
            if data:
                return {
                    "type": "pie",
                    "data": data,
                    "x_key": "name",
                    "y_keys": ["value"],
                    "x_label": _friendly_label(group_col),
                    "y_labels": {"value": _friendly_label(numeric_cols[0])},
                    "title": _title(question),
                }

    # Explicit chart request with aggregate columns, e.g. helmet_count vs vest_count.
    if _asks_for_chart(question):
        metric_chart = _metric_chart_from_numeric_columns(df, numeric_cols, question)
        if metric_chart:
            return metric_chart

    return None


def _find_date_col(df: pd.DataFrame) -> str | None:
    for col in df.columns:
        if any(kw in col.lower() for kw in ("day", "date", "at", "time", "recorded", "created")):
            try:
                pd.to_datetime(df[col].dropna().iloc[:3], utc=True)
                return col
            except Exception:
                continue
    return None


def _best_group_col(str_cols: list[str]) -> str | None:
    preferred = (
        "project_name", "site_name", "zone_name", "zone", "camera_name",
        "client_name", "full_name", "username", "email", "incident_type",
        "severity", "status", "health_status", "zone_state", "name", "title",
    )
    for p in preferred:
        if p in str_cols:
            return p
    for col in str_cols:
        if not _is_internal_col(col):
            return col
    return None


def _safe_records(df: pd.DataFrame, date_col: str, numeric_cols: list[str]) -> list[dict]:
    cols = [date_col] + [c for c in numeric_cols if c in df.columns]
    sub = df[cols].copy()
    try:
        sub[date_col] = pd.to_datetime(sub[date_col], utc=True, errors="coerce")
        sub[date_col] = sub[date_col].dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        sub[date_col] = sub[date_col].astype(str)
    return _clean_records(sub.to_dict(orient="records"))


def _clean_records(records: list[dict]) -> list[dict]:
    import math
    cleaned = []
    for r in records:
        cleaned_r = {}
        for k, v in r.items():
            if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                cleaned_r[k] = None
            elif hasattr(v, "item"):
                cleaned_r[k] = v.item()
            else:
                cleaned_r[k] = v
        cleaned.append(cleaned_r)
    return cleaned


def _title(question: str) -> str:
    return question[:80] if question else "Query Result"


def _metric_chart_from_numeric_columns(df: pd.DataFrame, numeric_cols: list[str], question: str) -> dict | None:
    metric_cols = [c for c in numeric_cols if not _is_internal_col(c)]
    if len(metric_cols) < 2:
        return None

    data = []
    for col in metric_cols[:10]:
        value = df[col].fillna(0).sum()
        if hasattr(value, "item"):
            value = value.item()
        data.append({"metric": _friendly_label(col), "value": value})

    data = [item for item in data if item["value"] is not None]
    if len(data) < 2:
        return None

    return {
        "type": "bar",
        "data": _clean_records(data),
        "x_key": "metric",
        "y_keys": ["value"],
        "x_label": "Metric",
        "y_labels": {"value": "Count"},
        "title": _title(question),
    }


def _is_internal_col(col: str) -> bool:
    lower = str(col).lower()
    return lower in _INTERNAL_COLUMNS or lower.endswith("_id") or lower.endswith("_uuid")


def _friendly_label(col: str) -> str:
    text = str(col).replace("_", " ").strip()
    return text.title() if text else "Value"


def _asks_for_chart(question: str) -> bool:
    q = (question or "").lower()
    return any(word in q for word in _CHART_WORDS)
