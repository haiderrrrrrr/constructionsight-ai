"""
risk_scheduler.py — APScheduler-based automatic risk analysis.
Mirrors camera_scheduler.py pattern exactly.
Runs in app_stream.py (port 8001) so SSE pushes reach connected clients directly.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

# ── Module-level shared state ─────────────────────────────────────────────────
_scheduler:        Optional[BackgroundScheduler] = None
_last_run_at:      Optional[datetime]            = None
_last_summary:     Optional[Dict[str, Any]]      = None
_job_running:      bool                          = False
_lock              = threading.Lock()
_interval_seconds: int                           = 30
_enabled:          bool                          = True

JOB_ID = "risk_analysis_auto"


# ── Load config from DB ───────────────────────────────────────────────────────

def load_config_from_db(db_session: Any) -> Optional[Dict[str, Any]]:
    try:
        from ...models.risk_scheduler_config import RiskSchedulerConfig
        config = db_session.query(RiskSchedulerConfig).filter(RiskSchedulerConfig.id == 1).first()
        if config:
            return {"enabled": config.enabled, "interval_seconds": config.interval_seconds}
    except Exception:
        pass
    return None


# ── Status ────────────────────────────────────────────────────────────────────

def get_status() -> Dict[str, Any]:
    next_run_at: Optional[datetime] = None
    scheduler_active = _scheduler is not None and _scheduler.running
    if scheduler_active:
        job = _scheduler.get_job(JOB_ID)
        if job:
            next_run_at = job.next_run_time
    return {
        "enabled":          _enabled,
        "interval_seconds": _interval_seconds,
        "last_run_at":      _last_run_at,
        "next_run_at":      next_run_at,
        "last_summary":     _last_summary,
        "is_running":       _job_running,
        "scheduler_active": scheduler_active,
    }


# ── Scheduler job ─────────────────────────────────────────────────────────────

def _scheduled_job() -> None:
    global _job_running, _last_run_at, _last_summary

    with _lock:
        if _job_running:
            return
        _job_running = True

    try:
        from ...core.db import SessionLocal
        from ..risk.risk_processor import process_all_active_projects

        summary = process_all_active_projects(SessionLocal)
        _last_run_at  = datetime.now(timezone.utc)
        _last_summary = summary

    except Exception:
        import traceback
        traceback.print_exc()
    finally:
        with _lock:
            _job_running = False


# ── Lifecycle ─────────────────────────────────────────────────────────────────

def start(interval_seconds: int = 30) -> None:
    global _scheduler, _interval_seconds, _enabled
    _interval_seconds = interval_seconds
    _enabled = True
    _scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    _scheduler.add_job(
        _scheduled_job,
        trigger=IntervalTrigger(seconds=interval_seconds),
        id=JOB_ID,
        name="Risk Analysis Auto",
        replace_existing=True,
        misfire_grace_time=60,
        max_instances=1,
    )
    _scheduler.start()
    print(f"[risk_scheduler] Risk analysis scheduler started — interval: {interval_seconds}s")


def stop() -> None:
    global _scheduler, _enabled
    _enabled = False
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
    print("[risk_scheduler] Risk analysis scheduler stopped")


def update_config(interval_seconds: Optional[int] = None, enabled: Optional[bool] = None) -> None:
    global _interval_seconds, _enabled
    if interval_seconds is not None:
        _interval_seconds = interval_seconds
    if enabled is not None:
        _enabled = enabled

    if _scheduler and _scheduler.running:
        if not _enabled:
            _scheduler.pause_job(JOB_ID)
        else:
            _scheduler.resume_job(JOB_ID)
            if interval_seconds is not None:
                _scheduler.reschedule_job(
                    JOB_ID,
                    trigger=IntervalTrigger(seconds=_interval_seconds),
                )


def trigger_now() -> None:
    """Fire the risk analysis job immediately (non-blocking background thread)."""
    t = threading.Thread(target=_scheduled_job, daemon=True, name="risk-analysis-trigger")
    t.start()
