"""
PPE Branch — wrapper around ml_stream_enterprise pipeline for one camera.

Delegates all actual inference to the existing _get_or_create_pipeline /
start_camera_background / stop_camera_background functions so that no logic
is duplicated and all model singletons, ReID, FAISS, and state machine
behaviour stay exactly the same.

Usage (called by branch_manager):
    branch = PPEBranch(camera_id)
    branch.start(db)   # loads credentials, opens RTSP, starts inference
    branch.stop()      # stops pipeline
    frame = branch.latest_annotated_frame   # latest annotated numpy frame or None
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)


class PPEBranch:
    """
    Thin wrapper that controls the existing ml_stream_enterprise pipeline
    for a single camera, exposing start / stop / latest_annotated_frame.
    """

    def __init__(self, camera_id: int):
        self.camera_id = camera_id
        self._lock = threading.Lock()

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self, db) -> bool:
        """
        Start PPE inference for this camera.
        `db` — open SQLAlchemy session (used to load credentials + config).
        Returns True on success.
        """
        with self._lock:
            try:
                from ...api.routes.ml_stream_enterprise import start_camera_background
                ok = start_camera_background(self.camera_id, db)
                if ok:
                    logger.info(f"[PPEBranch] Camera {self.camera_id} PPE branch started")
                else:
                    logger.warning(
                        f"[PPEBranch] Camera {self.camera_id} PPE branch failed to start"
                    )
                return ok
            except Exception as e:
                logger.error(f"[PPEBranch] Camera {self.camera_id} start error: {e}")
                return False

    def stop(self) -> None:
        """Stop PPE inference for this camera."""
        with self._lock:
            try:
                from ...api.routes.ml_stream_enterprise import stop_camera_background
                stop_camera_background(self.camera_id)
                logger.info(f"[PPEBranch] Camera {self.camera_id} PPE branch stopped")
            except Exception as e:
                logger.error(f"[PPEBranch] Camera {self.camera_id} stop error: {e}")

    def is_running(self) -> bool:
        """Return True if the underlying pipeline is active."""
        try:
            from ...api.routes.ml_stream_enterprise import (
                _camera_pipelines,
                _camera_pipelines_lock,
            )
            with _camera_pipelines_lock:
                pipeline = _camera_pipelines.get(self.camera_id)
            return pipeline is not None and not pipeline["stop"].is_set()
        except Exception:
            return False

    @property
    def latest_annotated_frame(self):
        """Return the latest annotated numpy frame from the pipeline, or None."""
        try:
            from ...api.routes.ml_stream_enterprise import (
                _camera_pipelines,
                _camera_pipelines_lock,
            )
            with _camera_pipelines_lock:
                pipeline = _camera_pipelines.get(self.camera_id)
            if pipeline is None or pipeline["stop"].is_set():
                return None
            annotated = pipeline["annotated"]
            with annotated["lock"]:
                return annotated["frame"]
        except Exception:
            return None
