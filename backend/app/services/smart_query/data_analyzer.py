"""
Pandas-based data analysis layer.
Takes query result rows and produces summaries, trends, anomaly flags.
"""
from __future__ import annotations

import math
import re
from typing import Any

import pandas as pd

_AGG_KEY_RE = re.compile(r'^(count|sum|avg|total|mean|max|min)_?', re.IGNORECASE)
_AGG_EXACT = frozenset({
    "count", "total", "average", "sum", "maximum", "minimum",
    "total_count", "total_rows", "total_violations", "total_incidents",
    "total_alerts", "total_workers", "total_cameras",
})


def to_dataframe(rows: list[dict]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


def summarize(df: pd.DataFrame) -> dict:
    if df.empty:
        return {"total_rows": 0, "numeric_stats": {}, "date_range": None, "top_values": {}}

    summary: dict[str, Any] = {"total_rows": len(df)}

    # Numeric columns
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    numeric_stats = {}
    for col in numeric_cols[:6]:  # cap at 6 to keep prompt short
        s = df[col].dropna()
        if len(s) == 0:
            continue
        numeric_stats[col] = {
            "min": _round(s.min()),
            "max": _round(s.max()),
            "mean": _round(s.mean()),
            "sum": _round(s.sum()),
        }
    summary["numeric_stats"] = numeric_stats

    # Date columns
    date_col = _find_date_col(df)
    if date_col:
        try:
            dates = pd.to_datetime(df[date_col], utc=True, errors="coerce").dropna()
            if not dates.empty:
                summary["date_range"] = {
                    "from": dates.min().isoformat(),
                    "to": dates.max().isoformat(),
                }
        except Exception:
            pass

    summary["date_range"] = summary.get("date_range")

    # Top values for categorical columns
    cat_cols = df.select_dtypes(include="object").columns.tolist()
    top_values: dict[str, Any] = {}
    for col in cat_cols[:3]:
        vc = df[col].value_counts().head(5).to_dict()
        top_values[col] = {str(k): int(v) for k, v in vc.items()}
    summary["top_values"] = top_values

    return summary


def detect_trend(df: pd.DataFrame, date_col: str, value_col: str) -> dict | None:
    """Return trend direction and % change between first and last bucket."""
    try:
        df = df.copy()
        df[date_col] = pd.to_datetime(df[date_col], utc=True, errors="coerce")
        df = df.dropna(subset=[date_col, value_col]).sort_values(date_col)
        if len(df) < 2:
            return None
        first = df[value_col].iloc[0]
        last = df[value_col].iloc[-1]
        if first == 0:
            return None
        pct = ((last - first) / abs(first)) * 100
        direction = "up" if pct > 0 else "down"
        return {"direction": direction, "pct_change": round(pct, 1), "from": first, "to": last}
    except Exception:
        return None


def flag_anomalies(df: pd.DataFrame, value_col: str) -> list[dict]:
    """Return rows where value_col is more than 2 std-devs from the mean."""
    try:
        s = df[value_col].dropna()
        if len(s) < 4:
            return []
        mean, std = s.mean(), s.std()
        if std == 0:
            return []
        outliers = df[(df[value_col] - mean).abs() > 2 * std]
        return outliers.head(5).to_dict(orient="records")
    except Exception:
        return []


def compute_confidence(rows: list[dict], has_error: bool) -> str:
    if has_error or not rows:
        return "LOW"
    if len(rows) >= 50:
        return "HIGH"
    if len(rows) >= 10:
        return "MEDIUM"

    # Single-row aggregate detection: COUNT(*), SUM(), AVG() etc. return exactly 1 row
    # but that one row is perfectly accurate — classify as HIGH not LOW.
    if len(rows) == 1:
        row = rows[0]
        keys = list(row.keys())
        values = [v for v in row.values() if v is not None]
        has_agg_key = any(
            _AGG_KEY_RE.match(str(k)) or str(k).lower() in _AGG_EXACT
            for k in keys
        )
        all_numeric = all(isinstance(v, (int, float)) for v in values) if values else False
        if has_agg_key and all_numeric:
            return "HIGH"

    return "LOW"


def _find_date_col(df: pd.DataFrame) -> str | None:
    for col in df.columns:
        if any(kw in col.lower() for kw in ("at", "date", "time", "day")):
            return col
    return None


def _round(val) -> float | int:
    try:
        if math.isnan(val) or math.isinf(val):
            return 0
        return round(float(val), 2)
    except Exception:
        return 0
