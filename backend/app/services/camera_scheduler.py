"""
camera_scheduler.py — APScheduler-based automatic camera health checks.

Design:
  - One BackgroundScheduler runs a periodic job (_scheduled_job) for all cameras.
  - A per-camera mutex (_checking_ids set) prevents the scheduler and manual
    endpoint from probing the same camera simultaneously.
  - run_health_check_for_camera() is the single source of truth for health-check
    logic — used by BOTH the scheduler job and the manual API endpoint.
  - Notifications fire on status worsening (healthy → offline/degraded) AND
    on recovery (offline/degraded → healthy).
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

# ── Module-level shared state (guarded by _lock) ─────────────────────────────
_scheduler: Optional[BackgroundScheduler] = None
_last_run_at: Optional[datetime] = None
_last_summary: Optional[Dict[str, Any]] = None
_job_running: bool = False
_checking_ids: Set[int] = set()
_lock = threading.Lock()
_interval_minutes: int = 5
_enabled: bool = True

JOB_ID = "camera_health_auto"

# ── Load config from DB ────────────────────────────────────────────────────────

def load_config_from_db(db_session: Any) -> Optional[Dict[str, Any]]:
    """Load scheduler config from DB. Returns None if table doesn't exist (falls back to .env)."""
    try:
        from ..models.scheduler_config import SchedulerConfig
        config = db_session.query(SchedulerConfig).filter(SchedulerConfig.id == 1).first()
        if config:
            return {"enabled": config.enabled, "interval_minutes": config.interval_minutes}
    except Exception:
        pass  # Table doesn't exist yet or query failed — fall back to settings
    return None

# ── Per-camera mutex ──────────────────────────────────────────────────────────

def acquire_check(camera_id: int) -> bool:
    """Try to acquire exclusive check slot for a camera.  Returns True if acquired."""
    with _lock:
        if camera_id in _checking_ids:
            return False
        _checking_ids.add(camera_id)
        return True


def release_check(camera_id: int) -> None:
    with _lock:
        _checking_ids.discard(camera_id)


def is_being_checked(camera_id: int) -> bool:
    with _lock:
        return camera_id in _checking_ids


# ── Status ─────────────────────────────────────────────────────────────────────

def get_status() -> Dict[str, Any]:
    next_run_at: Optional[datetime] = None
    scheduler_active = _scheduler is not None and _scheduler.running
    if scheduler_active:
        job = _scheduler.get_job(JOB_ID)
        if job:
            next_run_at = job.next_run_time
    return {
        "enabled": _enabled,
        "interval_minutes": _interval_minutes,
        "last_run_at": _last_run_at,
        "next_run_at": next_run_at,
        "last_summary": _last_summary,
        "is_running": _job_running,
        "scheduler_active": scheduler_active,
    }


# ── Core health-check logic (shared by scheduler + manual endpoint) ────────────

def run_health_check_for_camera(cam: Any, db: Any) -> Dict[str, Any]:
    """
    Perform a TCP health check for one camera:
      - Decrypts RTSP URL from credentials
      - Probes host:port via TCP (5 s timeout)
      - Writes a CameraHealthLog row
      - Sends notifications on status change (worsening OR recovery)
      - Updates camera.last_health_check_at
      - Does NOT commit — caller is responsible for db.commit()

    Returns dict: {status, latency_ms, message}
    """
    from ..models.camera import CameraCredential, CameraHealthLog, CameraHealthStatus
    from ..core.crypto import decrypt_credential
    from .rtsp_probe import probe_rtsp_health

    prev_log = (
        db.query(CameraHealthLog)
        .filter(CameraHealthLog.camera_id == cam.id)
        .order_by(CameraHealthLog.checked_at.desc())
        .first()
    )
    prev_status = prev_log.health_status if prev_log else None

    cred = (
        db.query(CameraCredential)
        .filter(CameraCredential.camera_id == cam.id)
        .first()
    )
    rtsp_url: Optional[str] = None
    if cred and cred.rtsp_url_enc:
        try:
            rtsp_url = decrypt_credential(cred.rtsp_url_enc)
        except Exception:
            pass

    if not rtsp_url:
        new_status = CameraHealthStatus.maintenance
        latency_ms = None
        message = "No RTSP URL configured — cannot probe"
    else:
        # Use lightweight TCP probe (not full stream decode)
        # This avoids conflicts with PPE inference pipelines consuming the RTSP stream
        from .rtsp_probe import probe_rtsp_health
        reachable, latency_ms, probe_err = probe_rtsp_health(rtsp_url, timeout=5.0)

        if reachable:
            if latency_ms > 150:
                new_status = CameraHealthStatus.degraded
                message = f"High latency: {latency_ms:.0f} ms"
            else:
                new_status = CameraHealthStatus.healthy
                message = None
        else:
            new_status = CameraHealthStatus.offline
            message = probe_err or "Host unreachable"

    db.add(CameraHealthLog(
        camera_id=cam.id,
        health_status=new_status,
        latency_ms=latency_ms,
        message=message,
    ))
    cam.last_health_check_at = datetime.now(timezone.utc)

    # Fire notifications on status change
    alert_statuses = {CameraHealthStatus.offline, CameraHealthStatus.degraded}
    if new_status in alert_statuses and new_status != prev_status:
        icon = "⛔" if new_status == CameraHealthStatus.offline else "⚠️"
        _push_notifications(
            db, cam,
            f"camera_{new_status.value}",
            f"{icon} Camera {new_status.value.upper()}: {cam.name}",
            (
                f"Camera '{cam.name}' is now {new_status.value}. "
                f"{'Host unreachable — check network/power.'  if new_status == CameraHealthStatus.offline else 'High latency detected — performance may be degraded.'}"
            ),
        )
    elif prev_status in alert_statuses and new_status == CameraHealthStatus.healthy:
        _push_notifications(
            db, cam,
            "camera_recovered",
            f"✅ Camera RECOVERED: {cam.name}",
            f"Camera '{cam.name}' is back online and healthy.",
        )

    return {"status": new_status.value, "latency_ms": latency_ms, "message": message}


