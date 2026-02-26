"""
Activity Dashboard Broker — in-memory per-project asyncio.Queue registry for SSE delivery.

Keyed by project_id so every browser tab viewing a project's activity dashboard
receives real-time activity_stats_update and activity_alert events.

Thread-safe: push() is called from ActivityProcessor consumer threads.
The event loop is captured at startup and used for call_soon_threadsafe().
"""
import asyncio
import threading
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

_queues: Dict[int, List[asyncio.Queue]] = {}   # project_id → list of active queues
_lock   = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called once from main.py on_startup to store the running event loop."""
    global _loop
    _loop = loop
    logger.info("[activity_dashboard_broker] Event loop registered")


def register(project_id: int) -> asyncio.Queue:
    """Register a new SSE connection for project_id. Returns a fresh Queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    with _lock:
        if project_id not in _queues:
            _queues[project_id] = []
        _queues[project_id].append(q)
    logger.debug(f"[activity_dashboard_broker] Registered queue for project {project_id}")
    return q


def unregister(project_id: int, q: asyncio.Queue) -> None:
    """Remove a queue when its SSE connection closes."""
    with _lock:
        lst = _queues.get(project_id, [])
        if q in lst:
            lst.remove(q)
        if not lst:
            _queues.pop(project_id, None)
    logger.debug(f"[activity_dashboard_broker] Unregistered queue for project {project_id}")


def push(project_id: int, payload: dict) -> None:
    """
    Push a payload to all active SSE connections for project_id.
    Thread-safe — safe to call from ActivityProcessor threads.
    Silently no-ops if no active connections or loop not set.
    """
    if _loop is None:
        return
    with _lock:
        queues = list(_queues.get(project_id, []))
    for q in queues:
        try:
            _loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass  # queue full or closed — ignore
