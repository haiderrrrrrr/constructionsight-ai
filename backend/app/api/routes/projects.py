import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...core.config import settings
from ...services import send_invitation_email, upload_image, delete_asset
from ...models.project import Project, ProjectStatus
from ...models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from ...models.project_invitation import ProjectInvitation, InvitationStatus
from ...models.user import User
from ...schemas.project import (
    ProjectSetup,
    ProjectWithRoleOut,
    ProjectOut,
    MemberOut,
    InviteRequest,
    UserListOut,
    ChangeMemberRole,
    ProjectEdit,
)
from ..deps import get_db, get_current_user, log_event

router = APIRouter(prefix="/projects", tags=["projects"])


def _get_membership(db: Session, project_id: int, user_id: int) -> ProjectMembership:
    """Return active membership or raise 403."""
    m = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    return m


def _require_pm(db: Session, project_id: int, user_id: int):
    pm = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user_id,
        ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not pm:
        raise HTTPException(status_code=403, detail="Project Manager access required")


def _block_archived(project: Project):
    if project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Project is archived")


@router.get("", response_model=List[ProjectWithRoleOut])
def list_my_projects(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ...models.pinned_project import PinnedProject

    rows = db.query(ProjectMembership, Project).join(
        Project, Project.id == ProjectMembership.project_id
    ).filter(
        ProjectMembership.user_id == user.id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).all()

    # Get pinned project IDs for this user
    pinned_ids = db.query(PinnedProject.project_id).filter(
        PinnedProject.user_id == user.id
    ).all()
    pinned_ids = {row[0] for row in pinned_ids}

    results = []
    for m, project in rows:
        out = ProjectWithRoleOut.model_validate(project)
        out.my_role = m.project_role.value
        out.my_email = user.email
        out.is_pinned = project.id in pinned_ids
        results.append(out)

    # Sort: pinned first, then unpinned
    results.sort(key=lambda x: (not x.is_pinned, x.created_at))
    return results


@router.get("/{project_id}", response_model=ProjectWithRoleOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    from ...models.pinned_project import PinnedProject
    out = ProjectWithRoleOut.model_validate(project)
    out.my_role = membership.project_role.value
    out.my_email = user.email
    out.is_pinned = db.query(PinnedProject).filter(
        PinnedProject.user_id == user.id,
        PinnedProject.project_id == project_id,
    ).first() is not None
    return out


@router.patch("/{project_id}/setup", response_model=ProjectOut)
def setup_project(
    request: Request,
    project_id: int,
    body: ProjectSetup,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if project.status in (ProjectStatus.ACTIVE, ProjectStatus.COMPLETED):
        raise HTTPException(status_code=400, detail="Cannot edit setup for an active or completed project")

    # Status transition: DRAFT → SETUP_IN_PROGRESS on first save
    _transitioning_to_setup = project.status == ProjectStatus.DRAFT
    if _transitioning_to_setup:
        project.status = ProjectStatus.SETUP_IN_PROGRESS
        log_event(
            db,
            "project_setup_started",
            user.id,
            {"project_id": project_id},
            request=request,
            target_type="project",
            target_id=project_id,
        )

    # Apply only the non-None fields
    update_data = body.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(project, field, value)

    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)

    if _transitioning_to_setup:
        # Notify admins that PM started setup
        from ...services.notification_service import notify_admins
        notify_admins(
            db,
            type="project_setup_started",
            title=f"Project '{project.name}' setup started",
            message=f"The project manager has started setting up the project.",
            category="project",
            priority="low",
            action_url="/admin/projects/list",
            project_id=project.id,
        )
        db.commit()

    return project


@router.post("/{project_id}/activate", response_model=ProjectOut)
def activate_project(
    request: Request,
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if project.status != ProjectStatus.SETUP_IN_PROGRESS:
        raise HTTPException(
            status_code=400,
            detail="Project must be in setup_in_progress before activating",
        )

    # Activation checklist
    active_pm = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not active_pm:
        raise HTTPException(status_code=400, detail="Project must have at least one active Project Manager")

    if not project.name or not project.location:
        raise HTTPException(status_code=400, detail="Complete required project details (name and location) before activating")

    # Check at least one camera assigned
    from ...models.project_camera import ProjectCamera
    camera_count = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).count()
    if camera_count == 0:
        raise HTTPException(status_code=400, detail="At least one camera must be assigned before activating")

    # Auto-create default settings if not exists
    from ...models.project_settings import ProjectSettings
    project_settings = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    if not project_settings:
        project_settings = ProjectSettings(project_id=project_id)
        db.add(project_settings)

    # Auto-seed default tasks on first activation
    from ...models.project_task import ProjectTask
    existing_tasks = db.query(ProjectTask).filter(ProjectTask.project_id == project_id).count()
    if existing_tasks == 0:
        _DEFAULT_TASKS = [
            ("Complete site safety assessment", "Conduct initial safety walkthrough and document all hazard points before work begins."),
            ("Verify camera coverage zones", "Confirm all assigned cameras are covering critical zones and recording properly."),
            ("Brief site team on project protocols", "Walk the team through project procedures, access rules, and reporting requirements."),
        ]
        for title, description in _DEFAULT_TASKS:
            db.add(ProjectTask(project_id=project_id, title=title, description=description, created_by=user.id))

    # Seed project_camera_analytics rows for all assigned cameras (idempotent)
    from ...models.project_camera import ProjectCamera as _PC
    from ...models.project_camera_analytics import ProjectCameraAnalytics
    pcs = db.query(_PC).filter(_PC.project_id == project_id).all()
    for pc in pcs:
        existing_analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )
        if not existing_analytics:
            db.add(ProjectCameraAnalytics(project_camera_id=pc.id))

    project.status = ProjectStatus.ACTIVE
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_activated",
        user.id,
        {"project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()

    # Notify project members + admins that the project is now live
    from ...services.notification_service import notify_project_members, notify_admins
    notify_project_members(
        db, project.id,
        type="project_activated",
        title=f"Project '{project.name}' is now active",
        message="The project has been activated and is now live.",
        category="project",
        priority="high",
        action_url=f"/projects/{project.id}",
    )
    notify_admins(
        db,
        type="project_activated",
        title=f"Project '{project.name}' activated",
        message=f"Project has been activated by the project manager.",
        category="project",
        priority="medium",
        action_url="/admin/projects/list",
        project_id=project.id,
    )
    db.commit()

    # Send all pending invitation emails
    pending_invites = db.query(ProjectInvitation).filter(
        ProjectInvitation.project_id == project_id,
        ProjectInvitation.status == InvitationStatus.PENDING,
    ).all()
    for invite in pending_invites:
        send_invitation_email(
            to_email=invite.email,
            project_name=project.name,
            role=invite.role.replace("_", " ").title(),
            invite_url=f"{settings.frontend_url}/invite/{invite.token}",
        )
    print(f"[ACTIVATE] Queued {len(pending_invites)} invitation email(s) for project {project_id}")

    db.refresh(project)
    return project


@router.get("/{project_id}/members", response_model=List[MemberOut])
def list_members(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_membership(db, project_id, user.id)

    rows = db.query(ProjectMembership, User).join(
        User, User.id == ProjectMembership.user_id
    ).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).all()

    return [
        MemberOut(
            id=m.id,
            user_id=m.user_id,
            project_id=m.project_id,
            project_role=m.project_role.value,
            status=m.status.value,
            full_name=u.full_name,
            email=u.email,
            username=u.username,
            avatar_url=u.avatar_url,
            joined_at=m.joined_at,
        )
        for m, u in rows
    ]


class ProjectMembersExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = None


@router.post("/{project_id}/members/export/pdf")
def export_project_members_pdf(
    project_id: int,
    body: ProjectMembersExportPdfBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.platform_role != "admin":
        _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Members",
        "project_manager": "Project Managers",
        "site_supervisor": "Site Supervisors",
        "safety_officer": "Safety Officers",
        "data_analyst": "Data Analysts",
        "stakeholder": "Stakeholders",
    }
    filter_label = filter_map.get(filter_val, "All Members")

    rows = db.query(ProjectMembership, User).join(
        User, User.id == ProjectMembership.user_id
    ).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).all()

    members = []
    for m, u in rows:
        role = m.project_role.value if m.project_role else "—"
        if filter_val != "all" and role != filter_val:
            continue
        members.append((m, u, role))

    def _fmt_date_pk(v):
        if not v:
            return "—"
        try:
            pk = timezone(timedelta(hours=5))
            if getattr(v, "tzinfo", None) is None:
                v = v.replace(tzinfo=timezone.utc)
            return v.astimezone(pk).strftime("%b %d, %Y")
        except Exception:
            try:
                return v.strftime("%b %d, %Y")
            except Exception:
                return str(v)

    def _role_label(role: str) -> str:
        return str(role or "—").replace("_", " ").title()

    headers = ["Member", "Email", "Project Role", "Joined At"]
    rows_data = [
        [
            str(u.full_name or "—"),
            str(u.email or "—"),
            _role_label(role),
            _fmt_date_pk(getattr(m, "joined_at", None)),
        ]
        for (m, u, role) in members
    ]

    total = len(rows_data)
    by_role = {
        "project_manager": 0,
        "site_supervisor": 0,
        "safety_officer": 0,
        "data_analyst": 0,
        "stakeholder": 0,
    }
    for (_m, _u, role) in members:
        if role in by_role:
            by_role[role] += 1

    kpi_items = [
        (total, "Total", HexColor("#ffffff"), HexColor("#1e3a5f")),
        (by_role["site_supervisor"], "Supervisors", HexColor("#1d4ed8"), HexColor("#dbeafe")),
        (by_role["safety_officer"], "Safety", HexColor("#b91c1c"), HexColor("#fee2e2")),
        (by_role["data_analyst"], "Analysts", HexColor("#b45309"), HexColor("#fef3c7")),
        (by_role["stakeholder"], "Stakeholders", HexColor("#0f766e"), HexColor("#ccfbf1")),
    ]

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Project Members Report",
            headers=headers,
            rows=rows_data,
            col_widths=[140, 170, 110, 80],
            meta_pairs=[("Project", project.name), ("Report", "Members Directory")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or user.full_name or "Administrator"),
            kpi_items=kpi_items,
        )
        fname = f"Project_Members_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))



