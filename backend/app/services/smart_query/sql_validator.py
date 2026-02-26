"""
SQL safety validator — enforces SELECT-only queries before execution.
Protects against injection, write operations, and dangerous PostgreSQL functions.
"""
from __future__ import annotations

import re

try:
    import sqlparse  # type: ignore
    _HAS_SQLPARSE = True
except ImportError:
    _HAS_SQLPARSE = False

_TABLE_REF = re.compile(
    r'\b(?:FROM|JOIN|INNER\s+JOIN|LEFT(?:\s+OUTER)?\s+JOIN|RIGHT(?:\s+OUTER)?\s+JOIN'
    r'|FULL(?:\s+OUTER)?\s+JOIN|CROSS\s+JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)',
    re.IGNORECASE,
)

_DANGEROUS_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE"
    r"|EXEC|EXECUTE|XP_|PG_SLEEP|PG_READ_FILE|PG_WRITE_FILE|COPY|\\COPY"
    r"|INTO\s+OUTFILE|LOAD_FILE|INFORMATION_SCHEMA|PG_CATALOG)\b",
    re.IGNORECASE,
)

_LIMIT_PATTERN = re.compile(r"\bLIMIT\s+\d+", re.IGNORECASE)
_MAX_SQL_LEN = 3000
_MAX_ROWS = 500

# ── Column-level validator ────────────────────────────────────────────────────
_COL_LINE_RE = re.compile(r"^\s{2,}([a-z_][a-z0-9_]*)\s+\w", re.MULTILINE)

# Known per-table column hallucinations: {table: {wrong_col: correct_col}}
# deepseek-coder:6.7b frequently uses triggered_at on ppe_incidents (wrong)
# instead of started_at (correct). Extend this dict as new hallucinations are found.
_TABLE_COLUMN_CORRECTIONS: dict[str, dict[str, str]] = {
    "ppe_incidents": {"triggered_at": "started_at"},
    "risk_events": {"overall_risk": "risk_score"},
}

_FALLBACK_ALIAS_REPAIR_COLUMNS: dict[str, frozenset[str]] = {
    "workforce_snapshots": frozenset({
        "id", "project_id", "site_id", "zone_id", "zone_name", "recorded_at",
        "worker_count", "idle_count", "active_count", "utilization_score", "zone_status",
    }),
    "activity_snapshots": frozenset({
        "id", "project_id", "site_id", "zone_id", "zone_name", "recorded_at",
        "trigger", "zone_state", "moving_count", "stationary_count", "idle_count",
        "total_count", "motion_intensity_score", "activity_score",
        "active_minutes_today", "idle_minutes_today", "low_activity_minutes_today",
        "idle_duration_seconds", "longest_idle_seconds", "optical_flow_score",
        "activity_level", "motion_score", "zone_status",
    }),
    "equipment_snapshots": frozenset({
        "id", "project_id", "site_id", "zone_id", "zone_name", "recorded_at",
        "equipment_type", "active_count", "idle_count", "total_count", "utilization_score",
        "idle_ratio", "avg_active_duration", "zone_status", "cross_zone_conflicts",
    }),
    "risk_snapshots": frozenset({
        "id", "project_id", "site_id", "zone_id", "zone_name", "recorded_at",
        "overall_risk", "risk_level", "trend",
    }),
    "risk_events": frozenset({
        "id", "project_id", "camera_id", "zone_id", "zone_name", "event_type",
        "severity", "message", "risk_score", "previous_risk_score", "triggered_at",
        "acknowledged", "acknowledged_at", "acknowledged_by", "status",
    }),
    "ppe_incidents": frozenset({
        "id", "project_id", "site_id", "zone_id", "zone_name", "camera_id",
        "incident_type", "status", "severity", "started_at", "ended_at",
        "has_helmet", "has_vest", "frame_confidence", "created_at",
    }),
    "activity_alerts": frozenset({
        "id", "project_id", "camera_id", "zone_id", "zone_name", "alert_type",
        "severity", "message", "triggered_at", "acknowledged", "acknowledged_at",
        "acknowledged_by", "snapshot_url", "status",
    }),
    "equipment_alerts": frozenset({
        "id", "project_id", "camera_id", "zone_id", "zone_name", "alert_type",
        "severity", "message", "equipment_type", "track_id", "triggered_at",
        "acknowledged", "acknowledged_at", "acknowledged_by", "snapshot_url", "status",
    }),
    "project_tasks": frozenset({
        "id", "project_id", "title", "description", "is_done", "created_by",
        "created_at", "done_at", "auto_generated", "source_incident_id", "assigned_role",
    }),
    "notes": frozenset({
        "id", "project_id", "user_id", "title", "content", "category",
        "is_favourite", "created_at", "updated_at",
    }),
}

