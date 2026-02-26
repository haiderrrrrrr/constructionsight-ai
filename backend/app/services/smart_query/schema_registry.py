"""
Dynamic Schema Registry for the Smart Query Assistant.

Replaces the static TABLE_SCHEMAS dict in schema_context.py.

On startup (and optionally on-demand via the /schema/reload endpoint), reads the
real PostgreSQL schema from information_schema and merges it with human-authored
business annotations from business_annotations.py.

This solves the changing-DB problem: add a column in main.py:on_startup(), restart
the server, and the Smart Query Assistant sees the new column automatically. No
manual sync required.

Key design:
  - DB columns/types come from information_schema (always current)
  - Business meanings come from TABLE_ANNOTATIONS (human knowledge overlay)
  - FK relationships come from information_schema.table_constraints
  - Enum values come from pg_type / pg_enum
  - All merged into a single formatted string per table for LLM prompt injection
"""
from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# ── Column type display mapping ───────────────────────────────────────────────

_TYPE_MAP: dict[str, str] = {
    "integer": "INTEGER",
    "bigint": "BIGINT",
    "smallint": "SMALLINT",
    "serial": "SERIAL",
    "bigserial": "BIGSERIAL",
    "character varying": "VARCHAR",
    "character": "CHAR",
    "text": "TEXT",
    "boolean": "BOOLEAN",
    "numeric": "NUMERIC",
    "real": "FLOAT",
    "double precision": "FLOAT",
    "timestamp with time zone": "TIMESTAMPTZ",
    "timestamp without time zone": "TIMESTAMP",
    "date": "DATE",
    "time without time zone": "TIME",
    "time with time zone": "TIMETZ",
    "json": "JSON",
    "jsonb": "JSONB",
    "uuid": "UUID",
    "bytea": "BYTEA",
    "inet": "INET",
    "interval": "INTERVAL",
}

# Tables excluded from registry (internal auth / sensitive)
_EXCLUDED_TABLES = frozenset({"alembic_version"})

# Columns that should never be selected (sensitive / encrypted)
_NEVER_SELECT_COLS: dict[str, frozenset[str]] = {
    "users": frozenset({"password_hash", "avatar"}),
    "camera_credentials": frozenset({
        "rtsp_url_enc", "rtsp_url_sub_enc", "username_enc",
        "password_enc", "onvif_host_enc",
    }),
    "refresh_tokens": frozenset({"token_hash"}),
}


def _friendly_type(pg_type: str) -> str:
    return _TYPE_MAP.get(pg_type.lower(), pg_type.upper())