@router.get("/{project_id}/available-users", response_model=List[UserListOut])
def list_available_users(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all active non-admin users that can be added to this project."""
    from ...models.user import PlatformRole

    _get_membership(db, project_id, user.id)

    return (
        db.query(User)
        .filter(
            User.is_active == True,
            User.is_approved == True,
            User.platform_role == PlatformRole.USER,
            ~func.lower(func.trim(User.email)).in_(
                ["system@constructionsight.com", "system@constructionsightai.com"]
            ),
        )
        .order_by(User.full_name)
        .all()
    )


@router.post("/{project_id}/members/invite", status_code=201)
def invite_member(
    project_id: int,
    body: InviteRequest,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Block PM role invitations by non-admin users
    # Only admins can create PM assignments at project creation
    if body.role == ProjectRole.PROJECT_MANAGER.value:
        raise HTTPException(
            status_code=403,
            detail="Project Manager role can only be assigned by administrators during project creation"
        )

    email = body.email.lower()

    # Block inviting disabled users
    target_user = db.query(User).filter(User.email == email).first()
    if target_user and not target_user.is_active:
        raise HTTPException(status_code=400, detail="Cannot invite a disabled user account")

    # Check for existing active membership — block only if already has this exact role
    existing_member = db.query(ProjectMembership).join(
        User, User.id == ProjectMembership.user_id
    ).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
        User.email == email,
    ).first()
    if existing_member and existing_member.project_role == body.role:
        raise HTTPException(status_code=409, detail="User already has this role in the project")

    # Cancel any existing pending invitations for this user+project (role change supersedes old invite)
    db.query(ProjectInvitation).filter(
        ProjectInvitation.email == email,
        ProjectInvitation.project_id == project_id,
        ProjectInvitation.status == InvitationStatus.PENDING,
    ).update({"status": InvitationStatus.CANCELLED})

    # Always create invitation (invitation-first model)
    expiry = timedelta(days=7) if body.role == "project_manager" else timedelta(hours=24)
    invitation = ProjectInvitation(
        email=email,
        project_id=project_id,
        role=body.role,
        token=secrets.token_urlsafe(48),
        expires_at=datetime.now(timezone.utc) + expiry,
        invited_by=user.id,
        status=InvitationStatus.PENDING,
    )
    db.add(invitation)
    db.flush()
    log_event(
        db,
        "member_invited",
        user.id,
        {"project_id": project_id, "invitation_id": invitation.id, "email": email, "role": body.role},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()

    # Send email only if requested (default True)
    if body.send_email:
        send_invitation_email(
            to_email=email,
            project_name=project.name,
            role=body.role.replace("_", " ").title(),
            invite_url=f"{settings.frontend_url}/invite/{invitation.token}",
        )

    return {"ok": True, "method": "invitation"}


@router.delete("/{project_id}/members/{target_user_id}")
def remove_member(
    project_id: int,
    target_user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    caller_membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Get target's active membership
    target_membership = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == target_user_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()

    if not target_membership:
        # Check if target has a pending invitation instead
        target_user = db.query(User).filter(User.id == target_user_id).first()
        if target_user:
            pending_invite = db.query(ProjectInvitation).filter(
                ProjectInvitation.email == target_user.email.lower(),
                ProjectInvitation.project_id == project_id,
                ProjectInvitation.status == InvitationStatus.PENDING,
            ).first()
            if pending_invite:
                pending_invite.status = InvitationStatus.CANCELLED
                db.commit()
                return {"ok": True, "action": "invitation_cancelled"}
        raise HTTPException(status_code=404, detail="Member not found in this project")

    # Block removal of last PM
    if target_membership.project_role == ProjectRole.PROJECT_MANAGER:
        pm_count = db.query(ProjectMembership).filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        ).count()
        if pm_count <= 1:
            log_event(
                db,
                "last_pm_removal_blocked",
                user.id,
                {"project_id": project_id, "target_user_id": target_user_id},
                request=request,
                target_type="project",
                target_id=project_id,
            )
            db.commit()
            raise HTTPException(status_code=400, detail="Cannot remove the last Project Manager")

    target_membership.status = MembershipStatus.REMOVED

    # Cancel any remaining pending invitations for this user in this project
    # so they don't appear in their invitation inbox after being removed
    removed_user = db.query(User).filter(User.id == target_user_id).first()
    if removed_user:
        db.query(ProjectInvitation).filter(
            ProjectInvitation.email == removed_user.email.lower(),
            ProjectInvitation.project_id == project_id,
            ProjectInvitation.status == InvitationStatus.PENDING,
        ).update({"status": InvitationStatus.CANCELLED})

    log_event(
        db,
        "member_removed",
        user.id,
        {"project_id": project_id, "removed_user_id": target_user_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()

    try:
        from ...services.notification_service import notify_users
        project = db.query(Project).filter(Project.id == project_id).first()
        proj_name = project.name if project else f"Project #{project_id}"
        notify_users(
            db, [target_user_id],
            type       = "member_removed",
            title      = f"Removed from {proj_name}",
            message    = "You have been removed from this project.",
            category   = "project",
            priority   = "high",
            action_url = "/projects/my",
            project_id = project_id,
        )
        db.commit()
    except Exception:
        pass

    return {"ok": True, "action": "membership_removed"}


@router.patch("/{project_id}/members/{target_user_id}", response_model=MemberOut)
def change_member_role(
    project_id: int,
    target_user_id: int,
    body: ChangeMemberRole,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change a member's role in a project. PM-only."""
    _require_pm(db, project_id, user.id)

    if user.id == target_user_id:
        raise HTTPException(status_code=403, detail="You cannot change your own role")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Get target's active membership
    target_membership = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == target_user_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()

    if not target_membership:
        raise HTTPException(status_code=404, detail="Member not found in this project")

    # Block PM role assignment by non-admin users
    # Only admins can assign/manage PM role at project creation; PMs cannot assign PM role to others
    if body.role == ProjectRole.PROJECT_MANAGER.value:
        raise HTTPException(
            status_code=403,
            detail="Project Manager role can only be assigned by administrators during project creation"
        )

    # Block changing the last PM to non-PM
    if (
        target_membership.project_role == ProjectRole.PROJECT_MANAGER
        and body.role != ProjectRole.PROJECT_MANAGER.value
    ):
        pm_count = db.query(ProjectMembership).filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        ).count()
        if pm_count <= 1:
            raise HTTPException(
                status_code=400, detail="Cannot change role of the only Project Manager"
            )

    # Update role
    old_role = target_membership.project_role.value
    target_membership.project_role = body.role
    log_event(
        db,
        "member_role_changed",
        user.id,
        {"project_id": project_id, "target_user_id": target_user_id, "old_role": old_role, "new_role": body.role},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(target_membership)

    # Cancel any pending invitations for this user in other roles
    # (they may have old invitations pending in different roles; changing current role invalidates those)
    target_user_db = db.query(User).filter(User.id == target_user_id).first()
    if target_user_db:
        old_invites = db.query(ProjectInvitation).filter(
            ProjectInvitation.email == target_user_db.email.lower(),
            ProjectInvitation.project_id == project_id,
            ProjectInvitation.status == InvitationStatus.PENDING,
            ProjectInvitation.role != body.role,
        ).all()
        for invite in old_invites:
            invite.status = InvitationStatus.CANCELLED
        if old_invites:
            db.commit()

    # Get user details for response
    target_user = db.query(User).filter(User.id == target_user_id).first()

    return MemberOut(
        id=target_membership.id,
        user_id=target_membership.user_id,
        project_id=target_membership.project_id,
        project_role=target_membership.project_role.value,
        status=target_membership.status.value,
        full_name=target_user.full_name,
        email=target_user.email,
        username=target_user.username,
        avatar_url=target_user.avatar_url,
        joined_at=target_membership.joined_at,
    )


ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB


@router.post("/{project_id}/logo")
async def upload_project_logo(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, WebP, and SVG images are allowed")

    contents = await file.read()
    if len(contents) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB")

    # Delete old logo from Cloudinary if exists
    if project.logo_public_id:
        try:
            delete_asset(project.logo_public_id)
        except Exception:
            pass  # best-effort cleanup

    result = upload_image(
        contents,
        folder="constructionsight/project-logos",
        public_id=f"project_{project_id}_logo",
    )

    project.logo_url = result.get("secure_url") or result.get("url")
    project.logo_public_id = result.get("public_id")
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)

    return {"ok": True, "logo_url": project.logo_url}


@router.delete("/{project_id}/logo")
def delete_project_logo(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if project.logo_public_id:
        try:
            delete_asset(project.logo_public_id)
        except Exception:
            pass

    project.logo_url = None
    project.logo_public_id = None
    project.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"ok": True}


@router.patch("/{project_id}/details", response_model=ProjectOut)
def edit_project_details(
    request: Request,
    project_id: int,
    body: ProjectEdit,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """PM can edit project details (name, location, description, client_name, dates).
    Only allowed for non-archived, non-completed projects.
    """
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    _block_archived(project)
    if project.status == ProjectStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Completed projects cannot be edited")

    update_data = body.model_dump(exclude_none=True)
    old_location = project.location
    for field, value in update_data.items():
        setattr(project, field, value)

    if "location" in update_data and update_data["location"] != old_location:
        from ...services.weather_service import invalidate as invalidate_weather
        if old_location:
            invalidate_weather(old_location)

    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_details_edited",
        user.id,
        {"project_id": project_id, "fields": list(update_data.keys())},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


# ─────────────────────────────────────────────────────────────────────────
# PM SETUP & LIFECYCLE ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────


@router.post("/{project_id}/complete", response_model=ProjectOut)
def complete_project(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """PM marks project as COMPLETE (ACTIVE → COMPLETED). All tasks must be done."""
    _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if project.status != ProjectStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only active projects can be marked complete")

    # Enforce: all tasks must be done
    from ...models.project_task import ProjectTask
    tasks = db.query(ProjectTask).filter(ProjectTask.project_id == project_id).all()
    if tasks:
        pending = [t for t in tasks if not t.is_done]
        if pending:
            raise HTTPException(
                status_code=400,
                detail=f"{len(pending)} task(s) still pending. Complete all tasks before marking project as done."
            )

    project.status = ProjectStatus.COMPLETED
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_completed",
        user.id,
        {"project_id": project_id, "project_name": project.name, "tasks_completed": len(tasks)},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.post("/{project_id}/uncomplete", response_model=ProjectOut)
def uncomplete_project(
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """PM unmarks project as complete (COMPLETED → ACTIVE)."""
    _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    if project.status != ProjectStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only completed projects can be unmarked")

    project.status = ProjectStatus.ACTIVE
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_uncompleted",
        user.id,
        {"project_id": project_id, "project_name": project.name},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}/invitations")
def list_invitations(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all invitations for this project (all statuses)."""
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    rows = db.query(ProjectInvitation, User.full_name).outerjoin(
        User, ProjectInvitation.invited_by == User.id
    ).filter(
        ProjectInvitation.project_id == project_id,
    ).all()

    return [
        {
            "id": inv.id,
            "email": inv.email,
            "role": inv.role,
            "status": inv.status.value,
            "expires_at": inv.expires_at,
            "created_at": inv.created_at,
            "token": inv.token,
            "invited_by": inv.invited_by,
            "invited_by_name": invited_by_name,
        }
        for inv, invited_by_name in rows
    ]


class ProjectInvitationsExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = None


@router.post("/{project_id}/invitations/export/pdf")
def export_project_invitations_pdf(
    project_id: int,
    body: ProjectInvitationsExportPdfBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ...services.pdf_report_service import generate_invitations_pdf_report, ReportGenerationError
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.platform_role != "admin":
        _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Invitations",
        "pending": "Pending Invitations",
        "accepted": "Accepted Invitations",
        "expired": "Expired Invitations",
        "cancelled": "Cancelled Invitations",
    }
    filter_label = filter_map.get(filter_val, "All Invitations")

    now = datetime.now(timezone.utc)
    rows = db.query(ProjectInvitation, User.full_name).outerjoin(
        User, ProjectInvitation.invited_by == User.id
    ).filter(ProjectInvitation.project_id == project_id).all()

    def _derived(inv: ProjectInvitation) -> str:
        s = (inv.status.value if inv.status else "—").lower()
        if s == "pending" and inv.expires_at:
            ex = inv.expires_at
            try:
                if getattr(ex, "tzinfo", None) is None:
                    ex = ex.replace(tzinfo=timezone.utc)
                if ex <= now:
                    return "expired"
            except Exception:
                return s
        return s

    invitations = []
    for inv, invited_by_name in rows:
        ds = _derived(inv)
        if filter_val != "all" and ds != filter_val:
            continue
        invitations.append({
            "project_name": project.name,
            "email": inv.email,
            "role": inv.role,
            "status": ds,
            "expires_at": inv.expires_at,
            "created_at": inv.created_at,
            "invited_by_name": invited_by_name or "—",
        })

    try:
        pdf_bytes = generate_invitations_pdf_report(
            invitations=invitations,
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or user.full_name or "Administrator"),
        )
        fname = f"Project_Invitations_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/invitations/stats")
def get_invitations_stats(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get invitation statistics by status for this project."""
    from sqlalchemy import func

    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    stats = db.query(
        ProjectInvitation.status,
        func.count(ProjectInvitation.id).label("count")
    ).filter(
        ProjectInvitation.project_id == project_id,
    ).group_by(ProjectInvitation.status).all()

    result = {
        "pending": 0,
        "accepted": 0,
        "expired": 0,
        "cancelled": 0,
    }

    for status, count in stats:
        status_key = status.value.lower() if status else None
        if status_key in result:
            result[status_key] = count

    return result


@router.post("/{project_id}/invitations/{invitation_id}/resend")
def resend_invitation(
    project_id: int,
    invitation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resend an invitation email."""
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id,
        ProjectInvitation.project_id == project_id,
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    # Only allow resend for pending, expired, or cancelled invitations
    if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED, InvitationStatus.CANCELLED):
        raise HTTPException(status_code=400, detail="Only pending, expired, or cancelled invitations can be resent")

    # Reset token and expiry
    invitation.token = secrets.token_urlsafe(48)
    invitation.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    invitation.status = InvitationStatus.PENDING

    project = db.query(Project).filter(Project.id == project_id).first()
    log_event(
        db,
        "invitation_resent",
        user.id,
        {"project_id": project_id, "invitation_id": invitation_id, "email": invitation.email},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()

    # Send email
    send_invitation_email(
        to_email=invitation.email,
        project_name=project.name if project else "Unknown Project",
        role=invitation.role.replace("_", " ").title(),
        invite_url=f"{settings.frontend_url}/invite/{invitation.token}",
    )

    return {"ok": True, "method": "resend"}


@router.delete("/{project_id}/invitations/{invitation_id}")
def cancel_invitation(
    project_id: int,
    invitation_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cancel a pending invitation."""
    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    invitation = db.query(ProjectInvitation).filter(
        ProjectInvitation.id == invitation_id,
        ProjectInvitation.project_id == project_id,
    ).first()
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")

    if invitation.status != InvitationStatus.PENDING:
        raise HTTPException(status_code=400, detail="Only pending invitations can be cancelled")

    invitation.status = InvitationStatus.CANCELLED
    log_event(
        db,
        "invitation_cancelled",
        user.id,
        {"invitation_id": invitation_id, "project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────────────────────────
# CAMERA ASSIGNMENT ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────


@router.get("/{project_id}/cameras/available")
def list_available_cameras(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List non-archived cameras on this project's site available for assignment."""
    from ...models.camera import Camera
    from ...models.project_camera import ProjectCamera

    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Get all non-archived cameras on same site
    cameras = db.query(Camera).filter(
        Camera.site_id == project.site_id,
        Camera.archived_at.is_(None),
    ).all()

    # Check which are already assigned
    assigned_ids = db.query(ProjectCamera.camera_id).filter(
        ProjectCamera.project_id == project_id
    ).all()
    assigned_ids = {row[0] for row in assigned_ids}

    result = []
    for cam in cameras:
        result.append({
            "id": cam.id,
            "name": cam.name,
            "vendor": cam.vendor,
            "model": cam.model,
            "registry_status": cam.registry_status.value,
            "is_assigned": cam.id in assigned_ids,
            "logo_url": cam.logo_url,
        })
    return result


@router.get("/{project_id}/cameras")
def list_assigned_cameras(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List cameras assigned to this project."""
    from ...models.camera import Camera, CameraHealthLog
    from ...models.project_camera import ProjectCamera

    _get_membership(db, project_id, user.id)

    rows = db.query(ProjectCamera, Camera).join(
        Camera, Camera.id == ProjectCamera.camera_id
    ).filter(ProjectCamera.project_id == project_id).all()

    result = []
    for pc, cam in rows:
        latest_log = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == cam.id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        result.append({
            "id": cam.id,
            "name": cam.name,
            "vendor": cam.vendor,
            "model": cam.model,
            "serial_number": cam.serial_number,
            "onvif_supported": cam.onvif_supported,
            "registry_status": cam.registry_status.value,
            "zone_id": pc.zone_id,
            "logo_url": cam.logo_url,
            "latest_health_status": latest_log.health_status.value if latest_log and latest_log.health_status else None,
        })
    return result


class ProjectCamerasExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = None


@router.post("/{project_id}/cameras/export/pdf")
def export_project_cameras_pdf(
    project_id: int,
    body: ProjectCamerasExportPdfBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR
    from ...models.camera import Camera, CameraHealthLog
    from ...models.project_camera import ProjectCamera
    from ...models.zone import Zone
    from ...models.camera import RegistryStatus

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.platform_role != "admin":
        _get_membership(db, project_id, user.id)

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Cameras",
        "verified": "Verified",
        "draft": "Draft",
        "healthy": "Healthy",
        "offline": "Offline",
        "degraded": "Degraded",
        "unassigned": "Unassigned",
    }
    filter_label = filter_map.get(filter_val, "All Cameras")

    rows = db.query(ProjectCamera, Camera).join(
        Camera, Camera.id == ProjectCamera.camera_id
    ).filter(ProjectCamera.project_id == project_id).all()

    zone_ids = {pc.zone_id for pc, _cam in rows if pc.zone_id}
    zone_map = {}
    if zone_ids:
        for z in db.query(Zone).filter(Zone.id.in_(zone_ids)).all():
            zone_map[z.id] = z.name

    def _latest_health(cam_id: int) -> str:
        lg = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == cam_id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        return (lg.health_status.value if lg and lg.health_status else "—")

    def _reg_label(v) -> str:
        key = str(v.value if hasattr(v, "value") else v or "").lower()
        if key == "verify_failed":
            key = "failed"
        return {
            "verified": "Verified",
            "draft": "Draft",
            "verifying": "Verifying",
            "failed": "Failed",
            "archived": "Archived",
            "unverified": "Unverified",
        }.get(key, str(v.value if hasattr(v, "value") else v or "—").replace("_", " ").title())

    def _health_label(v) -> str:
        return str(v or "—").replace("_", " ").title()

    def _match(pc: ProjectCamera, cam: Camera, reg_key: str, health_key: str) -> bool:
        if filter_val == "all":
            return True
        if filter_val == "unassigned":
            return pc.zone_id is None
        if filter_val in ("verified", "draft"):
            return reg_key == filter_val
        if filter_val in ("healthy", "offline", "degraded"):
            return health_key == filter_val
        return True

    cameras = []
    for pc, cam in rows:
        reg_key = str(getattr(cam.registry_status, "value", cam.registry_status) or "").lower()
        if reg_key == "verify_failed":
            reg_key = "failed"
        health_key = _latest_health(cam.id)
        health_key_norm = str(health_key or "").lower()
        if not _match(pc, cam, reg_key, health_key_norm):
            continue
        cameras.append((pc, cam, reg_key, health_key_norm, health_key))

    def _fmt_date_pk(v):
        if not v:
            return "—"
        try:
            pk = timezone(timedelta(hours=5))
            if getattr(v, "tzinfo", None) is None:
                v = v.replace(tzinfo=timezone.utc)
            return v.astimezone(pk).strftime("%b %d, %Y")
        except Exception:
            try:
                return v.strftime("%b %d, %Y")
            except Exception:
                return str(v)

    headers = ["Camera Name", "Vendor", "Model", "Serial", "Reg. Status", "Health", "Zone", "Created"]
    rows_data = [
        [
            str(cam.name or "—"),
            str(cam.vendor or "—"),
            str(cam.model or "—"),
            str(cam.serial_number or "—"),
            _reg_label(cam.registry_status),
            _health_label(health_disp),
            zone_map.get(pc.zone_id, "Unassigned") if pc.zone_id else "Unassigned",
            _fmt_date_pk(getattr(cam, "created_at", None)),
        ]
        for (pc, cam, _rk, _hk, health_disp) in cameras
    ]

    total = len(rows_data)
    verified_n = sum(1 for (_pc, cam, rk, _hk, _hd) in cameras if rk == "verified")
    draft_n = sum(1 for (_pc, cam, rk, _hk, _hd) in cameras if rk == "draft")
    offline_n = sum(1 for (_pc, _cam, _rk, hk, _hd) in cameras if hk == "offline")
    unassigned_n = sum(1 for (pc, _cam, _rk, _hk, _hd) in cameras if pc.zone_id is None)

    kpi_items = [
        (total, "Total", HexColor("#ffffff"), HexColor("#1e3a5f")),
        (verified_n, "Verified", HexColor("#15803d"), HexColor("#dcfce7")),
        (draft_n, "Draft", HexColor("#b45309"), HexColor("#fef3c7")),
        (offline_n, "Offline", HexColor("#b91c1c"), HexColor("#fee2e2")),
        (unassigned_n, "Unassigned", HexColor("#0f766e"), HexColor("#ccfbf1")),
    ]

    status_fg = {
        "verified": HexColor("#15803d"),
        "draft": HexColor("#b45309"),
        "verifying": HexColor("#0f766e"),
        "failed": HexColor("#b91c1c"),
        "verify_failed": HexColor("#b91c1c"),
        "archived": HexColor("#6b7280"),
        "unverified": HexColor("#6b7280"),
    }
    status_bg = {
        "verified": HexColor("#dcfce7"),
        "draft": HexColor("#fef3c7"),
        "verifying": HexColor("#ccfbf1"),
        "failed": HexColor("#fee2e2"),
        "verify_failed": HexColor("#fee2e2"),
        "archived": HexColor("#f1f5f9"),
        "unverified": HexColor("#f1f5f9"),
    }

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Project Cameras Report",
            headers=headers,
            rows=rows_data,
            col_widths=[95, 65, 65, 70, 65, 55, 60, 55],
            meta_pairs=[("Project", project.name), ("Report", "Assigned Cameras Directory")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or user.full_name or "Administrator"),
            kpi_items=kpi_items,
            status_col_index=4,
            status_fg=status_fg,
            status_bg=status_bg,
        )
        fname = f"Project_Cameras_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{project_id}/cameras/stream")
async def project_camera_stream(
    project_id: int,
    token: str = None,
    db: Session = Depends(get_db),
):
    """
    SSE stream — pushes camera_health_update and camera_verification_update events
    for cameras assigned to this project.
    Auth via ?token= query param because EventSource cannot send Authorization headers.
    Must be defined before /{project_id}/cameras/{camera_id} so 'stream' is not
    matched as a camera_id path parameter.
    """
    import asyncio as _asyncio
    import json as _json
    from fastapi.responses import StreamingResponse
    from ...core.security import decode_access_token
    from ...services.project_camera_broker import register as _reg, unregister as _unreg

    if not token:
        raise HTTPException(status_code=401, detail="token query param required")

    from jose import JWTError
    try:
        payload = decode_access_token(token)
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")
    user_id = int(payload.get("sub", 0))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="Account pending approval")
    token_ver = int(payload.get("ver", 1) or 1)
    user_ver = int(user.token_version or 1)
    if token_ver != user_ver:
        raise HTTPException(status_code=401, detail="Session invalidated")

    _get_membership(db, project_id, user_id)
    db.close()  # release DB connection before long-lived stream

    q = _reg(project_id)

    async def event_generator():
        try:
            while True:
                try:
                    evt = await _asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {_json.dumps(evt)}\n\n"
                except _asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            _unreg(project_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/{project_id}/cameras/{camera_id}")
def get_project_camera_detail(
    project_id: int,
    camera_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get full camera detail for a camera assigned to this project (no credentials)."""
    from ...models.camera import Camera, CameraVerification, CameraHealthLog
    from ...models.project_camera import ProjectCamera
    from ...models.site import Site

    _get_membership(db, project_id, user.id)

    # Verify camera is actually assigned to this project
    pc = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if not pc:
        raise HTTPException(status_code=404, detail="Camera not found in this project")

    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    site = db.get(Site, camera.site_id)

    latest_log = (
        db.query(CameraHealthLog)
        .filter(CameraHealthLog.camera_id == camera_id)
        .order_by(CameraHealthLog.checked_at.desc())
        .first()
    )

    verifications = (
        db.query(CameraVerification)
        .filter(CameraVerification.camera_id == camera_id)
        .order_by(CameraVerification.completed_at.desc().nullslast(), CameraVerification.id.desc())
        .all()
    )

    return {
        "id": camera.id,
        "name": camera.name,
        "vendor": camera.vendor,
        "model": camera.model,
        "serial_number": camera.serial_number,
        "onvif_supported": camera.onvif_supported,
        "ptz_supported": camera.ptz_supported,
        "onvif_port": None,  # Not exposed to PM
        "connection_type": camera.connection_type,
        "logo_url": camera.logo_url,
        "registry_status": camera.registry_status.value,
        "verified_at": camera.verified_at.isoformat() if camera.verified_at else None,
        "last_health_check_at": camera.last_health_check_at.isoformat() if camera.last_health_check_at else None,
        "archived_at": camera.archived_at.isoformat() if camera.archived_at else None,
        "created_at": camera.created_at.isoformat() if camera.created_at else None,
        "site_name": site.name if site else None,
        "zone_id": pc.zone_id,
        "latest_health_status": latest_log.health_status.value if latest_log and latest_log.health_status else None,
        "verifications": [
            {
                "id": v.id,
                "started_at": v.started_at.isoformat() if v.started_at else None,
                "completed_at": v.completed_at.isoformat() if v.completed_at else None,
                "result_status": v.result_status,
                "failure_reason": v.failure_reason,
                "preview_image_url": v.preview_image_url,
                "fps_detected": v.fps_detected,
                "resolution_detected": v.resolution_detected,
                "latency_ms": v.latency_ms,
            }
            for v in verifications
        ],
    }


@router.post("/{project_id}/cameras/{camera_id}")
def assign_camera(
    project_id: int,
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assign a verified camera to this project."""
    from ...models.camera import Camera, RegistryStatus
    from ...models.project_camera import ProjectCamera

    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    if camera.site_id != project.site_id:
        raise HTTPException(status_code=400, detail="Camera must be on the same site as the project")

    if camera.registry_status != RegistryStatus.verified:
        raise HTTPException(status_code=400, detail="Only verified cameras can be assigned")

    # Check if already assigned
    existing = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Camera is already assigned to this project")

    pc = ProjectCamera(
        project_id=project_id,
        camera_id=camera_id,
        assigned_by=user.id,
    )
    db.add(pc)
    log_event(
        db,
        "camera_assigned",
        user.id,
        {"project_id": project_id, "camera_id": camera_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    return {"ok": True}


@router.delete("/{project_id}/cameras/{camera_id}")
def unassign_camera(
    project_id: int,
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unassign a camera from this project."""
    from ...models.project_camera import ProjectCamera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Check if user is admin (override) or PM
    if user.platform_role == "admin":
        pass  # Admin can always unassign
    else:
        _require_pm(db, project_id, user.id)
        # PM cannot unassign after activation — only zone reassignment allowed
        if project.status in (ProjectStatus.ACTIVE, ProjectStatus.COMPLETED):
            raise HTTPException(
                status_code=403,
                detail="Cameras cannot be unassigned from an active project. You can reassign to a different zone.",
            )

    pc = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if not pc:
        raise HTTPException(status_code=404, detail="Camera assignment not found")

    db.delete(pc)
    log_event(
        db,
        "camera_unassigned",
        user.id,
        {
            "project_id": project_id,
            "camera_id": camera_id,
            "project_status": project.status,
            "unassigned_by_role": user.platform_role,
        },
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    return {"ok": True}


@router.patch("/{project_id}/cameras/{camera_id}/zone")
def assign_camera_to_zone(
    project_id: int,
    camera_id: int,
    body: dict,  # {"zone_id": int | null}
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Assign/change zone for a camera."""
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Admin can assign zones on any project; others must be PM
    if user.platform_role != "admin":
        membership = _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    # Verify camera exists
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Verify camera is assigned to this project
    pc = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if not pc:
        raise HTTPException(status_code=400, detail="Camera is not assigned to this project. Please assign the camera first.")

    zone_id = body.get("zone_id")
    old_zone_id = pc.zone_id  # Track old zone for audit trail

    if zone_id is not None:
        # Verify zone exists and belongs to same site
        from ...models.zone import Zone
        zone = db.query(Zone).filter(Zone.id == zone_id).first()
        if not zone:
            raise HTTPException(status_code=404, detail="Zone not found")
        if zone.site_id != project.site_id:
            raise HTTPException(status_code=400, detail="Zone must be on the same site as the project")

    pc.zone_id = zone_id

    # Log zone change with before/after for complete audit trail
    from ...api.deps import log_event
    log_event(
        db,
        "camera_zone_changed",
        user.id,
        {
            "project_id": project_id,
            "camera_id": camera_id,
            "old_zone_id": old_zone_id,
            "new_zone_id": zone_id,
            "action": "zone_changed" if old_zone_id != zone_id else "zone_assignment_confirmed",
        },
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(pc)
    return {
        "ok": True,
        "camera_id": camera_id,
        "zone_id": zone_id,
        "camera_name": camera.name,
        "zone_name": db.query(Zone).filter(Zone.id == zone_id).first().name if zone_id else None
    }


# ─────────────────────────────────────────────────────────────────────────
# ZONE ENDPOINTS (PM-accessible)
# ─────────────────────────────────────────────────────────────────────────


@router.get("/{project_id}/zones")
def list_zones(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List zones for this project's site."""
    from ...models.zone import Zone

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Admin can access any project's zones; others must be project members
    if user.platform_role != "admin":
        _get_membership(db, project_id, user.id)

    zones = db.query(Zone).filter(Zone.site_id == project.site_id).all()
    return [
        {
            "id": z.id,
            "site_id": z.site_id,
            "name": z.name,
            "description": z.description,
            "zone_type": z.zone_type,
        }
        for z in zones
    ]


class ProjectZonesExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = None


@router.post("/{project_id}/zones/export/pdf")
def export_project_zones_pdf(
    project_id: int,
    body: ProjectZonesExportPdfBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR
    from ...models.zone import Zone
    from ...models.project_camera import ProjectCamera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if user.platform_role != "admin":
        _get_membership(db, project_id, user.id)

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Zones",
        "scaffold": "Scaffold",
        "entry": "Entry",
        "storage": "Storage",
        "perimeter": "Perimeter",
        "other": "Other",
    }
    filter_label = filter_map.get(filter_val, "All Zones")

    zones = db.query(Zone).filter(Zone.site_id == project.site_id).all()

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    by_zone = {}
    for pc in pcs:
        if pc.zone_id is None:
            continue
        by_zone[pc.zone_id] = by_zone.get(pc.zone_id, 0) + 1

    def _type_label(v: str) -> str:
        raw = str(v or "other").strip().lower() or "other"
        return raw.replace("_", " ").title()

    zones_rows = []
    for z in zones:
        zt = str(z.zone_type or "other").lower()
        if filter_val != "all" and zt != filter_val:
            continue
        zones_rows.append(z)

    headers = ["Zone Name", "Type", "Description", "Cameras"]
    rows_data = [
        [
            str(z.name or "—"),
            _type_label(z.zone_type),
            str((z.description or "").strip() or "—"),
            str(by_zone.get(z.id, 0)),
        ]
        for z in zones_rows
    ]

    total = len(rows_data)
    scaffold_n = sum(1 for z in zones_rows if str(z.zone_type or "other").lower() == "scaffold")
    entry_n = sum(1 for z in zones_rows if str(z.zone_type or "other").lower() == "entry")
    storage_n = sum(1 for z in zones_rows if str(z.zone_type or "other").lower() == "storage")
    perimeter_n = sum(1 for z in zones_rows if str(z.zone_type or "other").lower() == "perimeter")

    kpi_items = [
        (total, "Total", HexColor("#ffffff"), HexColor("#1e3a5f")),
        (scaffold_n, "Scaffold", HexColor("#1d4ed8"), HexColor("#dbeafe")),
        (entry_n, "Entry", HexColor("#0f766e"), HexColor("#ccfbf1")),
        (storage_n, "Storage", HexColor("#b45309"), HexColor("#fef3c7")),
        (perimeter_n, "Perimeter", HexColor("#b91c1c"), HexColor("#fee2e2")),
    ]

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Project Zones Report",
            headers=headers,
            rows=rows_data,
            col_widths=[155, 70, 220, 55],
            meta_pairs=[("Project", project.name), ("Report", "Monitoring Zones Directory")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or user.full_name or "Administrator"),
            kpi_items=kpi_items,
        )
        fname = f"Project_Zones_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{project_id}/zones", status_code=201)
def create_zone(
    project_id: int,
    body: dict,  # {"name": str, "zone_type": str?, "description": str?}
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new zone on this project's site."""
    from ...models.zone import Zone

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Admin can create zones on any project; others must be PM
    if user.platform_role != "admin":
        membership = _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Zone name is required")

    # Check for duplicate name on same site
    existing = db.query(Zone).filter(
        Zone.site_id == project.site_id,
        Zone.name == name,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Zone name already exists on this site")

    # Validate zone_type if provided
    zone_type = body.get("zone_type")
    allowed_types = {"scaffold", "entry", "storage", "perimeter", "other"}
    if zone_type and zone_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid zone type. Must be one of: {', '.join(allowed_types)}"
        )

    # Validate description length
    description = body.get("description", "").strip() if body.get("description") else None
    if description and len(description) > 500:
        raise HTTPException(status_code=400, detail="Description cannot exceed 500 characters")

    zone = Zone(
        site_id=project.site_id,
        name=name,
        zone_type=zone_type,
        description=description,
        created_by=user.id,
    )
    db.add(zone)
    db.flush()
    log_event(
        db,
        "zone_created",
        user.id,
        {"project_id": project_id, "zone_id": zone.id, "zone_name": name, "zone_type": zone_type},
        request=request,
        target_type="zone",
        target_id=zone.id,
    )
    db.commit()
    db.refresh(zone)
    return {
        "id": zone.id,
        "site_id": zone.site_id,
        "name": zone.name,
        "description": zone.description,
        "zone_type": zone.zone_type,
    }


@router.delete("/{project_id}/zones/{zone_id}")
def delete_zone(
    project_id: int,
    zone_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a zone from this project's site."""
    from ...models.zone import Zone
    from ...models.project_camera import ProjectCamera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Admin can delete zones on any project; others must be PM
    if user.platform_role != "admin":
        membership = _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    if zone.site_id != project.site_id:
        raise HTTPException(status_code=400, detail="Zone does not belong to this project's site")

    # Unassign all cameras from this zone before deleting
    cameras_to_unassign = db.query(ProjectCamera).filter(
        ProjectCamera.zone_id == zone_id
    ).all()
    camera_count = len(cameras_to_unassign)
    unassigned_camera_ids = [pc.camera_id for pc in cameras_to_unassign]

    for pc in cameras_to_unassign:
        pc.zone_id = None

    # Nullify zone_id on PPE incidents (preserve historical data, just remove zone reference)
    from ...models.ppe_incident import PpeIncident
    db.query(PpeIncident).filter(PpeIncident.zone_id == zone_id).update({"zone_id": None})

    db.delete(zone)
    log_event(
        db,
        "zone_deleted",
        user.id,
        {
            "project_id": project_id,
            "zone_id": zone_id,
            "zone_name": zone.name,
            "cameras_unassigned": camera_count,
            "camera_ids": unassigned_camera_ids,
            "note": "Zone was deleted; all assigned cameras were unassigned but NOT removed from project",
        },
        request=request,
        target_type="zone",
        target_id=zone_id,
    )
    db.commit()
    return {"ok": True, "cameras_unassigned": camera_count}


@router.patch("/{project_id}/zones/{zone_id}")
def update_zone(
    project_id: int,
    zone_id: int,
    body: dict,  # {"name": str, "zone_type": str?, "description": str?}
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a zone on this project's site."""
    from ...models.zone import Zone

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    # Admin can update zones on any project; others must be PM
    if user.platform_role != "admin":
        membership = _get_membership(db, project_id, user.id)
        _require_pm(db, project_id, user.id)

    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    if zone.site_id != project.site_id:
        raise HTTPException(status_code=400, detail="Zone does not belong to this project's site")

    # Validate and update name if provided
    name = body.get("name")
    if name is not None:
        name = name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Zone name is required")

        # Check for duplicate name on same site (excluding current zone)
        existing = db.query(Zone).filter(
            Zone.site_id == project.site_id,
            Zone.name == name,
            Zone.id != zone_id,
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail="Zone name already exists on this site")

        zone.name = name

    # Validate and update zone_type if provided
    zone_type = body.get("zone_type")
    if zone_type is not None:
        allowed_types = {"scaffold", "entry", "storage", "perimeter", "other"}
        if zone_type and zone_type not in allowed_types:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid zone type. Must be one of: {', '.join(allowed_types)}"
            )
        zone.zone_type = zone_type

    # Validate and update description if provided
    description = body.get("description")
    if description is not None:
        description = description.strip() if description else None
        if description and len(description) > 500:
            raise HTTPException(status_code=400, detail="Description cannot exceed 500 characters")
        zone.description = description

    log_event(
        db,
        "zone_updated",
        user.id,
        {"project_id": project_id, "zone_id": zone_id},
        request=request,
        target_type="zone",
        target_id=zone_id,
    )
    db.commit()
    db.refresh(zone)
    return {
        "id": zone.id,
        "site_id": zone.site_id,
        "name": zone.name,
        "description": zone.description,
        "zone_type": zone.zone_type,
    }


# ─────────────────────────────────────────────────────────────────────────
# PIN ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────


@router.post("/{project_id}/pin")
def pin_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pin this project to the top of the list."""
    from ...models.pinned_project import PinnedProject

    _get_membership(db, project_id, user.id)

    # Check if already pinned
    pinned = db.query(PinnedProject).filter(
        PinnedProject.user_id == user.id,
        PinnedProject.project_id == project_id,
    ).first()
    if pinned:
        return {"ok": True, "pinned": True}  # Already pinned

    # Create pin
    pp = PinnedProject(user_id=user.id, project_id=project_id)
    db.add(pp)
    db.commit()
    return {"ok": True, "pinned": True}


@router.delete("/{project_id}/pin")
def unpin_project(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Unpin this project."""
    from ...models.pinned_project import PinnedProject

    pp = db.query(PinnedProject).filter(
        PinnedProject.user_id == user.id,
        PinnedProject.project_id == project_id,
    ).first()
    if pp:
        db.delete(pp)
        db.commit()
    return {"ok": True, "pinned": False}


# ─────────────────────────────────────────────────────────────────────────
# SETTINGS ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────


@router.get("/{project_id}/settings")
def get_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get project settings. Creates default if not exists."""
    from ...models.project_settings import ProjectSettings

    _get_membership(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    settings = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    if not settings:
        settings = ProjectSettings(project_id=project_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return {
        "project_id": settings.project_id,
        "alerts_enabled": settings.alerts_enabled,
        "report_frequency": settings.report_frequency,
    }


@router.patch("/{project_id}/settings")
def update_settings(
    project_id: int,
    body: dict,  # {"report_frequency": "daily"|"weekly"|"monthly"}
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update project settings. Alerts are always locked ON."""
    from ...models.project_settings import ProjectSettings

    membership = _get_membership(db, project_id, user.id)
    _require_pm(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    _block_archived(project)

    settings = db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).first()
    if not settings:
        settings = ProjectSettings(project_id=project_id)
        db.add(settings)

    report_freq = body.get("report_frequency")
    if report_freq:
        if report_freq not in ("daily", "weekly", "monthly"):
            raise HTTPException(status_code=400, detail="Invalid report frequency")
        settings.report_frequency = report_freq

    settings.updated_by = user.id
    settings.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(settings)

    return {
        "project_id": settings.project_id,
        "alerts_enabled": settings.alerts_enabled,
        "report_frequency": settings.report_frequency,
    }