# Always-valid identifiers: SQL pseudo-columns, common aggregate aliases, wildcard
_ALWAYS_VALID = frozenset({
    "id", "count", "sum", "avg", "min", "max", "*",
    "total", "total_count", "total_rows", "violation_count", "incident_count",
    "total_violations", "total_incidents", "total_alerts", "total_workers",
    "average", "maximum", "minimum", "lower", "like", "ilike",
})

# SQL keywords that look like identifiers after JOIN but are not table names
_JOIN_KEYWORD_SKIP = frozenset({
    "on", "where", "set", "and", "or", "inner", "left", "right",
    "full", "outer", "cross", "natural", "lateral",
})


def _remap_known_hallucinations(sql: str) -> tuple[str, list[str]]:
    """
    Auto-correct known per-table column name hallucinations before validation.
    Operates on alias-qualified references (e.g. pi.triggered_at) and bare
    unqualified references in single-table queries.
    Returns (corrected_sql, list_of_applied_fixup_descriptions).
    """
    fixups: list[str] = []

    # Build alias → table mapping (reuses the module-level _ALIAS_RE)
    alias_to_table: dict[str, str] = {}
    for m in _ALIAS_RE.finditer(sql):
        table = m.group(1).lower()
        alias = m.group(2).lower()
        if alias not in _JOIN_KEYWORD_SKIP:
            alias_to_table[alias] = table
        alias_to_table[table] = table  # unaliased self-reference

    # Fix alias-qualified references: alias.wrong_col → alias.right_col
    for alias, table in list(alias_to_table.items()):
        corrections = _TABLE_COLUMN_CORRECTIONS.get(table, {})
        for wrong_col, right_col in corrections.items():
            pat = re.compile(
                rf'\b{re.escape(alias)}\.{re.escape(wrong_col)}\b',
                re.IGNORECASE,
            )
            new_sql, n = pat.subn(f"{alias}.{right_col}", sql)
            if n > 0:
                sql = new_sql
                fixups.append(f"column_remap({table}: {wrong_col}→{right_col})")

    # Fix bare unqualified references in single-table queries
    referenced = {m.group(1).lower() for m in _TABLE_REF.finditer(sql)}
    if len(referenced) == 1:
        table = next(iter(referenced))
        for wrong_col, right_col in _TABLE_COLUMN_CORRECTIONS.get(table, {}).items():
            pat = re.compile(rf'\b{re.escape(wrong_col)}\b', re.IGNORECASE)
            new_sql, n = pat.subn(right_col, sql)
            if n > 0:
                sql = new_sql
                fixups.append(f"column_remap({table}: bare {wrong_col}→{right_col})")

    return sql, fixups


def _build_alias_map(sql: str) -> dict[str, str]:
    alias_to_table: dict[str, str] = {}
    for m in _ALIAS_RE.finditer(sql):
        table = m.group(1).lower()
        alias = m.group(2).lower()
        if alias not in _JOIN_KEYWORD_SKIP:
            alias_to_table[alias] = table
        alias_to_table[table] = table
    return alias_to_table


