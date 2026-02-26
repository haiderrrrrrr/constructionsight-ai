"""
Read-only SQL executor with 8-second statement timeout.
Uses the existing SQLAlchemy engine from app.core.db.
Returns rows as list[dict].
"""
from __future__ import annotations

import asyncio
from functools import partial

from sqlalchemy import text

from ...core.db import engine

_STATEMENT_TIMEOUT_MS = 8000
_MAX_ROWS = 500


def _run_query(sql: str, params: dict) -> list[dict]:
    """Synchronous query execution — run inside a thread pool."""
    with engine.connect() as conn:
        conn.execute(text(f"SET LOCAL statement_timeout = {_STATEMENT_TIMEOUT_MS}"))
        result = conn.execute(text(sql), params)
        columns = list(result.keys())
        rows = result.fetchmany(_MAX_ROWS)
        return [dict(zip(columns, row)) for row in rows]


async def execute_query(sql: str, params: dict | None = None) -> list[dict]:
    """
    Execute a (pre-validated) SELECT query asynchronously using a thread pool.
    params: dict of named parameters, e.g. {"project_id": 5}
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, partial(_run_query, sql, params or {}))
