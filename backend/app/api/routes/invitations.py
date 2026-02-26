import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ...core.config import settings
from ...services import send_invitation_email
from ...models.project import Project, ProjectStatus
from ...models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from ...models.project_invitation import ProjectInvitation, InvitationStatus
from ...models.user import User, PlatformRole
from ...schemas.project import InvitationOut
from ..deps import get_db, get_current_user, get_current_user_optional, log_event

router = APIRouter(tags=["invitations"])


def _mask_email(email: str) -> str:
    """j***@gmail.com or h***o@gmail.com for longer addresses"""
    try:
        local, domain = email.split("@", 1)
        if len(local) <= 2:
            masked = local[0] + "***"
        elif len(local) <= 4:
            masked = local[:2] + "***"
        else:
            masked = local[0] + "***" + local[-1]
        return f"{masked}@{domain}"
    except Exception:
        return "***"


def _get_pm_for_project(db: Session, project_id: int, user_id: int) -> ProjectMembership:
    """Return caller's PM membership or raise 403."""
    m = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user_id,
        ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Project Manager access required")
    return m


@router.get("/invitations/me", response_model=List[InvitationOut])
def get_my_invitations(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    now = datetime.now(timezone.utc)
    rows = (
        db.query(ProjectInvitation, Project, User)
        .join(Project, Project.id == ProjectInvitation.project_id)
        .join(User, User.id == ProjectInvitation.invited_by)
        .filter(
            ProjectInvitation.email == user.email.lower(),
            ProjectInvitation.status == InvitationStatus.PENDING,
            ProjectInvitation.expires_at > now,
        )
        .all()
    )

    return [
        InvitationOut(
            id=inv.id,
            token=inv.token,
            email=inv.email,
            project_id=inv.project_id,
            role=inv.role,
            status=inv.status.value,
            expires_at=inv.expires_at,
            project_name=project.name,
            project_logo_url=project.logo_url,
            invited_by_name=inviter.full_name,
        )
        for inv, project, inviter in rows
    ]


@router.post("/invitations/{token}/accept")
def accept_invitation(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.token == token
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=400, detail="Invitation already used or cancelled")

    now = datetime.now(timezone.utc)
    if invitation.expires_at < now:
        invitation.status = InvitationStatus.EXPIRED
        db.commit()
        raise HTTPException(status_code=400, detail="Invitation has expired")

    # Normalize both emails for comparison (strip + lowercase)
    normalized_invite_email = (invitation.email or "").strip().lower()
    normalized_user_email = (user.email or "").strip().lower()
    if normalized_invite_email != normalized_user_email:
        raise HTTPException(status_code=403, detail="This invitation is not for your account")

    # Block acceptance for archived projects
    project = db.query(Project).filter(Project.id == invitation.project_id).first()
    if project and project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Cannot join an archived project")

    # One role per user per project — update if already a member
    existing = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == invitation.project_id,
        ProjectMembership.user_id == user.id,
    ).first()
    if existing:
        if existing.status == MembershipStatus.ACTIVE and existing.project_role == invitation.role:
            raise HTTPException(status_code=409, detail="You already have this role in the project")
        # Update role (and reactivate if previously removed)
        existing.project_role = invitation.role
        existing.status = MembershipStatus.ACTIVE
        existing.invited_by = invitation.invited_by
        existing.joined_at = now
    else:
        membership = ProjectMembership(
            user_id=user.id,
            project_id=invitation.project_id,
            project_role=invitation.role,
            status=MembershipStatus.ACTIVE,
            invited_by=invitation.invited_by,
            joined_at=now,
        )
        db.add(membership)

    invitation.status = InvitationStatus.ACCEPTED
    invitation.accepted_at = now

    log_event(
        db,
        "invitation_accepted",
        user.id,
        {"project_id": invitation.project_id, "role": invitation.role},
        request=request,
        target_type="project",
        target_id=invitation.project_id,
    )
    db.commit()

    # Notify the person who sent the invitation + admins
    from ...services.notification_service import notify_users, notify_admins
    if invitation.invited_by:
        notify_users(
            db, [invitation.invited_by],
            type="invitation_accepted",
            title="Invitation Accepted",
            message=f"{user.username or user.email} accepted the project invitation.",
            category="project",
            priority="medium",
            action_url=f"/projects/{invitation.project_id}/members",
            project_id=invitation.project_id,
        )
    notify_admins(
        db,
        type="invitation_accepted",
        title="Team Member Joined",
        message=f"{user.username or user.email} joined project as {invitation.role}.",
        category="project",
        priority="low",
        action_url="/admin/projects/list",
        project_id=invitation.project_id,
    )
    db.commit()

    return {"ok": True, "project_id": invitation.project_id}


