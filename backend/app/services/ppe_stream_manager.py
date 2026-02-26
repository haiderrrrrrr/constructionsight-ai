"""
PPE Stream Manager — orchestrates always-on background inference pipelines.

Responsibilities:
  - On server startup: query all cameras in ACTIVE projects with ppe_enabled=True
    and start background inference for each.
  - On project activation: start inference for all eligible cameras in that project.
  - On project archive / ppe toggle off: stop inference for affected cameras.

Uses start_camera_background / stop_camera_background from ml_stream_enterprise
so the YOLO + ReID pipeline code stays in one place.
"""

import logging
import threading

logger = logging.getLogger(__name__)

# Guard against double-startup (FastAPI may call on_startup twice in test reload)
_startup_done = False
_startup_lock = threading.Lock()


def _get_ml_fns():
    """Lazy import to avoid circular import at module load time."""
    from ..api.routes.ml_stream_enterprise import start_camera_background, stop_camera_background
    return start_camera_background, stop_camera_background


def start_all_active():
    """
    Called once from main.py on_startup.
    Feature branches are controlled exclusively via the Live View camera cards.
    On restart, inference does NOT auto-start — users must re-enable via the cards.
    This ensures cameras are off by default and users have explicit control.
    """
    global _startup_done
    with _startup_lock:
        if _startup_done:
            return
        _startup_done = True

    logger.info(
        "[ppe_stream_manager] Server started. "
        "PPE inference is OFF by default — enable per-camera via Live View cards."
    )


def start_project_cameras(project_id: int, db):
    """
    Called when a project is activated (POST /projects/{id}/activate).
    Starts inference for all cameras in the project that have ppe_enabled=True.
    Skips cameras that are already running.
    """
    from ..models.project_camera import ProjectCamera
    from ..models.project_camera_analytics import ProjectCameraAnalytics

    start_fn, _ = _get_ml_fns()

    rows = (
        db.query(ProjectCamera.camera_id)
        .join(
            ProjectCameraAnalytics,
            ProjectCameraAnalytics.project_camera_id == ProjectCamera.id,
        )
        .filter(
            ProjectCamera.project_id == project_id,
            ProjectCameraAnalytics.ppe_enabled == True,
        )
        .all()
    )

    camera_ids = [r.camera_id for r in rows]
    logger.info(f"[ppe_stream_manager] Starting {len(camera_ids)} camera(s) for project {project_id}")

    for camera_id in camera_ids:
        try:
            start_fn(camera_id, db)
        except Exception as e:
            logger.warning(f"[ppe_stream_manager] Camera {camera_id} start error: {e}")


def stop_project_cameras(project_id: int, db):
    """
    Called when a project is archived.
    Stops inference for all cameras in the project.
    """
    from ..models.project_camera import ProjectCamera

    _, stop_fn = _get_ml_fns()

    rows = db.query(ProjectCamera.camera_id).filter(
        ProjectCamera.project_id == project_id
    ).all()

    for row in rows:
        try:
            stop_fn(row.camera_id)
        except Exception as e:
            logger.warning(f"[ppe_stream_manager] Camera {row.camera_id} stop error: {e}")
        try:
            from . import branch_manager as _bm
            _bm.stop_all_for_camera(row.camera_id)
        except Exception as e:
            logger.warning(f"[ppe_stream_manager] branch_manager stop error for {row.camera_id}: {e}")