def _repair_unknown_aliases(sql: str) -> tuple[str, list[str]]:
    """
    Fix LLM alias drift such as:
      SELECT pi.zone_name FROM workforce_snapshots ws ...
    when `pi` is not declared but exactly one declared alias has `zone_name`.
    """
    fixups: list[str] = []
    valid_columns = _build_column_lookup()
    if not valid_columns:
        return sql, fixups

    alias_to_table = _build_alias_map(sql)
    if not alias_to_table:
        return sql, fixups

    replacements: dict[tuple[str, str], str] = {}
    for m in _QUALIFIED_COL_RE.finditer(sql):
        alias = m.group(1).lower()
        col = m.group(2).lower()
        if alias in alias_to_table:
            continue

        candidates = [
            known_alias
            for known_alias, table in alias_to_table.items()
            if col in valid_columns.get(table, frozenset())
        ]
        # Prefer short aliases over table self-references, then only repair if unambiguous.
        candidates = sorted(set(candidates), key=lambda item: (len(item), item))
        short_candidates = [c for c in candidates if c not in valid_columns]
        chosen_pool = short_candidates or candidates
        if len(chosen_pool) == 1:
            replacements[(alias, col)] = chosen_pool[0]

    for (bad_alias, col), good_alias in replacements.items():
        pat = re.compile(rf'\b{re.escape(bad_alias)}\.{re.escape(col)}\b', re.IGNORECASE)
        sql, n = pat.subn(f"{good_alias}.{col}", sql)
        if n:
            fixups.append(f"alias_repair({bad_alias}.{col}->{good_alias}.{col})")

    return sql, fixups


def _build_column_lookup() -> dict[str, frozenset[str]]:
    try:
        from .schema_registry import registry
        if registry.is_ready():
            live_lookup = registry.get_column_lookup()
            if live_lookup:
                live = {
                    table.lower(): frozenset(col.lower() for col in cols) | _ALWAYS_VALID
                    for table, cols in live_lookup.items()
                }
                for table, cols in _FALLBACK_ALIAS_REPAIR_COLUMNS.items():
                    live[table] = live.get(table, frozenset()) | cols | _ALWAYS_VALID
                return live
    except Exception:
        pass

    try:
        from .schema_context import TABLE_SCHEMAS as _TABLE_SCHEMAS
    except Exception:
        return dict(_FALLBACK_ALIAS_REPAIR_COLUMNS)
    lookup: dict[str, frozenset[str]] = {}
    for table, schema_str in _TABLE_SCHEMAS.items():
        cols = {m.group(1).lower() for m in _COL_LINE_RE.finditer(schema_str)}
        lookup[table] = frozenset(cols) | _ALWAYS_VALID
    merged = dict(_FALLBACK_ALIAS_REPAIR_COLUMNS)
    merged.update(lookup)
    return merged


