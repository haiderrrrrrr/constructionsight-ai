"""
Workforce Event Queue — fire-and-forget bridge between WorkforceProcessor threads and the DB.

Single queue (maxsize=500) handles two event kinds:
  kind="snapshot"  → write WorkforceSnapshot row
  kind="alert"     → write WorkforceAlert row + Notification rows + auto-tasks

Uses threading.Queue so WorkforceProcessor can call try_enqueue() without async/await.
4 daemon worker threads started from main.py on_startup().
"""

import queue
import logging
import threading
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Public queue ──────────────────────────────────────────────────────────────
workforce_queue: queue.Queue = queue.Queue(maxsize=500)

_WORKER_COUNT = 4

# Roles that receive workforce alert notifications and tasks
_NOTIFY_ROLES = ["project_manager", "site_supervisor", "safety_officer"]

# Alert priority by type
_ALERT_PRIORITY = {
    "sudden_drop": "high",
    "overload":    "high",
    "understaffed":    "medium",
    "idle_ratio_high": "medium",
}


# ─────────────────────────────────────────────────────────────────────────────
# PRE-ENQUEUE HELPER
# ─────────────────────────────────────────────────────────────────────────────

def try_enqueue(event: dict) -> bool:
    """
    Attempt to add an event to the workforce queue.
    Returns False (and drops) if the queue is full.
    """
    if workforce_queue.full():
        logger.warning(
            f"[workforce_queue] Queue FULL — dropping {event.get('kind')} "
            f"for camera={event.get('camera_id')}"
        )
        return False
    workforce_queue.put_nowait(event)
    return True


# ─────────────────────────────────────────────────────────────────────────────
# WORKER THREAD
# ─────────────────────────────────────────────────────────────────────────────

def _workforce_worker():
    """Consume workforce_queue and dispatch to snapshot or alert handler."""
    logger.info("[workforce_worker] Started")
    while True:
        event = workforce_queue.get()
        try:
            kind = event.get("kind")
            if kind == "snapshot":
                _process_snapshot(event)
            elif kind == "alert":
                _process_alert(event)
            else:
                logger.warning(f"[workforce_queue] Unknown event kind: {kind!r}")
        except Exception as exc:
            logger.error(f"[workforce_queue] Unhandled error: {exc}", exc_info=True)
        finally:
            workforce_queue.task_done()


# ─────────────────────────────────────────────────────────────────────────────
# SNAPSHOT HANDLER
# ─────────────────────────────────────────────────────────────────────────────