class SchemaRegistry:
    """
    Singleton that holds a live view of the PostgreSQL schema merged with
    business annotations. Call build(engine) once on startup.
    """

    def __init__(self):
        self._lock = threading.Lock()
        # table_name → list of (col_name, col_type, is_nullable)
        self._columns: dict[str, list[tuple[str, str, bool]]] = {}
        # table_name → list of "table.col → other_table.col" strings
        self._fk_map: dict[str, list[str]] = {}
        # enum_name → list of values
        self._enums: dict[str, list[str]] = {}
        # col_name → enum_name (for annotating columns with their enum values)
        self._col_enum_map: dict[str, dict[str, str]] = {}  # table → {col → enum}
        self._ready = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def build(self, engine) -> None:
        """Introspect DB + merge annotations. Thread-safe. Call once on startup."""
        with self._lock:
            self._introspect(engine)
            self._ready = True
        n = len(self._columns)
        logger.info(f"[schema_registry] Built registry: {n} tables, {len(self._fk_map)} FK entries, {len(self._enums)} enums")

    def reload(self, engine) -> None:
        """Hot-reload without server restart. Same as build()."""
        logger.info("[schema_registry] Hot-reloading schema registry...")
        self.build(engine)

    def get_all_table_names(self) -> list[str]:
        """Return all public table names discovered."""
        return list(self._columns.keys())

    def is_ready(self) -> bool:
        """Return True when the registry has successfully introspected the DB."""
        return self._ready

    def get_table_columns(self, table_name: str) -> list[str]:
        """Return selectable column names for one table, excluding sensitive fields."""
        if not self._ready or table_name not in self._columns:
            return []
        never_select = _NEVER_SELECT_COLS.get(table_name, frozenset())
        return [
            col_name
            for col_name, _col_type, _nullable in self._columns[table_name]
            if col_name not in never_select
        ]

    def get_column_lookup(self) -> dict[str, frozenset[str]]:
        """Return table -> selectable columns for validator use."""
        if not self._ready:
            return {}
        return {
            table: frozenset(self.get_table_columns(table))
            for table in self._columns
        }

    def get_table_schema_text(self, table_name: str) -> str:
        """
        Return a formatted schema string for one table, merging real columns with
        business annotations. Returns '' if table is unknown.
        """
        if not self._ready or table_name not in self._columns:
            return ""

        from .business_annotations import TABLE_ANNOTATIONS
        annotations = TABLE_ANNOTATIONS.get(table_name, {})
        never_select = _NEVER_SELECT_COLS.get(table_name, frozenset())
        col_enum = self._col_enum_map.get(table_name, {})

        lines: list[str] = []

        table_desc = annotations.get("__table__", "")
        header = f"{table_name}("
        if table_desc:
            header += f"  -- {table_desc}"
        lines.append(header)

        for col_name, col_type, nullable in self._columns[table_name]:
            if col_name in never_select:
                lines.append(f"  -- {col_name}: SENSITIVE — NEVER SELECT")
                continue

            null_str = "" if nullable else " NOT NULL"

            # Check if this column has a known enum type
            enum_name = col_enum.get(col_name)
            if enum_name and enum_name in self._enums:
                enum_vals = ", ".join(self._enums[enum_name])
                type_str = f"VARCHAR [{enum_vals}]"
            else:
                type_str = f"{col_type}{null_str}"

            # Business annotation for this column
            note = annotations.get(col_name, "")
            suffix = f"  -- {note}" if note else ""
            lines.append(f"  {col_name} {type_str}{suffix}")

        lines.append(")")

        # FK relationships
        fks = self._fk_map.get(table_name, [])
        for fk in fks:
            lines.append(f"FK: {fk}")

        # Business rules
        rules = annotations.get("__rules__", "")
        if rules:
            lines.append("-- BUSINESS RULES:")
            for rule_line in rules.split("\n"):
                lines.append(f"-- {rule_line}")

        return "\n".join(lines)

    def get_relationship_text(self, table_names: list[str]) -> str:
        """Return FK relationship lines for the given tables, for prompt injection."""
        if not self._ready:
            return ""
        lines: list[str] = []
        seen: set[str] = set()
        for t in table_names:
            for fk in self._fk_map.get(t, []):
                if fk not in seen:
                    lines.append(fk)
                    seen.add(fk)
        return "\n".join(lines)

    def get_schema_texts(self, table_names: list[str]) -> str:
        """Return concatenated schema text for multiple tables."""
        parts = [self.get_table_schema_text(t) for t in table_names]
        return "\n\n".join(p for p in parts if p)

    # ── Internal introspection ─────────────────────────────────────────────────

    def _introspect(self, engine) -> None:
        from sqlalchemy import text as sql_text

        with engine.connect() as conn:
            self._columns = self._read_columns(conn, sql_text)
            self._fk_map = self._read_fks(conn, sql_text)
            enums, col_enum = self._read_enums(conn, sql_text)
            self._enums = enums
            self._col_enum_map = col_enum

    def _read_columns(self, conn, sql_text) -> dict[str, list[tuple[str, str, bool]]]:
        rows = conn.execute(sql_text("""
            SELECT table_name, column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
        """)).fetchall()

        result: dict[str, list[tuple[str, str, bool]]] = {}
        for table_name, col_name, data_type, is_nullable in rows:
            if table_name in _EXCLUDED_TABLES:
                continue
            result.setdefault(table_name, []).append((
                col_name,
                _friendly_type(data_type),
                is_nullable.upper() == "YES",
            ))
        return result

    def _read_fks(self, conn, sql_text) -> dict[str, list[str]]:
        rows = conn.execute(sql_text("""
            SELECT
                tc.table_name,
                kcu.column_name,
                ccu.table_name  AS foreign_table,
                ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
                ON tc.constraint_name = kcu.constraint_name
                AND tc.table_schema   = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
                ON ccu.constraint_name = tc.constraint_name
                AND ccu.table_schema   = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema    = 'public'
            ORDER BY tc.table_name, kcu.column_name
        """)).fetchall()

        result: dict[str, list[str]] = {}
        for table_name, col_name, foreign_table, foreign_col in rows:
            line = f"{table_name}.{col_name} → {foreign_table}.{foreign_col}"
            result.setdefault(table_name, []).append(line)
        return result

    def _read_enums(
        self, conn, sql_text
    ) -> tuple[dict[str, list[str]], dict[str, dict[str, str]]]:
        """
        Returns:
          enums: {enum_name: [value1, value2, ...]}
          col_enum: {table_name: {col_name: enum_name}}
        """
        # Read enum definitions
        enum_rows = conn.execute(sql_text("""
            SELECT t.typname AS enum_name, e.enumlabel AS enum_value
            FROM pg_type t
            JOIN pg_enum e ON t.oid = e.enumtypid
            ORDER BY t.typname, e.enumsortorder
        """)).fetchall()

        enums: dict[str, list[str]] = {}
        for enum_name, value in enum_rows:
            enums.setdefault(enum_name, []).append(value)

        # Read which columns use which enum types
        col_enum: dict[str, dict[str, str]] = {}
        if enums:
            udt_rows = conn.execute(sql_text("""
                SELECT table_name, column_name, udt_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND udt_name = ANY(:enum_names)
            """), {"enum_names": list(enums.keys())}).fetchall()

            for table_name, col_name, udt_name in udt_rows:
                col_enum.setdefault(table_name, {})[col_name] = udt_name

        return enums, col_enum


# ── Module-level singleton ────────────────────────────────────────────────────

registry = SchemaRegistry()
