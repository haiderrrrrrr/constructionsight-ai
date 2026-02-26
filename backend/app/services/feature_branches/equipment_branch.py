"""
Equipment Detection Branch — starts EquipmentProcessor for one camera.

Two operating modes:
  1. Any pipeline is already reading frames → hooks into _equipment_detection_inbox
     (Grounding DINO runs in the standalone detector thread, or PPE triggers it)
  2. No pipeline active → starts _equipment_standalone_pipeline
     (RTSP reader + Grounding DINO thread-pool detector)

Usage (called by branch_manager):
    branch = EquipmentBranch(camera_id)
    branch.start(db)    # loads credentials, starts processor + inbox
    branch.stop()       # stops processor + releases capture ref
    frame = branch.latest_annotated_frame   # latest equipment-overlaid numpy frame or None
"""

from __future__ import annotations

import logging
import threading
from typing import Optional

logger = logging.getLogger(__name__)


class EquipmentBranch:
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
                logger.error(f"[EquipmentBranch] Camera {self.camera_id} start error: {e}", exc_info=True)
                return False

    def stop(self) -> None:
        with self._lock:
            if not self._running:
                return
            try:
                self._do_stop()
            except Exception as e:
                logger.error(f"[EquipmentBranch] Camera {self.camera_id} stop error: {e}", exc_info=True)

    def is_running(self) -> bool:
        return self._running

    @property
    def latest_annotated_frame(self):
        try:
            from ...api.routes.ml_stream_enterprise import _equipment_annotated
            entry = _equipment_annotated.get(self.camera_id)
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
            start_equipment_standalone,
            is_equipment_standalone_running,
        )
        from ..equipment_analytics import get_processor, register_processor, EquipmentProcessor
        from ..ml_config_service import load_config
        from ...models.project_camera import ProjectCamera
        from ...models.project import Project, ProjectStatus
        from ...models.zone import Zone
        from ...models.camera import Camera, CameraCredential
        from ...core.crypto import decrypt_credential

        camera = db.query(Camera).filter(Camera.id == self.camera_id).first()
        if not camera:
            logger.error(f"[EquipmentBranch] Camera {self.camera_id} not found")
            return False

        credentials = (
            db.query(CameraCredential)
            .filter(CameraCredential.camera_id == self.camera_id)
            .first()
        )
        if not credentials:
            logger.error(f"[EquipmentBranch] Camera {self.camera_id} has no credentials")
            return False

        username      = None
        password      = None
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
            rtsp_url_sub  = _embed(rtsp_url_sub,  username, password)

        rtsp_url  = rtsp_url_main or rtsp_url_sub or ""
        transport = credentials.transport_preference or "tcp"

        if not rtsp_url:
            logger.error(f"[EquipmentBranch] Camera {self.camera_id} has no usable RTSP URL")
            return False

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
            logger.warning(f"[EquipmentBranch] Camera {self.camera_id} not in active project")
            return False

        project_id = pc.project_id
        zone_id    = pc.zone_id
        zone_name  = None
        if zone_id:
            zone = db.query(Zone).filter(Zone.id == zone_id).first()
            zone_name = zone.name if zone else None

        cfg = load_config(db)

        # Merge equipment zone settings
        try:
            from ...models.equipment_zone_settings import EquipmentZoneSettings
            ez = (
                db.query(EquipmentZoneSettings)
                .filter(
                    EquipmentZoneSettings.project_id == project_id,
                    EquipmentZoneSettings.camera_id.is_(None),
                )
                .first()
            )
            if ez:
                if ez.expected_equipment_count    is not None:
                    cfg["equipment_expected_count"]          = ez.expected_equipment_count
                if ez.max_equipment_count          is not None:
                    cfg["equipment_max_count"]               = ez.max_equipment_count
                if ez.idle_alert_threshold_minutes is not None:
                    cfg["equipment_idle_alert_threshold"]    = ez.idle_alert_threshold_minutes
                if ez.overuse_threshold_hours      is not None:
                    cfg["equipment_overuse_threshold_hours"] = ez.overuse_threshold_hours
                if ez.alert_sensitivity            is not None:
                    cfg["alert_sensitivity"]                 = ez.alert_sensitivity
                if ez.confirm_frames               is not None:
                    cfg["equipment_confirm_frames"]          = ez.confirm_frames
        except Exception as _merge_exc:
            logger.warning(f"[EquipmentBranch] Could not merge zone settings: {_merge_exc}")

        # Build Grounding DINO prompt from ml_config
        dino_prompt = cfg.get(
            "equipment_groundingdino_prompt",
            "crane. excavator. concrete truck. dump truck. bulldozer. forklift. compactor.",
        )
        # Normalise: replace commas with periods for Grounding DINO sentence format
        dino_prompt = ". ".join(p.strip() for p in dino_prompt.replace(".", ",").split(",") if p.strip()) + "."
        dino_conf   = float(cfg.get("equipment_stage1_conf", 0.35))

        # Create and register EquipmentProcessor
        processor = get_processor(self.camera_id)
        if processor is None:
            processor = EquipmentProcessor(
                camera_id  = self.camera_id,
                project_id = project_id,
                zone_id    = zone_id,
                zone_name  = zone_name or f"Camera {self.camera_id}",
            )
            register_processor(self.camera_id, processor)

        processor.start(cfg)

        # Decide mode
        with _camera_pipelines_lock:
            ppe_running = (
                self.camera_id in _camera_pipelines
                and not _camera_pipelines[self.camera_id]["stop"].is_set()
            )

        if ppe_running:
            # Mode 1: PPE pipeline is running — acquire shared capture ref only.
            # The main PPE inferencer will post to _equipment_detection_inbox
            # via _run_groundingdino in its thread pool if equipment_enabled is set.
            acquire_capture(self.camera_id, rtsp_url, transport)
            self._standalone_started = False
            logger.info(
                f"[EquipmentBranch] Camera {self.camera_id}: hooking into PPE pipeline "
                f"(project={project_id}, zone={zone_name})"
            )
        else:
            # Mode 2: No PPE — start dedicated Grounding DINO standalone pipeline
            if not is_equipment_standalone_running(self.camera_id):
                acquire_capture(self.camera_id, rtsp_url, transport)
                start_equipment_standalone(
                    self.camera_id, rtsp_url, transport,
                    prompt=dino_prompt, conf_thresh=dino_conf,
                )
                self._standalone_started = True
            logger.info(
                f"[EquipmentBranch] Camera {self.camera_id}: standalone Grounding DINO pipeline started "
                f"(project={project_id}, zone={zone_name})"
            )

        self._running = True
        return True

    def _do_stop(self) -> None:
        from ...api.routes.ml_stream_enterprise import (
            release_capture,
            stop_equipment_standalone,
        )
        from ..equipment_analytics import get_processor, unregister_processor

        processor = get_processor(self.camera_id)
        if processor is not None:
            processor.stop()
            unregister_processor(self.camera_id)

        if self._standalone_started:
            stop_equipment_standalone(self.camera_id)
            self._standalone_started = False

        release_capture(self.camera_id)
        self._running = False
        logger.info(f"[EquipmentBranch] Camera {self.camera_id} stopped")