@router.post("/invitations/{token}/reject")
def reject_invitation(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.token == token
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=400, detail="Invitation already used or cancelled")

    # Normalize both emails for comparison (strip + lowercase)
    normalized_invite_email = (invitation.email or "").strip().lower()
    normalized_user_email = (user.email or "").strip().lower()
    if normalized_invite_email != normalized_user_email:
        raise HTTPException(status_code=403, detail="This invitation is not for your account")

    now = datetime.now(timezone.utc)
    if invitation.expires_at < now:
        invitation.status = InvitationStatus.EXPIRED
        db.commit()
        raise HTTPException(status_code=400, detail="Invitation has expired")

    invitation.status = InvitationStatus.CANCELLED
    log_event(
        db,
        "invitation_rejected",
        user.id,
        {"project_id": invitation.project_id},
        request=request,
        target_type="project",
        target_id=invitation.project_id,
    )
    db.commit()

    # Notify the inviter
    from ...services.notification_service import notify_users
    if invitation.invited_by:
        notify_users(
            db, [invitation.invited_by],
            type="invitation_rejected",
            title="Invitation Declined",
            message=f"Your project invitation was declined.",
            category="project",
            priority="medium",
            action_url="/admin/invitations/list",
            project_id=invitation.project_id,
        )
        db.commit()

    return {"ok": True}


@router.post("/invitations/{invitation_id}/resend")
def resend_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Verify caller is PM for this project (or admin check handled via platform_role)
    is_admin = user.platform_role == PlatformRole.ADMIN
    if not is_admin:
        _get_pm_for_project(db, invitation.project_id, user.id)

    if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED):
        raise HTTPException(status_code=400, detail="Only pending or expired invitations can be resent")

    # Determine expiry: PM role gets 7 days, others 24h
    expiry = timedelta(days=7) if invitation.role == ProjectRole.PROJECT_MANAGER else timedelta(hours=24)

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

    return {"ok": True}


@router.patch("/invitations/{invitation_id}/cancel")
def cancel_invitation(
    invitation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    is_admin = user.platform_role == PlatformRole.ADMIN
    if not is_admin:
        _get_pm_for_project(db, invitation.project_id, user.id)

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending invitations can be cancelled")

    invitation.status = InvitationStatus.CANCELLED
    db.commit()

    return {"ok": True}


@router.get("/invite/{token}")
def inspect_invitation_public(
    token: str,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Public endpoint — auth optional. Returns invite preview with contextual fields."""
    now = datetime.now(timezone.utc)
    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.token == token,
    ).first()

    if not invitation:
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")

    # Distinguish specific error states for better frontend UX
    if invitation.status == InvitationStatus.ACCEPTED:
        raise HTTPException(status_code=400, detail="This invitation has already been accepted.")
    if invitation.status == InvitationStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="This invitation has been cancelled.")
    if invitation.status == InvitationStatus.EXPIRED or invitation.expires_at < now:
        if invitation.status != InvitationStatus.EXPIRED:
            invitation.status = InvitationStatus.EXPIRED
            db.commit()
        raise HTTPException(status_code=400, detail="This invitation has expired.")
    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=400, detail="Invalid or expired invitation")

    project = db.query(Project).filter(Project.id == invitation.project_id).first()

    # Does an account exist for the invited email?
    invited_user = db.query(User).filter(User.email == invitation.email.lower()).first()
    account_exists = invited_user is not None

    # Email match — only meaningful when caller is authenticated
    email_matches: Optional[bool] = None
    current_email_masked: Optional[str] = None
    if user is not None:
        # Normalize emails for comparison (strip + lowercase)
        normalized_user_email = (user.email or "").strip().lower()
        normalized_invite_email = (invitation.email or "").strip().lower()
        email_matches = normalized_user_email == normalized_invite_email
        if not email_matches:
            current_email_masked = _mask_email(user.email)

    # Real email for signup prefill — only when no account exists yet
    invited_email: Optional[str] = invitation.email if not account_exists else None

    return {
        "email": _mask_email(invitation.email),
        "project_name": project.name if project else "Unknown",
        "project_logo_url": project.logo_url if project else None,
        "role": invitation.role,
        "expires_at": invitation.expires_at.isoformat(),
        "account_exists": account_exists,
        "email_matches": email_matches,
        "invited_email": invited_email,
        "current_email_masked": current_email_masked,
    }
