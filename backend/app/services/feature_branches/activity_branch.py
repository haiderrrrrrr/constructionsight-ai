"""
Activity Analytics Branch — starts ActivityProcessor for one camera.

Two operating modes:
  1. PPE or Workforce pipeline is active → hooks into _activity_detection_inbox
     (those pipelines also post detections there — zero extra GPU)
  2. Neither PPE nor Workforce is active → starts _activity_standalone_pipeline
     (own YOLO stage1 + ByteTrack)

Usage (called by branch_manager):
    branch = ActivityBranch(camera_id)
    branch.start(db)    # loads credentials, starts processor + inbox
    branch.stop()       # stops processor + releases capture ref
    frame = branch.latest_annotated_frame   # latest activity-overlaid numpy frame or None
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)


class ActivityBranch:
    def __init__(self, camera_id: int):
        self.camera_id           = camera_id
        self._lock               = threading.Lock()
        self._running            = False
        self._standalone_started = False

    # ── Public API ─────────────────────────────────────────────────────────────

    def start(self, db) -> bool:
        with self._lock:
            if self._running:
                return True
            try:
                return self._do_start(db)
            except Exception as e:
                logger.error(f"[ActivityBranch] Camera {self.camera_id} start error: {e}",
                             exc_info=True)
                return False

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            try:
                self._do_stop()
            except Exception as e:
                logger.error(f"[ActivityBranch] Camera {self.camera_id} stop error: {e}",
                             exc_info=True)

    def is_running(self) -> bool:
        return self._running

    @property
    def latest_annotated_frame(self):
        """Return latest activity-overlaid frame, or None."""
        try:
            from ...api.routes.ml_stream_enterprise import _activity_annotated
            entry = _activity_annotated.get(self.camera_id)
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
            start_activity_standalone,
            is_activity_standalone_running,
            is_workforce_standalone_running,
        )
        from ..activity_analytics import get_processor, register_processor, ActivityProcessor
        from ..ml_config_service import load_config
        from ...models.project_camera import ProjectCamera
        from ...models.project import Project, ProjectStatus
        from ...models.zone import Zone
        from ...models.camera import Camera, CameraCredential
        from ...core.crypto import decrypt_credential

        # Load camera
        camera = db.query(Camera).filter(Camera.id == self.camera_id).first()
        if not camera:
            logger.error(f"[ActivityBranch] Camera {self.camera_id} not found")
            return False

        # Load and decrypt credentials
        credentials = (
            db.query(CameraCredential)
            .filter(CameraCredential.camera_id == self.camera_id)
            .first()
        )
        if not credentials:
            logger.error(f"[ActivityBranch] Camera {self.camera_id} has no credentials")
            return False

        username = password = rtsp_url_main = rtsp_url_sub = None

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
            logger.error(f"[ActivityBranch] Camera {self.camera_id} has no usable RTSP URL")
            return False

        # Find active project → zone info
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
            logger.warning(
                f"[ActivityBranch] Camera {self.camera_id} not assigned to active project"
            )
            return False

        project_id = pc.project_id
        zone_id    = pc.zone_id
        zone_name  = None
        if zone_id:
            zone = db.query(Zone).filter(Zone.id == zone_id).first()
            zone_name = zone.name if zone else None

        cfg = load_config(db)

        # Merge project-level activity zone settings
        try:
            from ...models.activity_zone_settings import ActivityZoneSettings
            az = (
                db.query(ActivityZoneSettings)
                .filter(
                    ActivityZoneSettings.project_id == project_id,
                    ActivityZoneSettings.camera_id.is_(None),
                )
                .first()
            )
            if az:
                if az.idle_threshold_seconds  is not None:
                    cfg["activity_idle_threshold_seconds"]  = az.idle_threshold_seconds
                if az.alert_idle_minutes       is not None:
                    cfg["activity_alert_idle_minutes"]      = az.alert_idle_minutes
                if az.low_activity_threshold   is not None:
                    cfg["activity_low_activity_threshold"]  = az.low_activity_threshold
                if az.movement_thresh_px       is not None:
                    cfg["activity_movement_thresh_px"]      = az.movement_thresh_px
                if az.stationary_thresh_secs   is not None:
                    cfg["activity_stationary_thresh_secs"]  = az.stationary_thresh_secs
                if az.alert_sensitivity        is not None:
                    cfg["alert_sensitivity"]                = az.alert_sensitivity
                if az.optical_flow_weight      is not None:
                    cfg["activity_optical_flow_weight"]     = az.optical_flow_weight
        except Exception as _merge_exc:
            logger.warning(f"[ActivityBranch] Could not merge zone settings: {_merge_exc}")

        # Create and register ActivityProcessor
        processor = get_processor(self.camera_id)
        if processor is None:
            processor = ActivityProcessor(
                camera_id  = self.camera_id,
                project_id = project_id,
                zone_id    = zone_id,
                zone_name  = zone_name or f"Camera {self.camera_id}",
            )
            register_processor(self.camera_id, processor)

        # Start processor consumer thread
        processor.start(cfg)

        # Decide mode: hook into existing pipeline inbox or start standalone
        with _camera_pipelines_lock:
            ppe_running = (
                self.camera_id in _camera_pipelines
                and not _camera_pipelines[self.camera_id]["stop"].is_set()
            )

        wf_standalone_running = is_workforce_standalone_running(self.camera_id)

        if ppe_running or wf_standalone_running:
            # Mode 1: PPE or Workforce pipeline posts to activity inbox — just acquire capture ref
            acquire_capture(self.camera_id, rtsp_url, transport)
            self._standalone_started = False
            logger.info(
                f"[ActivityBranch] Camera {self.camera_id}: hooking into existing pipeline inbox "
                f"(project={project_id}, zone={zone_name}, "
                f"ppe={ppe_running}, wf_standalone={wf_standalone_running})"
            )
        else:
            # Mode 2: Start activity standalone YOLO stage1 + ByteTrack
            if not is_activity_standalone_running(self.camera_id):
                acquire_capture(self.camera_id, rtsp_url, transport)
                start_activity_standalone(self.camera_id, rtsp_url, transport)
                self._standalone_started = True
            logger.info(
                f"[ActivityBranch] Camera {self.camera_id}: standalone pipeline started "
                f"(project={project_id}, zone={zone_name})"
            )

        self._running = True
        return True

    def _do_stop(self) -> None:
        from ...api.routes.ml_stream_enterprise import (
            release_capture,
            stop_activity_standalone,
        )
        from ..activity_analytics import get_processor, unregister_processor

        processor = get_processor(self.camera_id)
        if processor is not None:
            processor.stop()
            unregister_processor(self.camera_id)

        if self._standalone_started:
            stop_activity_standalone(self.camera_id)
            self._standalone_started = False

        release_capture(self.camera_id)
        self._running = False
        logger.info(f"[ActivityBranch] Camera {self.camera_id} stopped")