def _process_snapshot(event: dict):
    """Write a WorkforceSnapshot row to the DB."""
    from ..core.db import SessionLocal
    from ..models.workforce_snapshot import WorkforceSnapshot

    camera_id   = event["camera_id"]
    project_id  = event["project_id"]
    trigger     = event.get("trigger", "interval")
    recorded_at = event.get("recorded_at") or datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        snap = WorkforceSnapshot(
            project_id        = project_id,
            camera_id         = camera_id,
            zone_id           = event.get("zone_id"),
            zone_name         = event.get("zone_name"),
            recorded_at       = recorded_at,
            trigger           = trigger,
            worker_count      = event.get("worker_count", 0),
            active_count      = event.get("active_count", 0),
            idle_count        = event.get("idle_count", 0),
            utilization_score = event.get("utilization_score", 0.0),
            zone_status       = event.get("zone_status", "BALANCED"),
            congestion_flag   = event.get("congestion_flag", False),
            avg_dwell_seconds = event.get("avg_dwell_seconds"),
            sparkline_json    = event.get("sparkline_json", "[]"),
        )
        db.add(snap)
        db.commit()
        logger.debug(
            f"[workforce_queue] Snapshot saved: camera={camera_id} "
            f"workers={snap.worker_count} trigger={trigger}"
        )
    except Exception as e:
        logger.error(f"[workforce_queue] Snapshot write failed: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# ALERT HANDLER
# ─────────────────────────────────────────────────────────────────────────────

def _process_alert(event: dict):
    """Write a WorkforceAlert row + Notification rows for key roles + auto-tasks."""
    from ..core.db import SessionLocal
    from ..models.workforce_alert import WorkforceAlert
    from ..models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from ..models.notification import Notification
    from ..models.ppe_incident import PpeIncident  # noqa: F401 — must be imported so SQLAlchemy
    # can resolve the FK on project_tasks.source_incident_id → ppe_incidents.id
    from ..models.camera import Camera

    camera_id      = event["camera_id"]
    project_id     = event["project_id"]
    alert_type     = event["alert_type"]
    severity       = event.get("severity", "medium")
    message        = event.get("message", "")
    triggered_at   = event.get("triggered_at") or datetime.now(timezone.utc)
    snapshot_frame = event.get("snapshot_frame")

    db = SessionLocal()
    try:
        # Fetch camera name for titles
        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        camera_name = camera.name if camera else f"Camera {camera_id}"

        # 1. Write alert row
        alert = WorkforceAlert(
            project_id   = project_id,
            camera_id    = camera_id,
            zone_id      = event.get("zone_id"),
            zone_name    = event.get("zone_name"),
            alert_type   = alert_type,
            severity     = severity,
            message      = message,
            triggered_at = triggered_at,
            status       = "open",
            worker_id    = event.get("worker_id"),
        )
        db.add(alert)
        db.flush()  # get alert.id

        # 2. Save snapshot if present
        if snapshot_frame is not None:
            try:
                import cv2
                success, buf = cv2.imencode(".jpg", snapshot_frame, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if success:
                    snapshot_url = _save_snapshot(buf.tobytes(), alert.id)
                    if snapshot_url:
                        alert.snapshot_url = snapshot_url
            except Exception as snap_exc:
                logger.warning(f"[workforce_queue] Snapshot encode failed: {snap_exc}")

        # 3. Notify key roles (project_manager, site_supervisor, safety_officer)
        notify_roles = [ProjectRole.PROJECT_MANAGER, ProjectRole.SITE_SUPERVISOR, ProjectRole.SAFETY_OFFICER]
        members = (
            db.query(ProjectMembership)
            .filter(
                ProjectMembership.project_id == project_id,
                ProjectMembership.status == MembershipStatus.ACTIVE,
                ProjectMembership.project_role.in_(notify_roles),
            )
            .all()
        )

        title = _alert_title(alert_type, camera_name)
        priority = _ALERT_PRIORITY.get(alert_type, "medium")
        action_url = f"/projects/{project_id}/workforce?camera={camera_id}"

        from ..models.project import Project
        _project   = db.query(Project).filter(Project.id == project_id).first()
        proj_name  = _project.name if _project else f"Project #{project_id}"
        zone_label = event.get("zone_name") or "N/A"
        notif_msg  = f"Project: {proj_name} | Zone: {zone_label} | Camera: {camera_name}"

        notified_user_ids = set()
        for m in members:
            if m.user_id in notified_user_ids:
                continue
            notified_user_ids.add(m.user_id)
            notif = Notification(
                user_id    = m.user_id,
                project_id = project_id,
                camera_id  = camera_id,
                type       = "workforce_alert",
                category   = "workforce",
                priority   = priority,
                title      = title,
                message    = notif_msg,
                action_url = action_url,
            )
            db.add(notif)

        # 4. Auto-task creation (dedup: same camera + alert_type, open, within 60 min)
        _maybe_create_task(db, project_id, camera_id, camera_name, alert_type, alert.id,
                           zone_name=event.get("zone_name"))

        db.commit()
        logger.info(
            f"[workforce_queue] Alert saved: camera={camera_id} type={alert_type} "
            f"severity={severity} notified={len(notified_user_ids)} members"
        )

        # 5. Broadcast workforce alert to dashboard via SSE (instant real-time)
        try:
            from . import workforce_dashboard_broker
            workforce_dashboard_broker.push(project_id, {
                "type": "workforce_alert",
                "alert_id": alert.id,
                "camera_id": camera_id,
                "camera_name": camera_name,
                "zone_name": event.get("zone_name"),
                "alert_type": alert_type,
                "severity": severity,
                "message": message,
                "worker_id": alert.worker_id,
                "triggered_at": triggered_at.isoformat() if triggered_at else None,
                "snapshot_url": alert.snapshot_url,
                "timestamp": triggered_at.isoformat() if triggered_at else None,
            })
        except Exception as e:
            logger.warning(f"[workforce_queue] Dashboard broadcast failed: {e}")

        # 6. Push task_refresh SSE
        try:
            from . import project_task_broker
            project_task_broker.push(project_id, {"type": "task_refresh"})
        except Exception:
            pass

        # 6. Push notification SSE to each notified user
        try:
            from . import notification_broker
            for uid in notified_user_ids:
                notification_broker.push(uid, {
                    "type":       "workforce_alert",
                    "title":      title,
                    "message":    notif_msg,
                    "project_id": project_id,
                    "camera_id":  camera_id,
                    "action_url": action_url,
                    "priority":   priority,
                })
        except Exception:
            pass

    except Exception as e:
        logger.error(f"[workforce_queue] Alert write failed: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()


def _save_snapshot(img_bytes: bytes, alert_id: int) -> str | None:
    """Save JPEG bytes to Cloudinary or local storage. Returns URL or None."""
    try:
        from ..core.config import settings
        if settings.cloudinary_cloud_name and settings.cloudinary_api_key:
            import cloudinary
            import cloudinary.uploader
            from io import BytesIO
            cloudinary.config(
                cloud_name  = settings.cloudinary_cloud_name,
                api_key     = settings.cloudinary_api_key,
                api_secret  = settings.cloudinary_api_secret,
            )
            result = cloudinary.uploader.upload(
                BytesIO(img_bytes),
                folder    = f"workforce_alerts/{alert_id}",
                public_id = "snapshot",
                resource_type = "image",
            )
            return result.get("secure_url")
        else:
            # Local fallback — reuse the /media/snapshots static mount already set up for PPE
            import os
            folder = os.path.join(settings.media_snapshots_dir, "workforce_alerts", str(alert_id))
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, "snapshot.jpg")
            with open(path, "wb") as f:
                f.write(img_bytes)
            return f"/media/snapshots/workforce_alerts/{alert_id}/snapshot.jpg"
    except Exception as e:
        logger.warning(f"[workforce_queue] Snapshot upload failed: {e}")
        return None


def _maybe_create_task(db, project_id: int, camera_id: int, camera_name: str,
                       alert_type: str, alert_id: int, zone_name: str = None) -> None:
    """Create an auto-task for the alert if not already created in last 60 min."""
    from ..models.project_task import ProjectTask
    from ..models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=60)

    # Dedup check — one task per camera+alert_type per hour
    existing = (
        db.query(ProjectTask)
        .filter(
            ProjectTask.project_id == project_id,
            ProjectTask.auto_generated == True,
            ProjectTask.is_done == False,
            ProjectTask.created_at >= cutoff,
        )
        .filter(ProjectTask.title.like(f"% — {camera_name}"))
        .filter(ProjectTask.title.like(f"%{_TASK_LABEL[alert_type]}%"))
        .first()
    )
    if existing:
        return

    task_title = f"{_TASK_LABEL[alert_type]} — {camera_name}"

    # Create one task per key role (project_manager, site_supervisor, safety_officer)
    notify_roles = [ProjectRole.PROJECT_MANAGER, ProjectRole.SITE_SUPERVISOR, ProjectRole.SAFETY_OFFICER]
    members = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
            ProjectMembership.project_role.in_(notify_roles),
        )
        .all()
    )

    seen_roles = set()
    for m in members:
        role_val = m.project_role.value if hasattr(m.project_role, "value") else m.project_role
        if role_val in seen_roles:
            continue
        seen_roles.add(role_val)
        task = ProjectTask(
            project_id        = project_id,
            title             = task_title,
            description       = f"Auto-generated alert: {_TASK_LABEL[alert_type]}. Camera: {camera_name}. Zone: {zone_name or 'N/A'}.",
            auto_generated    = True,
            assigned_role     = role_val,
            source_incident_id= None,
            is_done           = False,
        )
        db.add(task)


_TASK_LABEL = {
    "understaffed":    "Zone Understaffed",
    "idle_ratio_high": "High Idle Ratio",
    "sudden_drop":     "⚠ Sudden Worker Drop",
    "overload":        "Zone Overload",
}


def _alert_title(alert_type: str, camera_name: str = "") -> str:
    base = {
        "understaffed":    "Zone Understaffed",
        "idle_ratio_high": "High Idle Worker Ratio",
        "sudden_drop":     "Sudden Worker Drop Detected",
        "overload":        "Zone Congestion Alert",
    }.get(alert_type, "Workforce Alert")
    return f"{base} — {camera_name}" if camera_name else base


# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────

def start_workers():
    """Start workforce worker pool. Called from main.py on_startup."""
    try:
        for i in range(_WORKER_COUNT):
            t = threading.Thread(
                target=_workforce_worker,
                name=f"workforce-worker-{i}",
                daemon=True,
            )
            t.start()
        logger.info(f"✅ Workforce event queue workers started ({_WORKER_COUNT}x workforce-worker)")
    except Exception as e:
        logger.error(f"❌ Failed to start workforce queue workers: {e}", exc_info=True)
        raise
