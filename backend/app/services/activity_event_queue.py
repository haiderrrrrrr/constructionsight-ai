"""
Activity Event Queue — fire-and-forget bridge between ActivityProcessor threads and the DB.

Single queue (maxsize=500) handles two event kinds:
  kind="snapshot"  → write ActivitySnapshot row
  kind="alert"     → write ActivityAlert row + Notification rows + auto-tasks

Uses threading.Queue so ActivityProcessor can call try_enqueue() without async/await.
4 daemon worker threads started from main.py on_startup().
"""

import queue
import logging
import threading
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ── Public queue ──────────────────────────────────────────────────────────────
activity_queue: queue.Queue = queue.Queue(maxsize=500)

_WORKER_COUNT = 4

# Roles that receive activity alert notifications and tasks
_NOTIFY_ROLES = ["project_manager", "site_supervisor", "safety_officer"]

# Alert priority by type
_ALERT_PRIORITY = {
    "activity_drop":          "high",
    "zone_idle":              "medium",
    "low_activity_sustained": "medium",
    "repeated_inactivity":    "low",
}


# ─────────────────────────────────────────────────────────────────────────────
# PRE-ENQUEUE HELPER
# ─────────────────────────────────────────────────────────────────────────────

def try_enqueue(event: dict) -> bool:
    """
    Attempt to add an event to the activity queue.
    Returns False (and drops) if the queue is full.
    """
    if activity_queue.full():
        logger.warning(
            f"[activity_queue] Queue FULL — dropping {event.get('kind')} "
            f"for camera={event.get('camera_id')}"
        )
        return False
    activity_queue.put_nowait(event)
    return True


# ─────────────────────────────────────────────────────────────────────────────
# WORKER THREAD
# ─────────────────────────────────────────────────────────────────────────────

def _activity_worker():
    """Consume activity_queue and dispatch to snapshot or alert handler."""
    logger.info("[activity_worker] Started")
    while True:
        event = activity_queue.get()
        try:
            kind = event.get("kind")
            if kind == "snapshot":
                _process_snapshot(event)
            elif kind == "alert":
                _process_alert(event)
            else:
                logger.warning(f"[activity_queue] Unknown event kind: {kind!r}")
        except Exception as exc:
            logger.error(f"[activity_queue] Unhandled error: {exc}", exc_info=True)
        finally:
            activity_queue.task_done()


# ─────────────────────────────────────────────────────────────────────────────
# SNAPSHOT HANDLER
# ─────────────────────────────────────────────────────────────────────────────

def _process_snapshot(event: dict):
    """Write an ActivitySnapshot row to the DB."""
    from ..core.db import SessionLocal
    from ..models.activity_snapshot import ActivitySnapshot

    camera_id   = event["camera_id"]
    project_id  = event["project_id"]
    trigger     = event.get("trigger", "interval")
    recorded_at = event.get("recorded_at") or datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        snap = ActivitySnapshot(
            project_id                 = project_id,
            camera_id                  = camera_id,
            zone_id                    = event.get("zone_id"),
            zone_name                  = event.get("zone_name"),
            recorded_at                = recorded_at,
            trigger                    = trigger,
            zone_state                 = event.get("zone_state", "ACTIVE"),
            moving_count               = event.get("moving_count", 0),
            stationary_count           = event.get("stationary_count", 0),
            idle_count                 = event.get("idle_count", 0),
            total_count                = event.get("total_count", 0),
            motion_intensity_score     = event.get("motion_intensity_score", 0.0),
            activity_score             = event.get("activity_score", 0),
            active_minutes_today       = event.get("active_minutes_today", 0),
            idle_minutes_today         = event.get("idle_minutes_today", 0),
            low_activity_minutes_today = event.get("low_activity_minutes_today", 0),
            idle_duration_seconds      = event.get("idle_duration_seconds"),
            longest_idle_seconds       = event.get("longest_idle_seconds"),
            sparkline_json             = event.get("sparkline_json", "[]"),
            optical_flow_score         = event.get("optical_flow_score"),
        )
        db.add(snap)
        db.commit()
        logger.debug(
            f"[activity_queue] Snapshot saved: camera={camera_id} "
            f"state={snap.zone_state} trigger={trigger}"
        )
    except Exception as e:
        logger.error(f"[activity_queue] Snapshot write failed: {e}", exc_info=True)
        db.rollback()
    finally:
        db.close()


# ─────────────────────────────────────────────────────────────────────────────
# ALERT HANDLER
# ─────────────────────────────────────────────────────────────────────────────

