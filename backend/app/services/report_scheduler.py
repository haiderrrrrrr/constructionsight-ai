"""
report_scheduler.py — APScheduler-based automatic project report generation.

Design mirrors camera_scheduler.py:
  - One BackgroundScheduler runs an hourly job (_scheduled_job)
  - At 01:00 UTC (= 06:00 PKT) each hour, checks each ACTIVE project
  - If it's send-time for the project's frequency, fires all 4 report types
  - Idempotent: skips any report type already generated for the current period
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

# ── Module-level shared state (guarded by _lock) ─────────────────────────────
_scheduler: Optional[BackgroundScheduler] = None
_last_run_at: Optional[datetime] = None
_last_summary: Optional[Dict[str, Any]] = None
_job_running: bool = False
_lock = threading.Lock()
_enabled: bool = True

JOB_ID = "report_auto"
REPORT_TYPES = ["ppe", "workforce", "activity", "risk"]

# ── Status ────────────────────────────────────────────────────────────────────

def get_status() -> Dict[str, Any]:
    next_run_at: Optional[datetime] = None
    scheduler_active = _scheduler is not None and _scheduler.running
    if scheduler_active:
        job = _scheduler.get_job(JOB_ID)
        if job:
            next_run_at = job.next_run_time
    return {
        "enabled": _enabled,
        "last_run_at": _last_run_at,
        "next_run_at": next_run_at,
        "last_summary": _last_summary,
        "is_running": _job_running,
        "scheduler_active": scheduler_active,
    }


# ── Send-time & period helpers ────────────────────────────────────────────────

def _should_fire(frequency: str, now_utc: datetime) -> bool:
    """True when it's 01:00 UTC (= 06:00 PKT) and the right day for this frequency."""
    if now_utc.hour != 1:
        return False
    if frequency == "daily":
        return True
    if frequency == "weekly":
        return now_utc.weekday() == 0  # Monday UTC
    if frequency == "monthly":
        return now_utc.day == 1  # 1st of month
    return False


