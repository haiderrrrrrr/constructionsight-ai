"""
Camera Runtime — shared RTSP capture + latest-frame store per camera.

One CameraRuntime per camera. Multiple feature branches (PPE, Activity, etc.)
read the same latest frame without opening the RTSP stream more than once.

Usage:
    from app.services.camera_runtime import get_or_create_runtime

    runtime = get_or_create_runtime(camera_id, rtsp_url, transport)
    frame = runtime.get_latest_frame()   # returns (frame, seq) or (None, -1)
    runtime.stop()
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Optional

logger = logging.getLogger(__name__)

# ── Registry: one CameraRuntime per camera_id ────────────────────────────────
_runtimes: dict[int, "CameraRuntime"] = {}
_runtimes_lock = threading.Lock()


def get_or_create_runtime(
    camera_id: int,
    rtsp_url: str,
    transport: str = "tcp",
) -> "CameraRuntime":
    """Return existing running runtime or create a new one."""
    with _runtimes_lock:
        existing = _runtimes.get(camera_id)
        if existing is not None and existing.is_alive():
            return existing
        rt = CameraRuntime(camera_id, rtsp_url, transport)
        rt.start()
        _runtimes[camera_id] = rt
        return rt


def get_runtime(camera_id: int) -> Optional["CameraRuntime"]:
    """Return existing runtime for camera or None."""
    with _runtimes_lock:
        return _runtimes.get(camera_id)


def stop_runtime(camera_id: int) -> None:
    """Stop and remove runtime for a camera."""
    with _runtimes_lock:
        rt = _runtimes.pop(camera_id, None)
    if rt:
        rt.stop()


class CameraRuntime:
    """
    Owns RTSP capture + reader thread for one camera.
    Stores the latest decoded frame for consumption by feature branches.
    """

    def __init__(self, camera_id: int, rtsp_url: str, transport: str = "tcp"):
        self.camera_id = camera_id
        self._rtsp_url = rtsp_url
        self._transport = transport

        self._latest_frame = None
        self._latest_seq: int = -1
        self._frame_lock = threading.Lock()

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._cap = None

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self) -> None:
        """Start the reader thread."""
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._reader,
            name=f"cam-reader-{self.camera_id}",
            daemon=True,
        )
        self._thread.start()
        logger.info(f"[CameraRuntime] Camera {self.camera_id} reader started")

    def stop(self) -> None:
        """Signal reader to stop and release capture."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._release_cap()
        logger.info(f"[CameraRuntime] Camera {self.camera_id} reader stopped")

    def is_alive(self) -> bool:
        return (
            self._thread is not None
            and self._thread.is_alive()
            and not self._stop_event.is_set()
        )

    def get_latest_frame(self):
        """Return (frame_copy, seq). Returns (None, -1) if no frame yet."""
        with self._frame_lock:
            if self._latest_frame is None:
                return None, -1
            return self._latest_frame.copy(), self._latest_seq

    # ── Internal ───────────────────────────────────────────────────────────────

    def _open_cap(self):
        """Open RTSP capture via FFmpeg MJPEG pipe (imported lazily)."""
        try:
            from ..api.routes.ml_stream_enterprise import _FFmpegMJPEGCapture
            cap = _FFmpegMJPEGCapture(self._rtsp_url, self._transport)
            if cap.isOpened():
                self._cap = cap
                return True
            logger.error(f"[CameraRuntime] Camera {self.camera_id}: FFmpeg pipe not opened")
            return False
        except Exception as e:
            logger.error(f"[CameraRuntime] Camera {self.camera_id} open failed: {e}")
            return False

    def _release_cap(self):
        if self._cap is not None:
            try:
                self._cap.release()
            except Exception:
                pass
            self._cap = None

    def _update_db_status(self, status: str) -> None:
        """Update camera.worker_status in DB (best-effort, non-blocking)."""
        try:
            from ..core.db import SessionLocal
            from ..models.camera import Camera
            db = SessionLocal()
            try:
                cam = db.query(Camera).filter(Camera.id == self.camera_id).first()
                if cam:
                    cam.worker_status = status
                    db.commit()
            finally:
                db.close()
        except Exception as e:
            logger.debug(f"[CameraRuntime] DB status update failed for {self.camera_id}: {e}")

    def _reader(self) -> None:
        if not self._open_cap():
            self._update_db_status("error")
            return

        consecutive_failures = 0
        seq = 0

        while not self._stop_event.is_set():
            ret, frame = self._cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    logger.error(
                        f"[CameraRuntime] Camera {self.camera_id} disconnected"
                    )
                    self._update_db_status("error")
                    self._stop_event.set()
                    break
                time.sleep(0.1)
                continue

            consecutive_failures = 0
            seq += 1
            with self._frame_lock:
                self._latest_frame = frame
                self._latest_seq = seq

        self._release_cap()