def _process_alert(event: dict):
    """Write an ActivityAlert row + Notification rows for key roles + auto-tasks."""
    from ..core.db import SessionLocal
    from ..models.activity_alert import ActivityAlert
    from ..models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from ..models.notification import Notification
    from ..models.ppe_incident import PpeIncident  # noqa: F401 — resolve FK for project_tasks
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
        # Fetch camera name
        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        camera_name = camera.name if camera else f"Camera {camera_id}"

        # 1. Write alert row
        alert = ActivityAlert(
            project_id   = project_id,
            camera_id    = camera_id,
            zone_id      = event.get("zone_id"),
            zone_name    = event.get("zone_name"),
            alert_type   = alert_type,
            severity     = severity,
            message      = message,
            triggered_at = triggered_at,
            status       = "open",
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
                logger.warning(f"[activity_queue] Snapshot encode failed: {snap_exc}")

        # 3. Notify key roles
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

        title      = _alert_title(alert_type, camera_name)
        priority   = _ALERT_PRIORITY.get(alert_type, "medium")
        action_url = f"/projects/{project_id}/reports/activity?camera={camera_id}"

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
                type       = "activity_alert",
                category   = "activity",
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
            f"[activity_queue] Alert saved: camera={camera_id} type={alert_type} "
            f"severity={severity} notified={len(notified_user_ids)} members"
        )

        # 5. Broadcast activity alert to dashboard via SSE (instant real-time)
        try:
            from . import activity_dashboard_broker
            activity_dashboard_broker.push(project_id, {
                "type": "activity_alert",
                "alert_id": alert.id,
                "camera_id": camera_id,
                "camera_name": camera_name,
                "zone_name": event.get("zone_name"),
                "alert_type": alert_type,
                "severity": severity,
                "message": message,
                "triggered_at": triggered_at.isoformat() if triggered_at else None,
                "snapshot_url": alert.snapshot_url,
            })
        except Exception as e:
            logger.warning(f"[activity_queue] Dashboard broadcast failed: {e}")

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
                    "type":       "activity_alert",
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
        logger.error(f"[activity_queue] Alert write failed: {e}", exc_info=True)
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
                folder        = f"activity_alerts/{alert_id}",
                public_id     = "snapshot",
                resource_type = "image",
            )
            return result.get("secure_url")
        else:
            import os
            folder = f"static/activity_alerts/{alert_id}"
            os.makedirs(folder, exist_ok=True)
            path = f"{folder}/snapshot.jpg"
            with open(path, "wb") as f:
                f.write(img_bytes)
            return f"/{path}"
    except Exception as e:
        logger.warning(f"[activity_queue] Snapshot upload failed: {e}")
        return None


def _maybe_create_task(db, project_id: int, camera_id: int, camera_name: str,
                       alert_type: str, alert_id: int, zone_name: str = None) -> None:
    """Create an auto-task for the alert if not already created in last 60 min."""
    from ..models.project_task import ProjectTask
    from ..models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from datetime import timedelta

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=60)

    existing = (
        db.query(ProjectTask)
        .filter(
            ProjectTask.project_id == project_id,
            ProjectTask.auto_generated == True,
            ProjectTask.is_done == False,
            ProjectTask.created_at >= cutoff,
        )
        .filter(ProjectTask.title.like(f"% — {camera_name}"))
        .filter(ProjectTask.title.like(f"%{_TASK_LABEL.get(alert_type, '')}%"))
        .first()
    )
    if existing:
        return

    task_title = f"{_TASK_LABEL.get(alert_type, 'Activity Alert')} — {camera_name}"

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
            project_id         = project_id,
            title              = task_title,
            description        = f"Auto-generated alert: {_TASK_LABEL.get(alert_type, alert_type)}. Camera: {camera_name}. Zone: {zone_name or 'N/A'}.",
            auto_generated     = True,
            assigned_role      = role_val,
            source_incident_id = None,
            is_done            = False,
        )
        db.add(task)


_TASK_LABEL = {
    "zone_idle":              "Zone Idle Detected",
    "activity_drop":          "⚠ Activity Drop Detected",
    "low_activity_sustained": "Sustained Low Activity",
    "repeated_inactivity":    "Repeated Inactivity Pattern",
}


def _alert_title(alert_type: str, camera_name: str = "") -> str:
    base = {
        "zone_idle":              "Zone Idle Detected",
        "activity_drop":          "Activity Drop Detected",
        "low_activity_sustained": "Sustained Low Activity",
        "repeated_inactivity":    "Repeated Inactivity Pattern",
    }.get(alert_type, "Activity Alert")
    return f"{base} — {camera_name}" if camera_name else base


# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────

def start_workers():
    """Start activity worker pool. Called from main.py on_startup."""
    try:
        for i in range(_WORKER_COUNT):
            t = threading.Thread(
                target=_activity_worker,
                name=f"activity-worker-{i}",
                daemon=True,
            )
            t.start()
        logger.info(f"✅ Activity event queue workers started ({_WORKER_COUNT}x activity-worker)")
    except Exception as e:
        logger.error(f"❌ Failed to start activity queue workers: {e}", exc_info=True)
        raise