def _compute_period(frequency: str, now_utc: datetime):
    """Return (period_start, period_end, period_label) for the most recently completed period."""
    if frequency == "daily":
        yesterday = (now_utc - timedelta(days=1)).date()
        start = datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0, tzinfo=timezone.utc)
        end   = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        label = yesterday.strftime("%Y-%m-%d")

    elif frequency == "monthly":
        first_of_this = now_utc.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_month_end = first_of_this - timedelta(seconds=1)
        last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start = last_month_start
        end   = last_month_end
        label = start.strftime("%Y-%m")

    else:  # weekly
        days_since_monday = now_utc.weekday()  # Monday=0
        last_monday = (now_utc - timedelta(days=days_since_monday + 7)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        last_sunday = last_monday + timedelta(days=6, hours=23, minutes=59, seconds=59, microseconds=999999)
        start = last_monday
        end   = last_sunday
        label = f"{start.year}-W{start.isocalendar()[1]:02d}"

    return start, end, label


def _compute_rolling_period(frequency: str, now_utc: datetime):
    """Rolling window ending now — used for manual trigger_now sends."""
    days_back = {"daily": 1, "weekly": 7, "monthly": 30}.get(frequency, 7)
    start = now_utc - timedelta(days=days_back)
    label = f"preview_{now_utc.strftime('%Y-%m-%d')}"
    return start, now_utc, label


def compute_next_send_at(frequency: str) -> datetime:
    """Return the next UTC datetime when reports will be auto-sent for this frequency."""
    now = datetime.now(timezone.utc)

    if frequency == "daily":
        candidate = now.replace(hour=1, minute=0, second=0, microsecond=0)
        if candidate <= now:
            candidate += timedelta(days=1)
        return candidate

    elif frequency == "weekly":
        days_to_monday = (7 - now.weekday()) % 7
        if days_to_monday == 0 and now.hour >= 1:
            days_to_monday = 7
        return (now + timedelta(days=days_to_monday)).replace(
            hour=1, minute=0, second=0, microsecond=0
        )

    else:  # monthly
        if now.day == 1 and now.hour < 1:
            return now.replace(hour=1, minute=0, second=0, microsecond=0)
        if now.month == 12:
            return now.replace(year=now.year + 1, month=1, day=1, hour=1, minute=0, second=0, microsecond=0)
        return now.replace(month=now.month + 1, day=1, hour=1, minute=0, second=0, microsecond=0)


# ── Per-project report generation ────────────────────────────────────────────

def _fire_project_reports(project_id: int, frequency: str, rolling: bool = False) -> Dict[str, Any]:
    """
    Queue all supported report types for one project in background threads.
    rolling=True uses a rolling window (for trigger_now); False uses last completed period.
    Returns summary of queued/skipped counts.
    """
    from ..core.db import SessionLocal
    from ..models.project_report import ProjectReport, ReportStatus, ReportTrigger
    from ..api.routes.webhooks import _run_report_background

    now_utc = datetime.now(timezone.utc)
    if rolling:
        period_start, period_end, period_label = _compute_rolling_period(frequency, now_utc)
    else:
        period_start, period_end, period_label = _compute_period(frequency, now_utc)

    summary: Dict[str, Any] = {"reports_queued": 0, "reports_skipped": 0}
    db = SessionLocal()
    try:
        for report_type in REPORT_TYPES:
            existing = (
                db.query(ProjectReport)
                .filter(
                    ProjectReport.project_id == project_id,
                    ProjectReport.period_label == period_label,
                    ProjectReport.report_type == report_type,
                    ProjectReport.status.in_([
                        ReportStatus.READY,
                        ReportStatus.EMAILED,
                        ReportStatus.GENERATING,
                    ]),
                )
                .first()
            )
            if existing:
                summary["reports_skipped"] += 1
                continue

            report = ProjectReport(
                project_id=project_id,
                report_type=report_type,
                period_label=period_label,
                period_start=period_start,
                period_end=period_end,
                frequency=frequency,
                status=ReportStatus.GENERATING,
                triggered_by=ReportTrigger.SCHEDULED if not rolling else ReportTrigger.MANUAL,
            )
            db.add(report)
            db.commit()
            db.refresh(report)

            t = threading.Thread(
                target=_run_report_background,
                args=(report.id, project_id, period_start, period_end,
                      ReportTrigger.SCHEDULED if not rolling else ReportTrigger.MANUAL),
                daemon=True,
                name=f"report-sched-{report.id}",
            )
            t.start()
            summary["reports_queued"] += 1

    finally:
        db.close()
    return summary


# ── Scheduler job ──────────────────────────────────────────────────────────────

def _scheduled_job() -> None:
    global _job_running, _last_run_at, _last_summary

    with _lock:
        if _job_running:
            return
        _job_running = True

    summary: Dict[str, Any] = {
        "projects_processed": 0, "reports_queued": 0,
        "reports_skipped": 0, "errors": 0,
    }

    try:
        from ..core.db import SessionLocal
        from ..models.project import Project, ProjectStatus
        from ..models.project_settings import ProjectSettings

        now_utc = datetime.now(timezone.utc)
        db = SessionLocal()
        try:
            active_projects = db.query(Project).filter(Project.status == ProjectStatus.ACTIVE).all()
            for project in active_projects:
                try:
                    ps = db.query(ProjectSettings).filter(
                        ProjectSettings.project_id == project.id
                    ).first()
                    if ps and not ps.reports_scheduler_enabled:
                        continue
                    frequency = (ps.report_frequency if ps else "weekly") or "weekly"
                    if not _should_fire(frequency, now_utc):
                        continue

                    summary["projects_processed"] += 1
                    result = _fire_project_reports(project.id, frequency, rolling=False)
                    summary["reports_queued"]  += result.get("reports_queued", 0)
                    summary["reports_skipped"] += result.get("reports_skipped", 0)

                except Exception:
                    summary["errors"] += 1
                    import traceback
                    traceback.print_exc()
        finally:
            db.close()

        _last_run_at = now_utc
        _last_summary = summary

    except Exception:
        import traceback
        traceback.print_exc()
    finally:
        with _lock:
            _job_running = False


# ── Lifecycle ──────────────────────────────────────────────────────────────────

def start() -> None:
    global _scheduler, _enabled
    _enabled = True
    _scheduler = BackgroundScheduler(daemon=True, timezone="UTC")
    _scheduler.add_job(
        _scheduled_job,
        trigger=IntervalTrigger(hours=1),
        id=JOB_ID,
        name="Project Report Auto-Send",
        replace_existing=True,
        misfire_grace_time=300,
        max_instances=1,
    )
    _scheduler.start()
    print("[report_scheduler] Started — hourly sweep, send-time: 06:00 PKT (01:00 UTC)")


def stop() -> None:
    global _scheduler, _enabled
    _enabled = False
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
    _scheduler = None
    print("[report_scheduler] Stopped")


def update_config(enabled: Optional[bool] = None) -> None:
    global _enabled
    if enabled is not None:
        _enabled = enabled
    if _scheduler and _scheduler.running:
        if not _enabled:
            _scheduler.pause_job(JOB_ID)
        else:
            _scheduler.resume_job(JOB_ID)


def trigger_now(project_id: int, frequency: str = "weekly") -> None:
    """Immediately fire all report types for a project using a rolling window (non-blocking)."""
    t = threading.Thread(
        target=_fire_project_reports,
        args=(project_id, frequency, True),
        daemon=True,
        name=f"report-trigger-{project_id}",
    )
    t.start()