_ALIAS_RE = re.compile(
    r'\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(?:AS\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\b',
    re.IGNORECASE,
)
_QUALIFIED_COL_RE = re.compile(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\b')
_IDENT_RE = re.compile(r'\b([a-zA-Z_][a-zA-Z0-9_]*)\b')
_AS_ALIAS_RE = re.compile(r'\bAS\s+([a-zA-Z_][a-zA-Z0-9_]*)\b', re.IGNORECASE)
_SQL_WORDS = frozenset({
    "select", "from", "where", "join", "on", "and", "or", "as", "group", "by",
    "order", "limit", "desc", "asc", "null", "not", "is", "in", "case", "when",
    "then", "else", "end", "filter", "over", "partition", "having", "distinct",
    "true", "false", "current_date", "interval", "date", "now", "count", "sum",
    "avg", "min", "max", "round", "extract", "hour", "day", "week", "month",
    "year", "date_trunc", "coalesce", "nullif", "cast", "float", "numeric",
})


def _validate_columns(sql: str, allowed_tables: list[str]) -> tuple[bool, str | None]:
    """
    Check alias-qualified column references (e.g. pi.violation_score) against known schema columns.
    Bare unqualified columns are not checked — they are often result aliases or computed expressions.
    Returns (is_valid, error_message | None).
    """
    valid_columns = _build_column_lookup()
    if not valid_columns:
        return True, None  # schema lookup unavailable — skip check gracefully

    # Build alias → table mapping from FROM/JOIN clauses
    alias_to_table: dict[str, str] = {}
    for m in _ALIAS_RE.finditer(sql):
        table = m.group(1).lower()
        alias = m.group(2).lower()
        if alias not in _JOIN_KEYWORD_SKIP:
            alias_to_table[alias] = table
        alias_to_table[table] = table  # unaliased use

    bad: list[str] = []
    for m in _QUALIFIED_COL_RE.finditer(sql):
        alias = m.group(1).lower()
        col = m.group(2).lower()
        if alias not in alias_to_table:
            continue  # unknown prefix — may be a schema qualifier, skip
        table = alias_to_table[alias]
        if table not in valid_columns:
            continue  # table not in our lookup — already caught by table whitelist
        valid_cols = valid_columns[table]
        if valid_cols and col not in valid_cols:
            bad.append(f"{alias}.{col} (table: {table})")

    if bad:
        return False, f"Column(s) not found in schema: {', '.join(bad[:3])}"

    # For simple single-table queries, also catch unqualified hallucinated
    # columns such as "incident_date" before they become DB errors.
    referenced_tables = {m.group(1).lower() for m in _TABLE_REF.finditer(sql)}
    if len(referenced_tables) == 1:
        table = next(iter(referenced_tables))
        valid_cols = valid_columns.get(table)
        if valid_cols:
            aliases = {m.group(1).lower() for m in _AS_ALIAS_RE.finditer(sql)}
            known_prefixes = set(alias_to_table) | referenced_tables | aliases | _ALWAYS_VALID
            unknown: list[str] = []
            sql_without_strings = re.sub(r"'[^']*'", " ", sql)
            for token in _IDENT_RE.findall(sql_without_strings):
                t = token.lower()
                if t in _SQL_WORDS or t in known_prefixes or t in valid_cols:
                    continue
                unknown.append(t)
            if unknown:
                return False, f"Column(s) not found in schema: {', '.join(sorted(set(unknown))[:3])}"
    return True, None


# ── Auto GROUP BY corrector ───────────────────────────────────────────────────

_HAS_AGG_RE = re.compile(r'\b(COUNT|SUM|AVG|MIN|MAX)\s*\(', re.IGNORECASE)
_HAS_GROUP_BY_RE = re.compile(r'\bGROUP\s+BY\b', re.IGNORECASE)
_ORDER_BY_RE = re.compile(r'\bORDER\s+BY\b', re.IGNORECASE)
_LIMIT_RE = re.compile(r'\bLIMIT\b', re.IGNORECASE)


def _repair_grouped_snapshot_ratio(sql: str) -> tuple[str, str | None]:
    """
    Convert grouped raw snapshot ratios into aggregate ratios.

    Example from the LLM:
      SELECT ws.zone_name, (ws.active_count::FLOAT / ws.worker_count) * 100 AS utilization_score
      FROM workforce_snapshots ws ... GROUP BY ws.zone_name, utilization_score

    Postgres rejects this because active_count/worker_count are raw columns. For grouped zone
    summaries we want AVG(...) and GROUP BY only the zone/category column.
    """
    if not _HAS_GROUP_BY_RE.search(sql):
        return sql, None

    select_match = re.search(r'^\s*SELECT\s+([\s\S]+?)\s+FROM\b', sql, re.IGNORECASE)
    if not select_match:
        return sql, None

    select_list = select_match.group(1)
    ratio_alias_match = re.search(
        r'(?P<expr>\([^)]+\.active_count::FLOAT\s*/\s*NULLIF\([^)]+,\s*0\)\s*\)\s*\*\s*100'
        r'|\([^)]+\.active_count::FLOAT\s*/\s*[^)]+\.worker_count\s*\)\s*\*\s*100'
        r'|\([^)]+\.active_count::FLOAT\s*/\s*[^)]+\.total_count\s*\)\s*\*\s*100'
        r'|\([^)]+\.utilization_score\s*\)\s*\*\s*100'
        r'|[a-zA-Z_][a-zA-Z0-9_]*\.utilization_score\s*\*\s*100)'
        r'\s+AS\s+(?P<alias>[a-zA-Z_][a-zA-Z0-9_]*)',
        select_list,
        re.IGNORECASE,
    )
    if not ratio_alias_match:
        return sql, None

    expr = ratio_alias_match.group("expr")
    alias = ratio_alias_match.group("alias")
    replacement = f"ROUND(AVG({expr}), 1) AS {alias}"
    sql = sql[:select_match.start(1)] + select_list[:ratio_alias_match.start()] + replacement + select_list[ratio_alias_match.end():] + sql[select_match.end(1):]

    # Remove the computed alias from GROUP BY, since it is now aggregated.
    group_match = re.search(r'\bGROUP\s+BY\s+([\s\S]+?)(?=\bORDER\s+BY\b|\bLIMIT\b|$)', sql, re.IGNORECASE)
    if group_match:
        group_items = [item.strip() for item in group_match.group(1).split(",")]
        group_items = [
            item for item in group_items
            if item and item.lower() != alias.lower()
        ]
        if group_items:
            new_group = "GROUP BY " + ", ".join(group_items) + " "
            sql = sql[:group_match.start()] + new_group + sql[group_match.end():]
        else:
            sql = sql[:group_match.start()] + sql[group_match.end():]

    return sql, f"grouped_ratio_avg({alias})"


def auto_correct_sql(sql: str) -> tuple[str, list[str]]:
    """
    Apply deterministic fixups to LLM-generated SQL before validation.
    Returns (corrected_sql, list_of_applied_fixup_descriptions).
    """
    fixups: list[str] = []

    # Strip markdown fences and trailing semicolons (model sometimes appends multiple)
    sql = re.sub(r"[;\s]+$", "", sql.strip())
    sql = re.sub(r"^```(?:sql)?\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*```$", "", sql).strip()

    # Layer 1: Auto-correct known per-table column hallucinations
    # (e.g. deepseek-coder uses triggered_at on ppe_incidents, correct is started_at)
    sql, remaps = _remap_known_hallucinations(sql)
    fixups.extend(remaps)

    # Layer 1.5: Repair alias drift before validation/execution
    # (e.g. SELECT pi.zone_name FROM workforce_snapshots ws ...)
    sql, alias_repairs = _repair_unknown_aliases(sql)
    fixups.extend(alias_repairs)

    # Layer 2: Aggressive multi-statement / preamble extraction
    # If SQL doesn't start with SELECT or WITH, find the first SELECT statement
    if not re.match(r"^\s*(?:SELECT|WITH)\b", sql, re.IGNORECASE):
        select_m = re.search(r'(SELECT\b[\s\S]+?)(?:;|\Z)', sql, re.IGNORECASE)
        if select_m:
            sql = select_m.group(1).strip()
            fixups.append("extracted_first_select")
    elif ";" in sql:
        # Multiple statements — keep only the first SELECT/WITH
        first = sql.split(";")[0].strip()
        if re.match(r"^\s*(?:SELECT|WITH)\b", first, re.IGNORECASE) and len(first) > 10:
            sql = first
            fixups.append("trimmed_to_first_statement")

    # Safety net: if upstream extraction failed and we received a raw JSON blob,
    # pull the SELECT out rather than letting the validator reject it outright.
    if sql.lstrip().startswith('{'):
        select_m = re.search(r'SELECT\b[\s\S]+', sql, re.IGNORECASE)
        if select_m:
            sql = re.sub(r'["\}\s]+$', '', select_m.group()).strip().rstrip(';')
            fixups.append("extracted_select_from_json_blob")

    # Auto-inject GROUP BY when aggregates exist alongside non-aggregate columns
    if _HAS_AGG_RE.search(sql) and not _HAS_GROUP_BY_RE.search(sql):
        sql, group_expr = _inject_group_by(sql)
        if group_expr:
            fixups.append(f"auto_group_by({group_expr})")

    sql, ratio_fix = _repair_grouped_snapshot_ratio(sql)
    if ratio_fix:
        fixups.append(ratio_fix)

    return sql, fixups


def _inject_group_by(sql: str) -> tuple[str, str | None]:
    """
    Parse the SELECT list and inject GROUP BY for all non-aggregate columns.
    Skips if query is a pure aggregate (SELECT COUNT(*) only) — no GROUP BY needed.
    """
    select_match = re.search(r'^\s*SELECT\s+([\s\S]+?)\s+FROM\b', sql, re.IGNORECASE)
    if not select_match:
        return sql, None

    items = [i.strip() for i in select_match.group(1).split(",")]
    non_agg: list[str] = []
    has_agg = False

    for item in items:
        if _HAS_AGG_RE.search(item):
            has_agg = True
        else:
            # Strip result alias (AS col_name)
            col_expr = re.sub(r'\s+AS\s+\S+$', '', item, flags=re.IGNORECASE).strip()
            # Skip literals, wildcards, and pure integer constants
            if (col_expr and col_expr not in ("*", "1")
                    and not re.match(r"^'.*'$", col_expr)
                    and not re.match(r'^\d+$', col_expr)):
                non_agg.append(col_expr)

    if not has_agg or not non_agg:
        return sql, None  # pure aggregate or no aggregates — no GROUP BY needed

    group_expr = ", ".join(non_agg)

    # Insert before ORDER BY or LIMIT; append otherwise
    insert_at = _ORDER_BY_RE.search(sql) or _LIMIT_PATTERN.search(sql)
    if insert_at:
        pos = insert_at.start()
        sql = sql[:pos] + f"GROUP BY {group_expr} " + sql[pos:]
    else:
        sql = f"{sql} GROUP BY {group_expr}"

    return sql, group_expr


# ── Main validator ────────────────────────────────────────────────────────────

def validate_and_sanitize(sql: str, allowed_tables: list[str]) -> tuple[bool, str, str | None]:
    """
    Returns: (is_valid, sanitized_sql, error_message)
    error_message is None on success.
    """
    sql = sql.strip().rstrip(";")

    if len(sql) > _MAX_SQL_LEN:
        return False, sql, "Query too long. Please ask a more specific question."

    # Remove markdown code fences if model returned them
    sql = re.sub(r"^```(?:sql)?\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*```$", "", sql)
    sql = sql.strip()

    # Must start with SELECT or WITH (CTEs like "WITH x AS (...) SELECT ...")
    if not re.match(r"^\s*(?:SELECT|WITH)\b", sql, re.IGNORECASE):
        return False, sql, "Only SELECT queries are permitted."

    # Dangerous keyword scan
    match = _DANGEROUS_KEYWORDS.search(sql)
    if match:
        return False, sql, f"Query contains disallowed keyword: {match.group()}."

    # Multiple statements — take only the first SELECT/WITH statement instead of rejecting.
    # deepseek-coder sometimes appends a second statement or trailing comment after ";".
    if ";" in sql:
        first_stmt = sql.split(";")[0].strip()
        if re.match(r"^\s*(?:SELECT|WITH)\b", first_stmt, re.IGNORECASE) and len(first_stmt) > 10:
            sql = first_stmt
        else:
            return False, sql, "Multiple SQL statements are not allowed."

    if sql.count("'") % 2 != 0:
        return False, sql, "Query has an unterminated string literal."

    # sqlparse deep check
    if _HAS_SQLPARSE:
        try:
            parsed = sqlparse.parse(sql)
            if not parsed:
                return False, sql, "Could not parse the generated SQL."
            stmt_type = parsed[0].get_type()
            if stmt_type and stmt_type.upper() != "SELECT":
                return False, sql, f"Expected SELECT, got {stmt_type}."
        except Exception:
            pass

    # Inject LIMIT if missing
    if not _LIMIT_PATTERN.search(sql):
        sql = f"{sql} LIMIT {_MAX_ROWS}"

    # Table whitelist check — reject if any referenced table is outside allowed set
    if allowed_tables:
        allowed_set = {t.lower() for t in allowed_tables}
        referenced = {m.group(1).lower() for m in _TABLE_REF.finditer(sql)}
        forbidden = referenced - allowed_set
        if forbidden:
            return False, sql, f"Query references table(s) not accessible for your role: {', '.join(sorted(forbidden))}."

    # Column-level validation — catches hallucinated qualified column references
    col_ok, col_err = _validate_columns(sql, allowed_tables)
    if not col_ok:
        return False, sql, col_err

    return True, sql, None
