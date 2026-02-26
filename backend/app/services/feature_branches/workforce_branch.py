"""
Workforce Analytics Branch — starts WorkforceProcessor for one camera.

Two operating modes:
  1. PPE pipeline is active → hooks into _workforce_detection_inbox (zero extra GPU)
  2. PPE pipeline is NOT active → starts _workforce_standalone_pipeline (YOLO stage1 + ByteTrack)

Usage (called by branch_manager):
    branch = WorkforceBranch(camera_id)
    branch.start(db)    # loads credentials, starts processor + inbox
    branch.stop()       # stops processor + releases capture ref
    frame = branch.latest_annotated_frame   # latest workforce-overlaid numpy frame or None
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)


class WorkforceBranch:
    def __init__(self, camera_id: int):
        self.camera_id  = camera_id
        self._lock      = threading.Lock()
        self._running   = False
        self._standalone_started = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self, db) -> bool:
        """
        Start Workforce Analytics for this camera.
        `db` — open SQLAlchemy session used to load camera credentials + config.
        Returns True on success.
        """
        with self._lock:
            if self._running:
                return True
            try:
                return self._do_start(db)
            except Exception as e:
                logger.error(f"[WorkforceBranch] Camera {self.camera_id} start error: {e}", exc_info=True)
                return False

    def stop(self) -> None:
        """Stop Workforce Analytics for this camera."""
        with self._lock:
            if not self._running:
                return
            try:
                self._do_stop()
            except Exception as e:
                logger.error(f"[WorkforceBranch] Camera {self.camera_id} stop error: {e}", exc_info=True)

    def is_running(self) -> bool:
        return self._running

    @property
    def latest_annotated_frame(self):
        """Return latest workforce-overlaid frame, or None."""
        try:
            from ...api.routes.ml_stream_enterprise import _workforce_annotated
            entry = _workforce_annotated.get(self.camera_id)
            if entry is None:
                return None
            lock = entry.get("lock")
            if lock is None:
                return entry.get("frame")
            with lock:
                return entry.get("frame")
        except Exception:
            return None

    # ── Internal ───────────────────────────────────────────────────────────────

    def _do_start(self, db) -> bool:
        from ...api.routes.ml_stream_enterprise import (
            _camera_pipelines,
            _camera_pipelines_lock,
            acquire_capture,
            start_workforce_standalone,
            is_workforce_standalone_running,
        )
        from ..workforce_analytics import get_processor, register_processor, WorkforceProcessor
        from ..ml_config_service import load_config
        from ...models.project_camera import ProjectCamera
        from ...models.project import Project, ProjectStatus
        from ...models.zone import Zone
        from ...models.camera import Camera, CameraCredential
        from ...core.crypto import decrypt_credential

        # Load camera
        camera = db.query(Camera).filter(Camera.id == self.camera_id).first()
        if not camera:
            logger.error(f"[WorkforceBranch] Camera {self.camera_id} not found")
            return False

        # Load and decrypt credentials
        credentials = (
            db.query(CameraCredential)
            .filter(CameraCredential.camera_id == self.camera_id)
            .first()
        )
        if not credentials:
            logger.error(f"[WorkforceBranch] Camera {self.camera_id} has no credentials")
            return False

        username = None
        password = None
        rtsp_url_main = None
        rtsp_url_sub  = None

        if credentials.username_enc:
            try: username = decrypt_credential(credentials.username_enc)
            except Exception: pass
        if credentials.password_enc:
            try: password = decrypt_credential(credentials.password_enc)
            except Exception: pass
        if credentials.rtsp_url_enc:
            try: rtsp_url_main = decrypt_credential(credentials.rtsp_url_enc)
            except Exception: pass
        if credentials.rtsp_url_sub_enc:
            try: rtsp_url_sub = decrypt_credential(credentials.rtsp_url_sub_enc)
            except Exception: pass

        def _embed(url, user, pwd):
            if not url or not user or not pwd:
                return url
            if url.startswith("rtsp://"):
                return f"rtsp://{user}:{pwd}@{url[7:]}"
            elif url.startswith("rtsps://"):
                return f"rtsps://{user}:{pwd}@{url[8:]}"
            return url

        if rtsp_url_main:
            rtsp_url_main = _embed(rtsp_url_main, username, password)
        if rtsp_url_sub:
            rtsp_url_sub = _embed(rtsp_url_sub, username, password)

        rtsp_url  = rtsp_url_main or rtsp_url_sub or ""
        transport = credentials.transport_preference or "tcp"

        if not rtsp_url:
            logger.error(f"[WorkforceBranch] Camera {self.camera_id} has no usable RTSP URL")
            return False

        # Find active project for this camera → get zone info
        pc = (
            db.query(ProjectCamera)
            .join(Project, Project.id == ProjectCamera.project_id)
            .filter(
                ProjectCamera.camera_id == self.camera_id,
                Project.status == ProjectStatus.ACTIVE,
            )
            .first()
        )
        if not pc:
            logger.warning(f"[WorkforceBranch] Camera {self.camera_id} not assigned to active project")
            return False

        project_id = pc.project_id
        zone_id    = pc.zone_id
        zone_name  = None
        if zone_id:
            zone = db.query(Zone).filter(Zone.id == zone_id).first()
            zone_name = zone.name if zone else None

        cfg = load_config(db)

        # Merge project-level workforce zone settings so that PM changes
        # (Required Workers, Max Workers, Idle Alert Threshold, Alert Sensitivity)
        # actually take effect in the processor — these are stored in a separate table.
        try:
            from ...models.workforce_zone_settings import WorkforceZoneSettings
            wz = (
                db.query(WorkforceZoneSettings)
                .filter(
                    WorkforceZoneSettings.project_id == project_id,
                    WorkforceZoneSettings.camera_id.is_(None),
                )
                .first()
            )
            if wz:
                if wz.required_workers               is not None:
                    cfg["workforce_understaffed_threshold"]       = wz.required_workers
                if wz.max_workers                    is not None:
                    cfg["workforce_overloaded_threshold"]         = wz.max_workers
                if wz.idle_alert_threshold           is not None:
                    cfg["workforce_idle_alert_threshold"]         = wz.idle_alert_threshold
                if wz.alert_sensitivity              is not None:
                    cfg["alert_sensitivity"]                      = wz.alert_sensitivity
                if wz.understaffed_confirm_samples   is not None:
                    cfg["workforce_understaffed_confirm_samples"] = wz.understaffed_confirm_samples
                if wz.overload_confirm_seconds       is not None:
                    cfg["workforce_overload_confirm_seconds"]     = wz.overload_confirm_seconds
        except Exception as _merge_exc:
            logger.warning(f"[WorkforceBranch] Could not merge zone settings: {_merge_exc}")

        # Create and register WorkforceProcessor
        processor = get_processor(self.camera_id)
        if processor is None:
            processor = WorkforceProcessor(
                camera_id  = self.camera_id,
                project_id = project_id,
                zone_id    = zone_id,
                zone_name  = zone_name or f"Camera {self.camera_id}",
            )
            register_processor(self.camera_id, processor)

        # Start the processor's consumer thread
        processor.start(cfg)

        # Decide whether to use PPE pipeline inbox or standalone
        with _camera_pipelines_lock:
            ppe_running = (
                self.camera_id in _camera_pipelines
                and not _camera_pipelines[self.camera_id]["stop"].is_set()
            )

        if ppe_running:
            # Mode 1: PPE pipeline provides detections via inbox — just acquire capture ref
            acquire_capture(self.camera_id, rtsp_url, transport)
            self._standalone_started = False
            logger.info(
                f"[WorkforceBranch] Camera {self.camera_id}: hooking into PPE inbox "
                f"(project={project_id}, zone={zone_name})"
            )
        else:
            # Mode 2: Start standalone YOLO stage1 + ByteTrack
            if not is_workforce_standalone_running(self.camera_id):
                acquire_capture(self.camera_id, rtsp_url, transport)
                start_workforce_standalone(self.camera_id, rtsp_url, transport)
                self._standalone_started = True
            logger.info(
                f"[WorkforceBranch] Camera {self.camera_id}: standalone pipeline started "
                f"(project={project_id}, zone={zone_name})"
            )

        self._running = True
        return True

    def _do_stop(self) -> None:
        from ...api.routes.ml_stream_enterprise import (
            release_capture,
            stop_workforce_standalone,
        )
        from ..workforce_analytics import get_processor, unregister_processor

        processor = get_processor(self.camera_id)
        if processor is not None:
            processor.stop()
            unregister_processor(self.camera_id)

        if self._standalone_started:
            stop_workforce_standalone(self.camera_id)
            self._standalone_started = False

        release_capture(self.camera_id)
        self._running = False
        logger.info(f"[WorkforceBranch] Camera {self.camera_id} stopped")


def _build_merged_cfg(db, project_id: int) -> dict:
    """Return a fresh cfg dict with WorkforceZoneSettings merged in. Used for hot-reload."""
    from ...services.ml_config_service import load_config
    from ...models.workforce_zone_settings import WorkforceZoneSettings
    cfg = load_config(db)
    wz = (
        db.query(WorkforceZoneSettings)
        .filter(
            WorkforceZoneSettings.project_id == project_id,
            WorkforceZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if wz:
        if wz.required_workers               is not None:
            cfg["workforce_understaffed_threshold"]    = wz.required_workers
        if wz.max_workers                    is not None:
            cfg["workforce_overloaded_threshold"]      = wz.max_workers
        if wz.idle_alert_threshold           is not None:
            cfg["workforce_idle_alert_threshold"]      = wz.idle_alert_threshold
        if wz.alert_sensitivity              is not None:
            cfg["alert_sensitivity"]                   = wz.alert_sensitivity
        if wz.understaffed_confirm_samples   is not None:
            cfg["workforce_understaffed_confirm_samples"] = wz.understaffed_confirm_samples
        if wz.overload_confirm_seconds       is not None:
            cfg["workforce_overload_confirm_seconds"]  = wz.overload_confirm_seconds
    return cfg
