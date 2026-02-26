"""
Simple in-memory LRU cache for query responses.
Key: sha256(role + str(project_id) + normalized_question)
TTL: 5 minutes
Max entries: 100
"""
from __future__ import annotations

import hashlib
import time
from collections import OrderedDict

_TTL = 300  # 5 minutes
_MAX = 100
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()


def _make_key(role: str, project_id: int | None, question: str) -> str:
    raw = f"{role}:{project_id}:{question.lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()


def get(role: str, project_id: int | None, question: str) -> dict | None:
    key = _make_key(role, project_id, question)
    if key not in _cache:
        return None
    ts, value = _cache[key]
    if time.monotonic() - ts > _TTL:
        del _cache[key]
        return None
    _cache.move_to_end(key)
    return value


def set(role: str, project_id: int | None, question: str, value: dict):
    key = _make_key(role, project_id, question)
    _cache[key] = (time.monotonic(), value)
    _cache.move_to_end(key)
    if len(_cache) > _MAX:
        _cache.popitem(last=False)


def invalidate_all():
    _cache.clear()
