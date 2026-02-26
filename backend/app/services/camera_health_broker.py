"""
Camera Health Broker — in-memory asyncio.Queue registry for admin-scoped SSE delivery.

All admin SSE clients share a single broadcast pool (not keyed by user_id),
so every open /admin/cameras/stream connection receives all camera health and
verification events regardless of which admin account is logged in.

Thread-safe: push() is called from the background scheduler thread and from
sync FastAPI route handlers. The event loop is captured at startup and used
for call_soon_threadsafe().
"""
import asyncio
import threading
import logging
from typing import List

logger = logging.getLogger(__name__)

_queues: List[asyncio.Queue] = []
_lock   = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called once from main.py on_startup to store the running event loop."""
    global _loop
    _loop = loop
    logger.info("[camera_health_broker] Event loop registered")


def register() -> asyncio.Queue:
    """Register a new SSE connection. Returns a fresh Queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=200)
    with _lock:
        _queues.append(q)
    logger.debug("[camera_health_broker] Registered new SSE queue")
    return q


def unregister(q: asyncio.Queue) -> None:
    """Remove a queue when its SSE connection closes."""
    with _lock:
        try:
            _queues.remove(q)
        except ValueError:
            pass
    logger.debug("[camera_health_broker] Unregistered SSE queue")


def push(payload: dict) -> None:
    """
    Broadcast a payload to all active admin SSE connections.
    Thread-safe — safe to call from sync route handlers and background threads.
    Silently no-ops if no active connections or loop not set.
    """
    if _loop is None:
        return
    with _lock:
        queues = list(_queues)
    for q in queues:
        try:
            _loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass  # queue full or closed — ignore
