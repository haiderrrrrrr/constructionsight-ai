"""
Risk Dashboard Broker — in-memory per-project asyncio.Queue registry for SSE delivery.

Keyed by project_id so every browser tab viewing a project's Risk dashboard receives
risk_stats_update events in real-time without polling.

Thread-safe: push() is called from the risk scheduler thread (running in app_stream).
The event loop is captured at app_stream startup and used for call_soon_threadsafe().
"""
import asyncio
import threading
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

_queues: Dict[int, List[asyncio.Queue]] = {}
_lock   = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop
    logger.info("[risk_dashboard_broker] Event loop registered")


def register(project_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    with _lock:
        if project_id not in _queues:
            _queues[project_id] = []
        _queues[project_id].append(q)
    logger.debug(f"[risk_dashboard_broker] Registered queue for project {project_id}")
    return q


def unregister(project_id: int, q: asyncio.Queue) -> None:
    with _lock:
        lst = _queues.get(project_id, [])
        if q in lst:
            lst.remove(q)
        if not lst:
            _queues.pop(project_id, None)
    logger.debug(f"[risk_dashboard_broker] Unregistered queue for project {project_id}")


def push(project_id: int, payload: dict) -> None:
    """Push payload to all active SSE connections for project_id. Thread-safe."""
    if _loop is None:
        return
    with _lock:
        queues = list(_queues.get(project_id, []))
    for q in queues:
        try:
            _loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass
