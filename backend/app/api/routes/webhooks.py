"""
Webhook endpoints for external integrations (n8n, etc.)

POST /webhooks/report-trigger
  - Called by n8n cron to generate and email scheduled PPE reports
  - Secured via X-Webhook-Key header (static secret, not JWT)
  - Returns 202 immediately; generation runs in background thread
  - Idempotent: duplicate trigger for same project+period is safely skipped

n8n Setup:
  1. Open n8n at http://localhost:5678
  2. Create workflow → Schedule Trigger (e.g. 0 8 * * 1 for weekly Monday 8am)
  3. Add HTTP Request node:
       Method: POST
       URL: http://localhost:8000/webhooks/report-trigger
       Headers: X-Webhook-Key: <your WEBHOOK_API_KEY>
       Body (JSON): { "project_id": 1, "period": "weekly" }
  4. For multiple projects: use a Loop node iterating project IDs
  5. Add error handling: on non-2xx, send admin alert
"""

from __future__ import annotations

import hmac
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_db, log_event
from ...core.config import settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class ReportTriggerRequest(BaseModel):
    project_id: int
    period: str = "weekly"          # daily | weekly | monthly
    report_type: str = "ppe"        # ppe (extensible)


# ── Auth helper ───────────────────────────────────────────────────────────────

def _verify_webhook_key(x_webhook_key: Optional[str]) -> None:
    """Constant-time compare to prevent timing attacks."""
    expected = settings.webhook_api_key
    if not expected:
        raise HTTPException(status_code=503, detail="Webhook integration not configured on this server.")
    if not x_webhook_key:
        raise HTTPException(status_code=401, detail="Missing X-Webhook-Key header.")
    if not hmac.compare_digest(x_webhook_key, expected):
        raise HTTPException(status_code=401, detail="Invalid webhook key.")


# ── Period helpers ─────────────────────────────────────────────────────────────

