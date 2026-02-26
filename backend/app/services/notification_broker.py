"""
Notification Broker — in-memory per-user asyncio.Queue registry for SSE delivery.

Thread-safe: push() is called from sync route handlers and background threads.
The event loop is captured at startup and used for call_soon_threadsafe().
"""
import asyncio
import threading
import logging
from typing import Dict, List

logger = logging.getLogger(__name__)

_queues: Dict[int, List[asyncio.Queue]] = {}   # user_id → list of active queues
_lock   = threading.Lock()
_loop: asyncio.AbstractEventLoop | None = None


def set_event_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Called once from main.py on_startup to store the running event loop."""
    global _loop
    _loop = loop
    logger.info("[notification_broker] Event loop registered")


def register(user_id: int) -> asyncio.Queue:
    """Register a new SSE connection for user_id. Returns a fresh Queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    with _lock:
        if user_id not in _queues:
            _queues[user_id] = []
        _queues[user_id].append(q)
    logger.debug(f"[notification_broker] Registered queue for user {user_id}")
    return q


def unregister(user_id: int, q: asyncio.Queue) -> None:
    """Remove a queue when its SSE connection closes."""
    with _lock:
        lst = _queues.get(user_id, [])
        if q in lst:
            lst.remove(q)
        if not lst:
            _queues.pop(user_id, None)
    logger.debug(f"[notification_broker] Unregistered queue for user {user_id}")


def push(user_id: int, payload: dict) -> None:
    """
    Push a notification payload to all active SSE connections for user_id.
    Thread-safe — safe to call from sync route handlers and background threads.
    Silently no-ops if user has no active SSE connection or loop not set.
    """
    if _loop is None:
        return
    with _lock:
        queues = list(_queues.get(user_id, []))
    for q in queues:
        try:
            _loop.call_soon_threadsafe(q.put_nowait, payload)
        except Exception:
            pass  # queue full or closed — ignore
