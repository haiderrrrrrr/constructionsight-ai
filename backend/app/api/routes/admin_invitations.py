"""Admin endpoints for managing project invitations."""
import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from ...models.project_invitation import ProjectInvitation, InvitationStatus
from ...models.project_membership import ProjectRole
from ...models.project import Project
from ...models.user import User
from ...schemas.project import InvitationOut
from ..deps import get_db, require_admin, log_event
from ...services import send_invitation_email
from ...core.config import settings

router = APIRouter(prefix="/admin/invitations", tags=["admin-invitations"])


@router.get("", response_model=List[InvitationOut])
def list_all_invitations(
    status: Optional[str] = Query(None, description="Filter by status: pending, accepted, expired, cancelled"),
    project_id: Optional[int] = Query(None, description="Filter by project ID"),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """List all project invitations (admin only). Supports filtering by status and project."""
    query = db.query(ProjectInvitation, Project, User).join(
        Project, Project.id == ProjectInvitation.project_id
    ).join(
        User, User.id == ProjectInvitation.invited_by
    )

    # Filter by status if provided
    if status:
        valid_statuses = [s.value for s in InvitationStatus]
        if status not in valid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {', '.join(valid_statuses)}"
            )
        query = query.filter(ProjectInvitation.status == status)

    # Filter by project if provided
    if project_id:
        query = query.filter(ProjectInvitation.project_id == project_id)

    rows = query.order_by(ProjectInvitation.created_at.desc()).all()

    return [
        InvitationOut(
            id=inv.id,
            token=inv.token,
            email=inv.email,
            project_id=inv.project_id,
            role=inv.role,
            status=inv.status.value,
            expires_at=inv.expires_at,
            created_at=inv.created_at,
            project_name=project.name,
            project_logo_url=project.logo_url,
            invited_by_name=inviter.full_name,
        )
        for inv, project, inviter in rows
    ]


@router.get("/stats")
def get_invitation_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get invitation statistics (counts by status)."""
    total_pending = db.query(ProjectInvitation).filter(
        ProjectInvitation.status == InvitationStatus.PENDING
    ).count()
    total_accepted = db.query(ProjectInvitation).filter(
        ProjectInvitation.status == InvitationStatus.ACCEPTED
    ).count()
    total_expired = db.query(ProjectInvitation).filter(
        ProjectInvitation.status == InvitationStatus.EXPIRED
    ).count()
    total_cancelled = db.query(ProjectInvitation).filter(
        ProjectInvitation.status == InvitationStatus.CANCELLED
    ).count()

    return {
        "pending": total_pending,
        "accepted": total_accepted,
        "expired": total_expired,
        "cancelled": total_cancelled,
    }


@router.post("/{invitation_id}/resend")
def admin_resend_invitation(
    invitation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Resend an invitation email (admin only)."""
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED, InvitationStatus.CANCELLED):
        raise HTTPException(
            status_code=400,
            detail="Only pending, expired, or cancelled invitations can be resent"
        )

    # Reset token and expiry
    expiry = (
        timedelta(days=7)
        if invitation.role == ProjectRole.PROJECT_MANAGER
        else timedelta(hours=24)
    )

    invitation.token = secrets.token_urlsafe(48)
    invitation.expires_at = datetime.now(timezone.utc) + expiry
    invitation.status = InvitationStatus.PENDING
    db.commit()

    project = db.query(Project).filter(Project.id == invitation.project_id).first()
    send_invitation_email(
        to_email=invitation.email,
        project_name=project.name if project else "Project",
        role=invitation.role.replace("_", " ").title(),
        invite_url=f"{settings.frontend_url}/invite/{invitation.token}",
        to_name=invitation.invited_name or "",
    )

    log_event(
        db,
        "invitation_resent_by_admin",
        admin.id,
        {"invitation_id": invitation_id, "email": invitation.email, "project_id": invitation.project_id},
        request=request,
        target_type="project",
        target_id=invitation.project_id,
    )
    db.commit()

    return {"ok": True, "token": invitation.token}