def _compute_period(period: str) -> tuple[datetime, datetime, str]:
    """
    Compute (period_start, period_end, period_label) for the most recently completed period.
    - daily   → yesterday 00:00–23:59
    - weekly  → last full Mon–Sun week
    - monthly → last full calendar month
    """
    now = datetime.now(timezone.utc)

    if period == "daily":
        yesterday = now.date() - timedelta(days=1)
        start = datetime(yesterday.year, yesterday.month, yesterday.day, 0, 0, 0, tzinfo=timezone.utc)
        end   = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, 999999, tzinfo=timezone.utc)
        label = yesterday.strftime("%Y-%m-%d")

    elif period == "monthly":
        # First day of last month → last day of last month
        first_of_this = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        last_month_end = first_of_this - timedelta(seconds=1)
        last_month_start = last_month_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        start = last_month_start
        end   = last_month_end
        label = start.strftime("%Y-%m")

    else:  # weekly (default)
        # Last Monday 00:00 → last Sunday 23:59
        days_since_monday = now.weekday()  # Monday=0
        last_monday = (now - timedelta(days=days_since_monday + 7)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        last_sunday = last_monday + timedelta(days=6, hours=23, minutes=59, seconds=59, microseconds=999999)
        start = last_monday
        end   = last_sunday
        # ISO week label e.g. "2025-W14"
        label = f"{start.year}-W{start.isocalendar()[1]:02d}"

    return start, end, label


def _compute_preview_period() -> tuple[datetime, datetime, str]:
    """
    Preview: rolling last 7 days up to this exact second.
    Label uses 'preview_YYYY-MM-DD' so it never conflicts with scheduled report idempotency.
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=7)
    label = f"preview_{now.strftime('%Y-%m-%d')}"
    return start, now, label


# ── Background task ───────────────────────────────────────────────────────────

def _run_report_background(
    report_id: int,
    project_id: int,
    period_start: datetime,
    period_end: datetime,
    triggered_by: str,
):
    """
    Runs in a daemon thread on the 8000 process.
    1. Generates PDF
    2. Saves to disk
    3. Emails recipients (ACTIVE members only)
    4. Updates project_reports row
    5. Creates in-app notifications
    """
    from ...core.db import SessionLocal
    from ...models.project_report import ProjectReport, ReportStatus, ReportTrigger
    from ...models.project import Project
    from ...models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from ...models.user import User
    from ...services.pdf_report_service import ReportGenerationError
    from ...services.notification_service import notify_project_members, notify_admins

    db = SessionLocal()
    try:
        logger.info(f"[report_bg] ▶ Starting report {report_id} for project {project_id}")
        report = db.query(ProjectReport).filter(ProjectReport.id == report_id).first()
        if not report:
            logger.error(f"[report_bg] Report row {report_id} not found, aborting")
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        project_name = project.name if project else f"Project #{project_id}"

        # ── Generate PDF (dispatch by report_type) ────────────────────────────
        logger.info(f"[report_bg] Generating PDF for report {report_id} (type={report.report_type})...")
        try:
            from ...services.pdf_report_service import (
                generate_ppe_pdf_report,
                generate_workforce_pdf_report,
                generate_activity_pdf_report,
                generate_risk_pdf_report,
            )
            _generators = {
                "ppe":       generate_ppe_pdf_report,
                "workforce": generate_workforce_pdf_report,
                "activity":  generate_activity_pdf_report,
                "risk":      generate_risk_pdf_report,
            }
            _gen_fn = _generators.get(report.report_type, generate_ppe_pdf_report)
            pdf_bytes = _gen_fn(db, project_id, period_start, period_end, triggered_by)
            logger.info(f"[report_bg] PDF generated OK for report {report_id} ({len(pdf_bytes)} bytes)")
        except ReportGenerationError as e:
            report.status = ReportStatus.FAILED
            report.error_message = str(e)
            db.commit()
            logger.error(f"[report_bg] PDF generation failed for report {report_id}: {e}")
            notify_project_members(
                db, project_id,
                type="report_failed",
                title="Report Generation Failed",
                message=f"Automated PPE safety report for {project_name} could not be generated. Please check the Reports section.",
                category="project",
                priority="high",
                action_url=f"/projects/{project_id}/reports",
                roles=[ProjectRole.PROJECT_MANAGER],
            )
            db.commit()
            return
        except Exception as e:
            report.status = ReportStatus.FAILED
            report.error_message = f"Unexpected error: {str(e)}"
            db.commit()
            logger.error(f"[report_bg] Unexpected PDF error for report {report_id}: {e}", exc_info=True)
            notify_project_members(
                db, project_id,
                type="report_failed",
                title="Report Generation Failed",
                message=f"An unexpected error occurred while generating the PPE report for {project_name}.",
                category="project",
                priority="high",
                action_url=f"/projects/{project_id}/reports",
                roles=[ProjectRole.PROJECT_MANAGER],
            )
            db.commit()
            return

        # ── Save PDF to local disk ────────────────────────────────────────────
        logger.info(f"[report_bg] Saving PDF to disk for report {report_id}...")
        try:
            import os as _os
            from ...core.config import settings as _cfg
            period_slug = (report.period_label or period_start.strftime("%Y-%m-%d")).replace(":", "-")
            report_dir = _os.path.join(_cfg.reports_dir, f"project_{project_id}")
            _os.makedirs(report_dir, exist_ok=True)
            file_name = f"ppe_report_{project_id}_{period_slug}_{report_id}.pdf"
            file_path = _os.path.join(report_dir, file_name)
            with open(file_path, "wb") as f:
                f.write(pdf_bytes)
            report.file_path = file_path
            logger.info(f"[report_bg] PDF saved to {file_path}")
        except Exception as e:
            # Disk save failure is non-fatal — report still gets emailed
            logger.warning(f"[report_bg] Disk save failed for report {report_id}: {e} — continuing without file storage")

        report.status = ReportStatus.READY
        report.generated_at = datetime.now(timezone.utc)
        db.commit()

        # ── Build recipient list (ACTIVE members with report roles ONLY) ───────
        members = (
            db.query(ProjectMembership, User)
            .join(User, User.id == ProjectMembership.user_id)
            .filter(
                ProjectMembership.project_id == project_id,
                ProjectMembership.status == MembershipStatus.ACTIVE,
                ProjectMembership.project_role.in_([
                    ProjectRole.PROJECT_MANAGER,
                    ProjectRole.SITE_SUPERVISOR,
                    ProjectRole.SAFETY_OFFICER,
                ]),
            )
            .all()
        )

        # Deduplicate by user_id (same person may appear with multiple roles)
        seen_ids: set[int] = set()
        recipients = []
        for membership, user in members:
            if user.id not in seen_ids:
                seen_ids.add(user.id)
                recipients.append({
                    "email": user.email,
                    "name": user.full_name or user.email,
                    "role": membership.project_role.value,
                })

        logger.info(f"[report_bg] Found {len(recipients)} recipient(s) for report {report_id}: {[r['email'] for r in recipients]}")
        if not recipients:
            logger.info(f"[report_bg] No eligible recipients for project {project_id} — report saved, no email sent")
            report.status = ReportStatus.EMAILED  # Treat as done; just no recipients
            report.recipient_count = 0
            report.emailed_at = datetime.now(timezone.utc)
            db.commit()
            return

        # ── Send emails ───────────────────────────────────────────────────────
        logger.info(f"[report_bg] Sending emails for report {report_id}...")
        from ...services.email import send_report_email
        period_label = report.period_label or period_start.strftime("%Y-%m-%d")

        email_result = send_report_email(
            recipients=recipients,
            project_name=project_name,
            period_label=period_label,
            period_start=period_start,
            period_end=period_end,
            pdf_bytes=pdf_bytes,
            download_url=f"{settings.frontend_url}/projects/{project_id}/reports",
        )

        sent_count = email_result.get("sent", 0)
        failed_emails = email_result.get("failed", [])
        logger.info(f"[report_bg] Email result for report {report_id}: sent={sent_count}, failed={failed_emails}")

        # ── Save recipient audit trail ─────────────────────────────────────
        logger.info(f"[report_bg] Saving recipient audit trail for report {report_id}...")
        from ...models.project_report import ReportRecipient
        failed_set = set(failed_emails)
        now_ts = datetime.now(timezone.utc)
        email_to_user_id = {u.email: u.id for _, u in members}
        for r in recipients:
            delivered = r["email"] not in failed_set
            db.add(ReportRecipient(
                report_id    = report.id,
                user_id      = email_to_user_id.get(r["email"]),
                email        = r["email"],
                full_name    = r["name"],
                role         = r["role"],
                delivered    = delivered,
                delivered_at = now_ts if delivered else None,
            ))
        db.flush()

        report.recipient_count = sent_count
        report.emailed_at = now_ts

        if sent_count == 0 and len(failed_emails) > 0:
            report.status = ReportStatus.EMAIL_FAILED
            report.error_message = f"Email delivery failed for all {len(failed_emails)} recipients."
            logger.error(f"[report_bg] All emails failed for report {report_id}: {failed_emails}")
            # Notify PM that email failed — they can use Resend button
            notify_project_members(
                db, project_id,
                type="report_email_failed",
                title="Report Email Delivery Failed",
                message=f"PPE report for {project_name} was generated but could not be emailed. "
                        "Use the Reports section to resend.",
                category="project",
                priority="high",
                action_url=f"/projects/{project_id}/reports",
                roles=[ProjectRole.PROJECT_MANAGER],
            )
        else:
            report.status = ReportStatus.EMAILED
            if failed_emails:
                logger.warning(f"[report_bg] Partial email failure for report {report_id}: {failed_emails}")
                log_event(db, "report_email_partial_failure", None,
                          {"report_id": report_id, "project_id": project_id, "failed": failed_emails})

            # Success notification to all report-eligible members
            notify_project_members(
                db, project_id,
                type="report_ready",
                title="PPE Safety Report Ready",
                message=f"The {period_label} PPE safety report for {project_name} has been generated "
                        "and emailed to the team.",
                category="project",
                priority="medium",
                action_url=f"/projects/{project_id}/reports",
                roles=[ProjectRole.PROJECT_MANAGER, ProjectRole.SITE_SUPERVISOR, ProjectRole.SAFETY_OFFICER],
            )

        log_event(db, "report_generated", None, {
            "report_id": report_id,
            "project_id": project_id,
            "period_label": period_label,
            "status": report.status,
            "recipient_count": sent_count,
            "triggered_by": triggered_by,
        })
        db.commit()
        logger.info(f"[report_bg] Report {report_id} completed: status={report.status}, sent={sent_count}")

    except Exception as e:
        logger.error(f"[report_bg] Fatal error in report background task {report_id}: {e}", exc_info=True)
        try:
            report = db.query(ProjectReport).filter(ProjectReport.id == report_id).first()
            if report and report.status in (ReportStatus.GENERATING, ReportStatus.PENDING):
                report.status = ReportStatus.FAILED
                report.error_message = f"Fatal background task error: {str(e)}"
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Active projects list (used by n8n to dynamically fetch all projects) ──────

@router.get("/active-projects")
def get_active_projects(
    db: Session = Depends(get_db),
    x_webhook_key: Optional[str] = Header(default=None, alias="X-Webhook-Key"),
):
    """
    Returns all ACTIVE project IDs. Called by n8n before the loop
    so it never needs manual updates when new projects are created.
    """
    _verify_webhook_key(x_webhook_key)

    from ...models.project import Project, ProjectStatus

    projects = (
        db.query(Project.id, Project.name)
        .filter(Project.status == ProjectStatus.ACTIVE)
        .all()
    )
    return [{"project_id": p.id, "project_name": p.name} for p in projects]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/report-trigger", status_code=202)
def trigger_report(
    body: ReportTriggerRequest,
    db: Session = Depends(get_db),
    x_webhook_key: Optional[str] = Header(default=None, alias="X-Webhook-Key"),
):
    """
    Trigger scheduled report generation. Called by n8n cron.

    Returns 202 immediately. Generation runs in background thread.
    Idempotent: if a report for the same project+period already exists
    with status ready/emailed/generating, the request is skipped.

    Edge cases handled:
    - ARCHIVED project → skipped (not an error)
    - No incidents in period → PDF still generated with "no violations" section
    - All emails fail → status=email_failed, PM notified via in-app notification
    - n8n retry → idempotency check prevents duplicate reports
    """
    _verify_webhook_key(x_webhook_key)

    from ...models.project import Project, ProjectStatus
    from ...models.project_report import ProjectReport, ReportStatus, ReportTrigger
    from ...models.project_settings import ProjectSettings

    # Load project
    project = db.query(Project).filter(Project.id == body.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {body.project_id} not found.")

    # Archived projects: skip silently (not an error — n8n should not error on this)
    if project.status == ProjectStatus.ARCHIVED:
        logger.info(f"[webhook] Skipping report for archived project {body.project_id}")
        return {"skipped": True, "reason": "project_archived", "project_id": body.project_id}

    # Use project's report_frequency setting (overrides whatever n8n sends)
    project_settings = db.query(ProjectSettings).filter(ProjectSettings.project_id == body.project_id).first()
    effective_period = project_settings.report_frequency if project_settings else body.period

    if effective_period not in ("daily", "weekly", "monthly"):
        effective_period = "weekly"  # safe fallback

    logger.info(f"[webhook] Project {body.project_id} report_frequency={effective_period} (n8n sent: {body.period})")
    period_start, period_end, period_label = _compute_period(effective_period)

    # Idempotency: don't regenerate if a recent report exists for this period
    existing = (
        db.query(ProjectReport)
        .filter(
            ProjectReport.project_id == body.project_id,
            ProjectReport.period_label == period_label,
            ProjectReport.report_type == body.report_type,
            ProjectReport.status.in_([ReportStatus.READY, ReportStatus.EMAILED, ReportStatus.GENERATING]),
        )
        .first()
    )
    if existing:
        logger.info(f"[webhook] Skipping duplicate report for project {body.project_id} period {period_label}")
        return {
            "skipped": True,
            "reason": "already_generated",
            "report_id": existing.id,
            "status": existing.status,
        }

    # Create report row with status=generating
    report = ProjectReport(
        project_id=body.project_id,
        report_type=body.report_type,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        frequency=effective_period,
        status=ReportStatus.GENERATING,
        triggered_by=ReportTrigger.SCHEDULED,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    logger.info(f"[webhook] Queued report {report.id} for project {body.project_id} period {period_label}")

    # Launch background thread (non-blocking)
    thread = threading.Thread(
        target=_run_report_background,
        args=(report.id, body.project_id, period_start, period_end, ReportTrigger.SCHEDULED),
        daemon=True,
        name=f"report-{report.id}",
    )
    thread.start()

    return {
        "accepted": True,
        "report_id": report.id,
        "project_id": body.project_id,
        "period_label": period_label,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


# ── Preview endpoint ──────────────────────────────────────────────────────────

class PreviewReportRequest(BaseModel):
    project_id: int
    report_type: str = "ppe"


@router.post("/report-preview", status_code=202)
def trigger_preview_report(
    body: PreviewReportRequest,
    db: Session = Depends(get_db),
    x_webhook_key: Optional[str] = Header(default=None, alias="X-Webhook-Key"),
):
    """
    Trigger a live preview report: last 7 days up to this exact second.
    Always generates fresh — no idempotency check (each click is a new snapshot).
    Used for demos and ad-hoc checks.
    """
    _verify_webhook_key(x_webhook_key)

    from ...models.project import Project, ProjectStatus
    from ...models.project_report import ProjectReport, ReportStatus, ReportTrigger

    project = db.query(Project).filter(Project.id == body.project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project {body.project_id} not found.")

    if project.status == ProjectStatus.ARCHIVED:
        return {"skipped": True, "reason": "project_archived", "project_id": body.project_id}

    period_start, period_end, period_label = _compute_preview_period()

    report = ProjectReport(
        project_id=body.project_id,
        report_type=body.report_type,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        frequency="preview",
        status=ReportStatus.GENERATING,
        triggered_by=ReportTrigger.MANUAL,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    logger.info(f"[webhook] Preview report {report.id} queued for project {body.project_id} ({period_label})")

    thread = threading.Thread(
        target=_run_report_background,
        args=(report.id, body.project_id, period_start, period_end, ReportTrigger.MANUAL),
        daemon=True,
        name=f"report-preview-{report.id}",
    )
    thread.start()

    return {
        "accepted": True,
        "report_id": report.id,
        "project_id": body.project_id,
        "period_label": period_label,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }
