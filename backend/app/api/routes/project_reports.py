"""
Project Reports API — PPE Safety Report CRUD + On-demand Export + Email Resend

Prefix: /projects/{project_id}/reports
Auth:   Active project membership required (any role may read)
        Export/Resend restricted to PM, Supervisor, Safety Officer, Data Analyst

Endpoints:
  GET    /projects/{id}/reports                       List report history
  POST   /projects/{id}/reports/export                On-demand export (sync, returns PDF stream)
  GET    /projects/{id}/reports/{report_id}            Get single report status
  GET    /projects/{id}/reports/{report_id}/download   Stream PDF file
  POST   /projects/{id}/reports/{report_id}/resend     Resend email to current active members (PM only)
  DELETE /projects/{id}/reports/{report_id}            Delete record + file (PM only)
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from datetime import datetime, timedelta, timezone
from functools import partial
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, log_event
from ...models.user import User

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}/reports", tags=["reports"])


# ── Permission helpers ────────────────────────────────────────────────────────

def _require_member(project_id: int, user: User, db: Session):
    from ...models.project_membership import ProjectMembership, MembershipStatus
    from ...models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found.")

    membership = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == user.id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        .first()
    )
    if not membership and project.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied. You are not an active member of this project.")
    return project, membership


def _require_report_role(membership, project, user: User):
    """Require PM, Supervisor, Safety Officer, or Data Analyst to perform report actions."""
    from ...models.project_membership import ProjectRole

    if project.created_by == user.id:
        return  # creator always allowed
    if membership is None:
        raise HTTPException(status_code=403, detail="Active project membership required.")
    allowed = {
        ProjectRole.PROJECT_MANAGER,
        ProjectRole.SITE_SUPERVISOR,
        ProjectRole.SAFETY_OFFICER,
        ProjectRole.DATA_ANALYST,
    }
    if membership.project_role not in allowed:
        raise HTTPException(status_code=403, detail="Only Project Manager, Site Supervisor, Safety Officer, or Data Analyst can perform this action.")


def _require_pm(membership, project, user: User):
    """Require Project Manager role for privileged actions (resend, delete)."""
    from ...models.project_membership import ProjectRole

    if project.created_by == user.id:
        return  # creator (admin) always allowed
    if membership is None or membership.project_role != ProjectRole.PROJECT_MANAGER:
        raise HTTPException(status_code=403, detail="Only the Project Manager can perform this action.")


def _serialize_report(r) -> dict:
    return {
        "id":                   r.id,
        "project_id":           r.project_id,
        "report_type":          r.report_type,
        "period_label":         r.period_label,
        "period_start":         r.period_start.isoformat() if r.period_start else None,
        "period_end":           r.period_end.isoformat() if r.period_end else None,
        "frequency":            r.frequency,
        "status":               r.status,
        "error_message":        r.error_message,
        "recipient_count":      r.recipient_count,
        "triggered_by":         r.triggered_by,
        "created_at":           r.created_at.isoformat() if r.created_at else None,
        "generated_at":         r.generated_at.isoformat() if r.generated_at else None,
        "emailed_at":           r.emailed_at.isoformat() if r.emailed_at else None,
        "has_file":             bool(r.file_path and os.path.exists(r.file_path)),
    }


# ── Schemas ───────────────────────────────────────────────────────────────────

class ExportRequest(BaseModel):
    start_date: str         # ISO datetime string e.g. "2025-03-01T00:00:00Z"
    end_date: str           # ISO datetime string e.g. "2025-03-31T23:59:59Z"
    report_type: str = "ppe"


# ── GET /projects/{id}/reports ────────────────────────────────────────────────

@router.get("")
def list_reports(
    project_id: int,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=500),
    triggered_by: Optional[str] = Query(default=None),
    exclude_custom: bool = Query(default=False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all reports for a project, newest first. Paginated.
    triggered_by=scheduled|manual — filter by trigger source
    exclude_custom=true           — hide on-demand custom date-range exports (delivery log view)
    """
    _require_member(project_id, user, db)
    from ...models.project_report import ProjectReport

    q = db.query(ProjectReport).filter(ProjectReport.project_id == project_id)
    if triggered_by in ("scheduled", "manual"):
        q = q.filter(ProjectReport.triggered_by == triggered_by)
    if exclude_custom:
        # Custom exports have period_label starting with "custom_"
        q = q.filter(~ProjectReport.period_label.like("custom_%"))

    total = q.count()
    reports = (
        q
        .order_by(ProjectReport.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    from ...models.project_report import ReportRecipient

    # Fetch all recipients for this page's reports in one query
    report_ids = [r.id for r in reports]
    all_recipients = (
        db.query(ReportRecipient)
        .filter(ReportRecipient.report_id.in_(report_ids))
        .all()
    ) if report_ids else []

    recipients_by_report: dict[int, list] = {}
    for rec in all_recipients:
        recipients_by_report.setdefault(rec.report_id, []).append({
            "id":           rec.id,
            "user_id":      rec.user_id,
            "email":        rec.email,
            "full_name":    rec.full_name,
            "role":         rec.role,
            "delivered":    rec.delivered,
            "delivered_at": rec.delivered_at.isoformat() if rec.delivered_at else None,
        })

    def _serialize_with_recipients(r):
        base = _serialize_report(r)
        base["recipients"] = recipients_by_report.get(r.id, [])
        return base

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "reports": [_serialize_with_recipients(r) for r in reports],
    }


# ── POST /projects/{id}/reports/export ───────────────────────────────────────

@router.post("/export")
async def export_report(
    project_id: int,
    body: ExportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    On-demand PDF export. PDF generation runs in a thread-pool executor so the
    event loop stays free for other requests during long builds.
    Also saves a record to project_reports with triggered_by=manual.

    Edge cases:
    - Date range > 366 days → 400
    - end_date <= start_date → 400
    - Archived project → allowed (read-only, reports are reads)
    - No incidents in range → PDF still generated with "no violations" section
    """
    project, membership = _require_member(project_id, user, db)
    _require_report_role(membership, project, user)

    # Parse dates
    try:
        period_start = datetime.fromisoformat(body.start_date.replace("Z", "+00:00"))
        period_end   = datetime.fromisoformat(body.end_date.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601 e.g. 2025-03-01T00:00:00Z")

    if period_end <= period_start:
        raise HTTPException(status_code=400, detail="end_date must be after start_date.")

    span_days = (period_end - period_start).total_seconds() / 86400
    if span_days > 366 and body.report_type != "risk":
        raise HTTPException(status_code=400, detail="Date range cannot exceed one year (366 days).")

    from ...models.project_report import ProjectReport, ReportStatus, ReportTrigger
    from ...services.pdf_report_service import (
        generate_ppe_pdf_report,
        generate_workforce_pdf_report,
        generate_activity_pdf_report,
        generate_risk_pdf_report,
        ReportGenerationError,
    )

    _GENERATORS = {
        "ppe":       generate_ppe_pdf_report,
        "workforce": generate_workforce_pdf_report,
        "activity":  generate_activity_pdf_report,
        "risk":      generate_risk_pdf_report,
    }
    if body.report_type not in _GENERATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported report type '{body.report_type}'. Supported types: ppe, workforce, activity, risk.",
        )

    period_label = f"custom_{period_start.strftime('%Y%m%d')}_{period_end.strftime('%Y%m%d')}"

    # Create pending record
    report = ProjectReport(
        project_id=project_id,
        report_type=body.report_type,
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        frequency="custom",
        status=ReportStatus.GENERATING,
        triggered_by=ReportTrigger.MANUAL,
        triggered_by_user_id=user.id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    try:
        loop = asyncio.get_event_loop()
        pdf_bytes = await loop.run_in_executor(
            None,
            partial(_GENERATORS[body.report_type], db, project_id, period_start, period_end, "manual"),
        )
    except ReportGenerationError as e:
        report.status = ReportStatus.FAILED
        report.error_message = str(e)
        db.commit()
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")
    except Exception as e:
        report.status = ReportStatus.FAILED
        report.error_message = f"Unexpected error: {str(e)}"
        db.commit()
        logger.error(f"[reports] Unexpected export error for project {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="An unexpected error occurred. Please try again.")

    # For manual exports, no need to save to disk — we stream directly to browser
    # file_path remains None, report is purely transient

    report.status = ReportStatus.READY
    report.generated_at = datetime.now(timezone.utc)
    report.recipient_count = 0  # Manual export — not emailed
    db.commit()

    log_event(db, "report_exported_manual", user.id, {
        "report_id": report.id,
        "project_id": project_id,
        "period_label": period_label,
    })
    db.commit()

    # Build filename
    project_slug = project.name.replace(" ", "_")[:40]
    filename = f"PPE_Safety_Report_{project_slug}_{period_label}.pdf"

    import io as _io
    return StreamingResponse(
        _io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Report-Id": str(report.id),
        },
    )


# ── GET /projects/{id}/reports/{report_id}/recipients ────────────────────────

@router.get("/{report_id}/recipients")
def get_report_recipients(
    project_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the saved recipient list for a report (audit trail)."""
    _require_member(project_id, user, db)
    from ...models.project_report import ProjectReport, ReportRecipient

    report = db.query(ProjectReport).filter(
        ProjectReport.id == report_id,
        ProjectReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    rows = db.query(ReportRecipient).filter(ReportRecipient.report_id == report_id).all()
    return [
        {
            "id":           r.id,
            "user_id":      r.user_id,
            "email":        r.email,
            "full_name":    r.full_name,
            "role":         r.role,
            "delivered":    r.delivered,
            "delivered_at": r.delivered_at.isoformat() if r.delivered_at else None,
        }
        for r in rows
    ]


# ── GET /projects/{id}/reports/{report_id} ────────────────────────────────────

@router.get("/{report_id}")
def get_report(
    project_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a single report's status. Used by frontend polling while status=generating."""
    _require_member(project_id, user, db)
    from ...models.project_report import ProjectReport

    report = db.query(ProjectReport).filter(
        ProjectReport.id == report_id,
        ProjectReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")
    return _serialize_report(report)


# ── GET /projects/{id}/reports/{report_id}/download ──────────────────────────

@router.get("/{report_id}/download")
def download_report(
    project_id: int,
    report_id: int,
    inline: bool = Query(default=False),   # ?inline=true → open in browser, false → download
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Stream the PDF file.
    ?inline=true  → opens in browser (for View button)
    ?inline=false → triggers download (default)
    """
    project, membership = _require_member(project_id, user, db)
    _require_report_role(membership, project, user)

    from ...models.project_report import ProjectReport, ReportStatus

    report = db.query(ProjectReport).filter(
        ProjectReport.id == report_id,
        ProjectReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    if report.status not in (ReportStatus.READY, ReportStatus.EMAILED, ReportStatus.EMAIL_FAILED):
        raise HTTPException(
            status_code=400,
            detail=f"Report is not ready (current status: {report.status})."
        )

    if not report.file_path or not os.path.exists(report.file_path):
        # File missing — regenerate on the fly
        from ...services.pdf_report_service import generate_ppe_pdf_report, ReportGenerationError
        try:
            pdf_bytes = generate_ppe_pdf_report(db, project_id, report.period_start, report.period_end, "manual")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Report file unavailable and regeneration failed: {str(e)}")

        period_label = report.period_label or "report"
        project_slug = project.name.replace(" ", "_")[:40]
        filename = f"PPE_Safety_Report_{project_slug}_{period_label}.pdf"
        disposition = "inline" if inline else f'attachment; filename="{filename}"'

        return StreamingResponse(
            iter([pdf_bytes]),
            media_type="application/pdf",
            headers={"Content-Disposition": disposition},
        )

    period_label = report.period_label or "report"
    project_slug = project.name.replace(" ", "_")[:40]
    filename = f"PPE_Safety_Report_{project_slug}_{period_label}.pdf"
    disposition = "inline" if inline else f'attachment; filename="{filename}"'

    return FileResponse(
        report.file_path,
        media_type="application/pdf",
        headers={"Content-Disposition": disposition},
    )


# ── POST /projects/{id}/reports/{report_id}/resend ────────────────────────────

class ResendRequest(BaseModel):
    recipient_email: Optional[str] = None   # None = resend to all current active members


@router.post("/{report_id}/resend")
def resend_report_email(
    project_id: int,
    report_id: int,
    body: ResendRequest = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Resend report email.
    - recipient_email=None  → resend to ALL current active members (PM/Supervisor/Safety Officer)
    - recipient_email=X     → resend only to that specific email address

    PM role required. Regenerates PDF fresh (no disk dependency — uses Cloudinary or regenerates).
    Re-fetches current active members so removed users are never re-emailed.
    """
    if body is None:
        body = ResendRequest()

    project, membership = _require_member(project_id, user, db)
    _require_pm(membership, project, user)

    from ...models.project_report import ProjectReport, ReportStatus, ReportRecipient
    from ...models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    from ...models.user import User as UserModel
    from ...services.email import send_report_email
    from ...services.pdf_report_service import generate_ppe_pdf_report, ReportGenerationError

    report = db.query(ProjectReport).filter(
        ProjectReport.id == report_id,
        ProjectReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    if report.status not in (ReportStatus.READY, ReportStatus.EMAILED, ReportStatus.EMAIL_FAILED):
        raise HTTPException(
            status_code=400,
            detail=f"Can only resend a report that is ready or previously emailed (current status: {report.status})."
        )

    # ── Regenerate PDF (fresh, no disk dependency) ────────────────────────────
    try:
        pdf_bytes = generate_ppe_pdf_report(db, project_id, report.period_start, report.period_end, "manual")
    except ReportGenerationError as e:
        raise HTTPException(status_code=500, detail=f"Failed to regenerate report PDF: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error regenerating PDF: {str(e)}")

    # ── Build recipient list ──────────────────────────────────────────────────
    members = (
        db.query(ProjectMembership, UserModel)
        .join(UserModel, UserModel.id == ProjectMembership.user_id)
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

    seen_ids: set[int] = set()
    all_recipients = []
    for membership_row, u in members:
        if u.id not in seen_ids:
            seen_ids.add(u.id)
            all_recipients.append({
                "email": u.email,
                "name": u.full_name or u.email,
                "role": membership_row.project_role.value,
                "user_id": u.id,
            })

    # Filter to single recipient if specified
    if body.recipient_email:
        recipients = [r for r in all_recipients if r["email"] == body.recipient_email]
        if not recipients:
            raise HTTPException(
                status_code=400,
                detail=f"{body.recipient_email} is not an active team member on this project."
            )
    else:
        recipients = all_recipients

    if not recipients:
        raise HTTPException(
            status_code=400,
            detail="No eligible recipients. No active Project Managers, Site Supervisors, or Safety Officers on this project."
        )

    from ...core.config import settings as _settings
    period_label = report.period_label or report.period_start.strftime("%Y-%m-%d")
    email_result = send_report_email(
        recipients=[{"email": r["email"], "name": r["name"], "role": r["role"]} for r in recipients],
        project_name=project.name,
        period_label=period_label,
        period_start=report.period_start,
        period_end=report.period_end,
        pdf_bytes=pdf_bytes,
        download_url=f"{_settings.frontend_url}/projects/{project_id}/reports/safety",
    )

    sent_count = email_result.get("sent", 0)
    failed_emails = email_result.get("failed", [])

    # Update existing recipient audit rows (upsert — never add duplicate rows)
    failed_set = set(failed_emails)
    now_ts = datetime.now(timezone.utc)
    for r in recipients:
        delivered = r["email"] not in failed_set
        existing_rec = db.query(ReportRecipient).filter(
            ReportRecipient.report_id == report.id,
            ReportRecipient.email == r["email"],
        ).first()
        if existing_rec:
            existing_rec.delivered    = delivered
            existing_rec.delivered_at = now_ts if delivered else None
            existing_rec.full_name    = r["name"]
            existing_rec.role         = r["role"]
        else:
            db.add(ReportRecipient(
                report_id    = report.id,
                user_id      = r["user_id"],
                email        = r["email"],
                full_name    = r["name"],
                role         = r["role"],
                delivered    = delivered,
                delivered_at = now_ts if delivered else None,
            ))

    if not body.recipient_email:
        # Full resend — update report status
        report.emailed_at = now_ts
        report.status = ReportStatus.EMAILED if sent_count > 0 else ReportStatus.EMAIL_FAILED

    if failed_emails:
        logger.warning(f"[reports] Resend partial failure for report {report_id}: {failed_emails}")

    log_event(db, "report_resent", user.id, {
        "report_id": report_id,
        "project_id": project_id,
        "recipient_email": body.recipient_email,
        "sent": sent_count,
        "failed": failed_emails,
    })
    db.commit()

    if sent_count == 0:
        raise HTTPException(
            status_code=500,
            detail="Email delivery failed. Please check email configuration."
        )

    target = body.recipient_email or f"{sent_count} recipient{'s' if sent_count != 1 else ''}"
    return {
        "success": True,
        "sent": sent_count,
        "failed": failed_emails,
        "message": f"Report resent to {target}." + (f" {len(failed_emails)} failure(s)." if failed_emails else ""),
    }


# ── POST /projects/{id}/reports/trigger ──────────────────────────────────────

class TriggerReportRequest(BaseModel):
    period: str = "weekly"   # daily | weekly | monthly | preview


@router.post("/trigger", status_code=202)
def trigger_report_manual(
    project_id: int,
    body: TriggerReportRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Manually trigger a report for this project.
    period="preview" → last 7 days up to now (no idempotency, always fresh).
    Other periods → last completed daily/weekly/monthly period (idempotent).
    PM role required. Returns 202 immediately; report generates in background.
    """
    project, membership = _require_member(project_id, user, db)
    _require_pm(membership, project, user)

    if body.period not in ("daily", "weekly", "monthly", "preview"):
        raise HTTPException(status_code=400, detail="period must be one of: daily, weekly, monthly, preview")

    from ...models.project_report import ProjectReport, ReportStatus, ReportTrigger
    from ...api.routes.webhooks import _compute_period, _compute_preview_period, _run_report_background

    if body.period == "preview":
        period_start, period_end, period_label = _compute_preview_period()
    else:
        period_start, period_end, period_label = _compute_period(body.period)

    # Idempotency check (skip for preview — always a fresh snapshot)
    if body.period != "preview":
        existing = (
            db.query(ProjectReport)
            .filter(
                ProjectReport.project_id == project_id,
                ProjectReport.period_label == period_label,
                ProjectReport.report_type == "ppe",
                ProjectReport.status.in_([ReportStatus.READY, ReportStatus.EMAILED, ReportStatus.GENERATING]),
            )
            .first()
        )
        if existing:
            return {
                "skipped": True,
                "reason": "already_generated",
                "report_id": existing.id,
                "status": existing.status,
                "period_label": period_label,
            }

    report = ProjectReport(
        project_id=project_id,
        report_type="ppe",
        period_label=period_label,
        period_start=period_start,
        period_end=period_end,
        frequency=body.period,
        status=ReportStatus.GENERATING,
        triggered_by=ReportTrigger.MANUAL,
        triggered_by_user_id=user.id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    log_event(db, "report_triggered_manual", user.id, {
        "report_id": report.id,
        "project_id": project_id,
        "period_label": period_label,
    })
    db.commit()

    thread = threading.Thread(
        target=_run_report_background,
        args=(report.id, project_id, period_start, period_end, ReportTrigger.MANUAL),
        daemon=True,
        name=f"report-manual-{report.id}",
    )
    thread.start()

    return {
        "accepted": True,
        "report_id": report.id,
        "project_id": project_id,
        "period_label": period_label,
        "period_start": period_start.isoformat(),
        "period_end": period_end.isoformat(),
    }


# ── GET /projects/{id}/reports/scheduler/status ──────────────────────────────

@router.get("/scheduler/status")
def get_scheduler_status(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return scheduler status for this project (frequency, enabled, next send time)."""
    _require_member(project_id, user, db)

    from ...models.project_settings import ProjectSettings
    from ...services.report_scheduler import compute_next_send_at, get_status as _sched_status, _last_run_at, _last_summary

    ps = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    frequency = (ps.report_frequency if ps else "weekly") or "weekly"
    enabled = ps.reports_scheduler_enabled if ps else True

    next_send_at = compute_next_send_at(frequency) if enabled else None

    global_status = _sched_status()
    return {
        "enabled": enabled,
        "frequency": frequency,
        "next_send_at": next_send_at.isoformat() if next_send_at else None,
        "last_run_at": global_status.get("last_run_at").isoformat() if global_status.get("last_run_at") else None,
        "last_summary": global_status.get("last_summary"),
        "is_running": global_status.get("is_running", False),
    }


# ── PATCH /projects/{id}/reports/scheduler/config ────────────────────────────

class SchedulerConfigRequest(BaseModel):
    frequency: Optional[str] = None   # daily | weekly | monthly
    enabled: Optional[bool] = None


@router.patch("/scheduler/config")
def update_scheduler_config(
    project_id: int,
    body: SchedulerConfigRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update this project's report frequency and/or scheduler enabled flag. PM only."""
    project, membership = _require_member(project_id, user, db)
    _require_pm(membership, project, user)

    from ...models.project_settings import ProjectSettings
    from ...services.report_scheduler import compute_next_send_at, get_status as _sched_status

    if body.frequency and body.frequency not in ("daily", "weekly", "monthly"):
        raise HTTPException(status_code=400, detail="frequency must be one of: daily, weekly, monthly")

    ps = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    if not ps:
        ps = ProjectSettings(project_id=project_id)
        db.add(ps)

    if body.frequency is not None:
        ps.report_frequency = body.frequency
    if body.enabled is not None:
        ps.reports_scheduler_enabled = body.enabled

    ps.updated_by = user.id
    db.commit()
    db.refresh(ps)

    frequency = ps.report_frequency or "weekly"
    enabled = ps.reports_scheduler_enabled
    next_send_at = compute_next_send_at(frequency) if enabled else None
    global_status = _sched_status()

    log_event(db, "report_scheduler_config_updated", user.id, {
        "project_id": project_id,
        "frequency": ps.report_frequency,
        "enabled": ps.reports_scheduler_enabled,
    })
    db.commit()

    return {
        "enabled": enabled,
        "frequency": frequency,
        "next_send_at": next_send_at.isoformat() if next_send_at else None,
        "last_run_at": global_status.get("last_run_at").isoformat() if global_status.get("last_run_at") else None,
        "last_summary": global_status.get("last_summary"),
        "is_running": global_status.get("is_running", False),
    }


# ── POST /projects/{id}/reports/scheduler/trigger ────────────────────────────

@router.post("/scheduler/trigger", status_code=202)
def trigger_scheduler_now(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Immediately generate and email all report types for this project. PM only."""
    project, membership = _require_member(project_id, user, db)
    _require_pm(membership, project, user)

    from ...models.project_settings import ProjectSettings
    from ...services.report_scheduler import trigger_now as _trigger_now

    ps = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    frequency = (ps.report_frequency if ps else "weekly") or "weekly"

    _trigger_now(project_id=project_id, frequency=frequency)

    log_event(db, "report_scheduler_triggered_manual", user.id, {
        "project_id": project_id,
        "frequency": frequency,
    })
    db.commit()

    return {
        "accepted": True,
        "project_id": project_id,
        "frequency": frequency,
        "report_types": ["ppe", "workforce", "activity", "risk"],
        "message": f"Generating {len(['ppe', 'workforce', 'activity', 'risk'])} reports for the last {'7 days' if frequency == 'weekly' else '24 hours' if frequency == 'daily' else '30 days'}. Check the delivery log in a few moments.",
    }


# ── DELETE /projects/{id}/reports/{report_id} ─────────────────────────────────

@router.delete("/{report_id}", status_code=204)
def delete_report(
    project_id: int,
    report_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete report record, Cloudinary asset, and any local file. PM role required."""
    project, membership = _require_member(project_id, user, db)
    _require_pm(membership, project, user)

    from ...models.project_report import ProjectReport

    report = db.query(ProjectReport).filter(
        ProjectReport.id == report_id,
        ProjectReport.project_id == project_id,
    ).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found.")

    # Delete local PDF file if it exists
    if report.file_path and os.path.exists(report.file_path):
        try:
            os.remove(report.file_path)
        except Exception as e:
            logger.warning(f"[reports] Could not delete local file {report.file_path}: {e}")

    log_event(db, "report_deleted", user.id, {
        "report_id": report_id,
        "project_id": project_id,
        "period_label": report.period_label,
    })
    db.delete(report)
    db.commit()
    return None