def _push_notifications(db: Any, camera: Any, notif_type: str, title: str, message: str) -> None:
    try:
        from ..models.notification import Notification
        from ..models.user import PlatformRole, User
        admins = (
            db.query(User)
            .filter(User.platform_role == PlatformRole.ADMIN, User.is_active == True)
            .all()
        )
        for admin in admins:
            db.add(Notification(
                user_id=admin.id,
                type=notif_type,
                title=title,
                message=message,
                camera_id=camera.id,
            ))
    except Exception:
        pass  # never let notification errors break the health-check flow


# ── Scheduler job ──────────────────────────────────────────────────────────────

def _scheduled_job() -> None:
    """Periodic job: health-check every active (non-archived) camera."""
    global _job_running, _last_run_at, _last_summary

    # Guard against overlapping runs (job takes longer than interval)
    with _lock:
        if _job_running:
            return
        _job_running = True

    summary: Dict[str, Any] = {
        "total": 0, "healthy": 0, "degraded": 0,
        "offline": 0, "maintenance": 0, "errors": 0, "skipped": 0,
    }

    try:
        from ..core.db import SessionLocal
        from ..models.camera import Camera
        from ..models.project_camera import ProjectCamera as _ProjectCamera
        from .camera_health_broker import push as _cam_push
        from .project_camera_broker import push as _proj_push

        db = SessionLocal()
        try:
            cameras = db.query(Camera).filter(Camera.archived_at.is_(None)).all()
            for cam in cameras:
                if not acquire_check(cam.id):
                    summary["skipped"] += 1
                    continue
                try:
                    summary["total"] += 1
                    result = run_health_check_for_camera(cam, db)
                    key = result["status"]
                    summary[key] = summary.get(key, 0) + 1
                    # Push SSE: health update to all admin clients and per-project clients
                    _sse_payload = {
                        "type": "camera_health_update",
                        "camera_id": cam.id,
                        "camera_name": cam.name,
                        "health_status": result["status"],
                        "latency_ms": result["latency_ms"],
                        "message": result["message"],
                        "checked_at": datetime.now(timezone.utc).isoformat(),
                    }
                    _cam_push(_sse_payload)
                    for _pc in db.query(_ProjectCamera).filter(_ProjectCamera.camera_id == cam.id).all():
                        _proj_push(_pc.project_id, _sse_payload)
                except Exception:
                    summary["errors"] += 1
                finally:
                    release_check(cam.id)

            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

        _last_run_at = datetime.now(timezone.utc)
        _last_summary = summary

    except Exception:
        import traceback
        traceback.print_exc()
    finally:
        with _lock:
            _job_running = False


# ── Lifecycle ──────────────────────────────────────────────────────────────────

def start(interval_minutes: int = 5) -> None:
    global _scheduler, _interval_minutes, _enabled
    _interval_minutes = interval_minutes
    _enabled = True
    _scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    _scheduler.add_job(
        _scheduled_job,
        trigger=IntervalTrigger(minutes=interval_minutes),
        id=JOB_ID,
        name="Camera Auto Health Check",
        replace_existing=True,
        misfire_grace_time=60,
        max_instances=1,
    )
    _scheduler.start()
    print(f"[scheduler] Camera health-check scheduler started — interval: {interval_minutes} min")


def stop() -> None:
    global _scheduler, _enabled
    _enabled = False
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
    print("[scheduler] Camera health-check scheduler stopped")


def update_config(interval_minutes: Optional[int] = None, enabled: Optional[bool] = None) -> None:
    """Hot-update the scheduler without restarting the server."""
    global _interval_minutes, _enabled
    if interval_minutes is not None:
        _interval_minutes = interval_minutes
    if enabled is not None:
        _enabled = enabled

    if _scheduler and _scheduler.running:
        if not _enabled:
            _scheduler.pause_job(JOB_ID)
        else:
            _scheduler.resume_job(JOB_ID)
            if interval_minutes is not None:
                _scheduler.reschedule_job(
                    JOB_ID,
                    trigger=IntervalTrigger(minutes=_interval_minutes),
                )


def trigger_now() -> None:
    """Fire the health-check job immediately in a background thread (non-blocking)."""
    t = threading.Thread(target=_scheduled_job, daemon=True, name="camera-health-trigger")
    t.start()