@router.patch("/{invitation_id}/cancel")
def admin_cancel_invitation(
    invitation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Cancel an invitation (admin only)."""
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(
            status_code=400,
            detail="Only pending invitations can be cancelled"
        )

    invitation.status = InvitationStatus.CANCELLED
    db.commit()

    log_event(
        db,
        "invitation_cancelled_by_admin",
        admin.id,
        {"invitation_id": invitation_id, "email": invitation.email, "project_id": invitation.project_id},
        request=request,
        target_type="project",
        target_id=invitation.project_id,
    )
    db.commit()

    return {"ok": True}


@router.get("/{invitation_id}", response_model=InvitationOut)
def get_invitation_details(
    invitation_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get invitation details (admin only)."""
    row = db.query(ProjectInvitation, Project, User).join(
        Project, Project.id == ProjectInvitation.project_id
    ).join(
        User, User.id == ProjectInvitation.invited_by
    ).filter(
        ProjectInvitation.id == invitation_id
    ).first()

    if not row:
        raise HTTPException(status_code=404, detail="Invitation not found")

    inv, project, inviter = row
    return InvitationOut(
        id=inv.id,
        token=inv.token,
        email=inv.email,
        project_id=inv.project_id,
        role=inv.role,
        status=inv.status.value,
        expires_at=inv.expires_at,
        created_at=inv.created_at,
        project_name=project.name,
        project_logo_url=project.logo_url,
        invited_by_name=inviter.full_name,
    )


class InvitationsExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = "Administrator"


@router.post("/export/pdf")
def export_invitations_pdf(
    body: InvitationsExportPdfBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Stream a PDF listing of all invitations, matching the Projects export visual style."""
    from ...services.pdf_report_service import generate_invitations_pdf_report, ReportGenerationError

    filter_val = str(body.filter or "all").lower()
    filter_label_map = {
        "all": "All Invitations",
        "pending": "Pending Invitations",
        "accepted": "Accepted Invitations",
        "expired": "Expired Invitations",
        "cancelled": "Cancelled Invitations",
    }
    filter_label = filter_label_map.get(filter_val, "All Invitations")

    now = datetime.now(timezone.utc)

    query = db.query(ProjectInvitation, Project, User).join(
        Project, Project.id == ProjectInvitation.project_id
    ).join(
        User, User.id == ProjectInvitation.invited_by
    )

    if filter_val == "pending":
        query = query.filter(
            and_(
                ProjectInvitation.status == InvitationStatus.PENDING,
                ProjectInvitation.expires_at > now,
            )
        )
    elif filter_val == "accepted":
        query = query.filter(ProjectInvitation.status == InvitationStatus.ACCEPTED)
    elif filter_val == "cancelled":
        query = query.filter(ProjectInvitation.status == InvitationStatus.CANCELLED)
    elif filter_val == "expired":
        query = query.filter(
            or_(
                ProjectInvitation.status == InvitationStatus.EXPIRED,
                and_(
                    ProjectInvitation.status == InvitationStatus.PENDING,
                    ProjectInvitation.expires_at <= now,
                ),
            )
        )

    rows = query.order_by(ProjectInvitation.created_at.desc()).all()
    invitations = [
        {
            "project_name": project.name,
            "email": inv.email,
            "role": inv.role,
            "invited_by_name": inviter.full_name,
            "created_at": inv.created_at,
            "expires_at": inv.expires_at,
            "status": inv.status.value,
        }
        for inv, project, inviter in rows
    ]

    generated_by = str(body.generated_by_name or admin.full_name or "Administrator")

    try:
        pdf_bytes = generate_invitations_pdf_report(
            invitations=invitations,
            filter_label=filter_label,
            generated_by=generated_by,
        )
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    import io
    from datetime import date
    filename = f"Invitations_Export_{date.today().isoformat()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
