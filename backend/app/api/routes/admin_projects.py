import secrets
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...core.config import settings
from ...services import send_invitation_email, upload_image, delete_asset
from ...models.project import Project, ProjectStatus
from ...models.project_invitation import ProjectInvitation, InvitationStatus
from ...models.project_task import ProjectTask
from ...models.site import Site
from ...models.user import User
from ...schemas.project import (
    ProjectCreate,
    ProjectCreateResponse,
    ProjectOut,
    ProjectStatusUpdate,
    ProjectEdit,
    UserListOut,
    MemberOut,
)
from ..deps import get_db, require_admin, log_event

router = APIRouter(prefix="/admin/projects", tags=["admin-projects"])


@router.post("", response_model=ProjectCreateResponse, status_code=201)
def create_project(
    request: Request,
    body: ProjectCreate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    # --- Resolve PM email/name based on assignment type ---
    if body.pm_user_id is not None:
        pm_user = db.query(User).filter(User.id == body.pm_user_id).first()
        if not pm_user:
            raise HTTPException(status_code=404, detail="Assigned project manager not found")
        if not pm_user.is_active:
            raise HTTPException(status_code=400, detail="Assigned project manager account is disabled")
        if not pm_user.is_approved:
            raise HTTPException(status_code=400, detail="Assigned project manager account is not approved")
        invitation_email = (pm_user.email or "").strip().lower()
        invitation_name = pm_user.full_name
    else:
        # Invite by email — user may or may not have an account yet
        invitation_email = (body.pm_email or "").strip().lower()  # Normalize: strip + lowercase
        invitation_name = body.pm_full_name.strip()

    # Guard: prevent duplicate project names globally
    existing_project = db.query(Project).filter(Project.name == body.name).first()
    if existing_project:
        raise HTTPException(
            status_code=409,
            detail=f"A project named '{body.name}' already exists. Please use a different name.",
        )

    # Guard: prevent duplicate pending invite for same project name + PM email
    existing_invite = (
        db.query(ProjectInvitation)
        .join(Project, Project.id == ProjectInvitation.project_id)
        .filter(
            ProjectInvitation.email == invitation_email,
            ProjectInvitation.status == InvitationStatus.PENDING,
            Project.name == body.name,
            Project.created_by == admin.id,
        )
        .first()
    )
    if existing_invite:
        raise HTTPException(
            status_code=409,
            detail="A project with this name already has a pending invitation for this Project Manager.",
        )

    # --- Auto-create site from project name + location ---
    # Site is always derived from the project — no user-facing site step needed.
    existing_site = db.query(Site).filter(Site.name == body.name).first()
    if existing_site:
        resolved_site_id = existing_site.id
    else:
        new_site = Site(name=body.name, location=body.location, created_by=admin.id)
        db.add(new_site)
        db.flush()
        resolved_site_id = new_site.id

    # Create project
    project = Project(
        name=body.name,
        location=body.location,
        description=body.description,
        client_name=body.client_name,
        start_date=body.start_date,
        end_date=body.end_date,
        status=ProjectStatus.DRAFT,
        site_id=resolved_site_id,
        created_by=admin.id,
    )
    db.add(project)
    db.flush()  # get project.id without full commit

    # Create PM invitation (7-day expiry)
    token = secrets.token_urlsafe(48)
    invitation = ProjectInvitation(
        email=invitation_email,
        invited_name=invitation_name,
        project_id=project.id,
        role="project_manager",
        token=token,
        expires_at=datetime.now(timezone.utc) + timedelta(days=7),
        invited_by=admin.id,
        status=InvitationStatus.PENDING,
    )
    db.add(invitation)
    db.flush()

    log_event(
        db,
        "project_created",
        admin.id,
        {
            "project_id": project.id,
            "project_name": body.name,
            "site_id": resolved_site_id,
            "pm_email": invitation_email,
        },
        request=request,
        target_type="project",
        target_id=project.id,
    )
    log_event(
        db,
        "pm_invited",
        admin.id,
        {"project_id": project.id, "pm_email": invitation_email, "invitation_id": invitation.id},
        request=request,
        target_type="project",
        target_id=project.id,
    )

    db.commit()
    db.refresh(project)
    db.refresh(invitation)

    # Send email AFTER commit — failure never blocks the response
    send_invitation_email(
        to_email=invitation_email,
        project_name=project.name,
        role="Project Manager",
        invite_url=f"{settings.frontend_url}/invite/{invitation.token}",
        to_name=invitation_name,
    )

    return ProjectCreateResponse(
        **{c.name: getattr(project, c.name) for c in project.__table__.columns},
        invitation_token=invitation.token,
        invitation_id=invitation.id,
        invitation_email=invitation_email,
    )


@router.post("/{project_id}/invitations/{invitation_id}/resend")
def resend_invitation(
    project_id: int,
    invitation_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Regenerate token + resend invitation email."""
    invitation = (
        db.query(ProjectInvitation)
        .filter(
            ProjectInvitation.id == invitation_id,
            ProjectInvitation.project_id == project_id,
        )
        .first()
    )
    if not invitation:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED):
        raise HTTPException(status_code=400, detail="Only pending or expired invitations can be resent")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    invitation.token = secrets.token_urlsafe(48)
    invitation.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    invitation.status = InvitationStatus.PENDING
    db.commit()
    db.refresh(invitation)

    send_invitation_email(
        to_email=invitation.email,
        project_name=project.name,
        role="Project Manager",
        invite_url=f"{settings.frontend_url}/invite/{invitation.token}",
        to_name=invitation.invited_name or "",
    )

    return {"ok": True, "new_token": invitation.token}


@router.get("", response_model=List[ProjectOut])
def list_projects(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    return db.query(Project).order_by(Project.created_at.desc()).all()


@router.get("/users/list", response_model=List[UserListOut])
def list_users_for_pm(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return all active, approved non-admin users for the PM assignment dropdown."""
    from ...models.user import PlatformRole
    return (
        db.query(User)
        .filter(
            User.is_active == True,
            User.is_approved == True,
            User.platform_role == PlatformRole.USER,
            User.id != admin.id,  # never show the requesting admin in PM list
            ~func.lower(func.trim(User.email)).in_(
                ["system@constructionsight.com", "system@constructionsightai.com"]
            ),
        )
        .order_by(User.full_name)
        .all()
    )


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectOut)
def edit_project(
    request: Request,
    project_id: int,
    body: ProjectEdit,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Edit project details (name, location, description, client_name, start_date).
    Only allowed for DRAFT status projects.
    """
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status in (ProjectStatus.ARCHIVED, ProjectStatus.COMPLETED):
        raise HTTPException(status_code=400, detail="Archived or completed projects cannot be edited")

    # Apply non-None updates
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
        "project_edited",
        admin.id,
        {"project_id": project_id, "fields": list(update_data.keys())},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.patch("/{project_id}/status", response_model=ProjectOut)
def update_project_status(
    request: Request,
    project_id: int,
    body: ProjectStatusUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if body.status != "archived":
        raise HTTPException(status_code=400, detail="Only 'archived' status is allowed via this endpoint")
    if project.status != ProjectStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only active projects can be archived")

    project.status = ProjectStatus.ARCHIVED
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_archived",
        admin.id,
        {"project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    from ...services.notification_service import notify_project_members, notify_admins
    notify_project_members(
        db, project_id,
        type="project_archived",
        title=f"Project '{project.name}' has been archived",
        message="This project has been archived and is now read-only.",
        category="project",
        priority="high",
        action_url="/projects/my",
    )
    notify_admins(
        db,
        type="project_archived",
        title=f"Project '{project.name}' archived",
        message=f"Project has been archived by an administrator.",
        category="project",
        priority="medium",
        action_url="/admin/projects/list",
        project_id=project_id,
    )
    db.commit()
    return project


@router.post("/{project_id}/unarchive", response_model=ProjectOut)
def unarchive_project(
    request: Request,
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Restore an archived project back to ACTIVE status."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status != ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Only archived projects can be restored")

    project.status = ProjectStatus.ACTIVE
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_unarchived",
        admin.id,
        {"project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    from ...services.notification_service import notify_project_members, notify_admins
    notify_project_members(
        db, project_id,
        type="project_unarchived",
        title=f"Project '{project.name}' has been restored",
        message="This project has been restored and is now active again.",
        category="project",
        priority="medium",
        action_url=f"/projects/{project_id}",
    )
    notify_admins(
        db,
        type="project_unarchived",
        title=f"Project '{project.name}' restored",
        message=f"Project has been unarchived by an administrator.",
        category="project",
        priority="low",
        action_url="/admin/projects/list",
        project_id=project_id,
    )
    db.commit()
    return project


@router.post("/{project_id}/complete", response_model=ProjectOut)
def complete_project(
    request: Request,
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Mark an active project as completed."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status != ProjectStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Only active projects can be marked as complete")

    project.status = ProjectStatus.COMPLETED
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_completed",
        admin.id,
        {"project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.post("/{project_id}/uncomplete", response_model=ProjectOut)
def uncomplete_project(
    request: Request,
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Revert a completed project back to ACTIVE status."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status != ProjectStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Only completed projects can be unmarked")

    project.status = ProjectStatus.ACTIVE
    project.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "project_uncompleted",
        admin.id,
        {"project_id": project_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}")
def delete_project(
    request: Request,
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Delete a project (only allowed for DRAFT status projects)."""
    from ...models.project_membership import ProjectMembership

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.status == ProjectStatus.ACTIVE:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete active projects. Archive the project first, then it can be managed accordingly.",
        )
    elif project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(
            status_code=400,
            detail="Archived projects cannot be deleted to maintain compliance and audit trail.",
        )
    elif project.status == ProjectStatus.SETUP_IN_PROGRESS:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete projects in setup. Archive the project or wait for setup to complete.",
        )
    elif project.status != ProjectStatus.DRAFT:
        raise HTTPException(status_code=400, detail="Only draft projects can be deleted.")

    # Delete in order: invitations, memberships, project-cameras, settings, cameras/zones (via site), project, site
    db.query(ProjectInvitation).filter(ProjectInvitation.project_id == project_id).delete()
    db.query(ProjectMembership).filter(ProjectMembership.project_id == project_id).delete()

    # Delete ProjectCamera assignments explicitly (unassign all cameras)
    from ...models.project_camera import ProjectCamera
    db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).delete()

    # Delete ProjectSettings
    from ...models.project_settings import ProjectSettings
    db.query(ProjectSettings).filter(ProjectSettings.project_id == project_id).delete()

    # Delete PinnedProject (unpin from all users)
    from ...models.pinned_project import PinnedProject
    db.query(PinnedProject).filter(PinnedProject.project_id == project_id).delete()

    # Delete Notifications referencing this project
    from ...models.notification import Notification
    db.query(Notification).filter(Notification.project_id == project_id).delete()

    # Save site_id before deleting the project (project FK references site)
    site_id = project.site_id

    # Delete project first so FK constraint on projects.site_id is released
    db.delete(project)
    db.flush()

    # Now safe to cascade delete site and all cameras/zones for that site
    if site_id:
        from ...models.camera import Camera
        from ...models.zone import Zone

        db.query(Camera).filter(Camera.site_id == site_id).delete()
        db.query(Zone).filter(Zone.site_id == site_id).delete()
        db.query(Site).filter(Site.id == site_id).delete()

    log_event(
        db,
        "project_deleted",
        admin.id,
        {"project_id": project_id, "name": project.name, "site_id": site_id},
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    return {"ok": True}


ALLOWED_LOGO_TYPES = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
MAX_LOGO_SIZE = 2 * 1024 * 1024  # 2 MB


@router.post("/{project_id}/logo")
async def admin_upload_project_logo(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if file.content_type not in ALLOWED_LOGO_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, WebP, and SVG images are allowed")

    contents = await file.read()
    if len(contents) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="Logo must be under 2 MB")

    if project.logo_public_id:
        try:
            delete_asset(project.logo_public_id)
        except Exception:
            pass

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
def admin_delete_project_logo(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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


@router.get("/{project_id}/members", response_model=List[MemberOut])
def get_project_members(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get all members of a project (admin only, no membership check required)."""
    from ...models.project_membership import ProjectMembership, MembershipStatus

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

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


@router.get("/{project_id}/cameras")
def get_project_cameras(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get all cameras assigned to a project (admin only)."""
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera
    from ...models.zone import Zone

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    rows = db.query(Camera, ProjectCamera).join(
        ProjectCamera, ProjectCamera.camera_id == Camera.id
    ).filter(
        ProjectCamera.project_id == project_id
    ).all()

    result = []
    for c, pc in rows:
        zone_name = None
        if pc.zone_id:
            zone = db.query(Zone).filter(Zone.id == pc.zone_id).first()
            zone_name = zone.name if zone else None
        result.append({
            "id": c.id,
            "name": c.name,
            "vendor": c.vendor,
            "model": c.model,
            "registry_status": c.registry_status.value if c.registry_status else None,
            "logo_url": c.logo_url,
            "zone_id": pc.zone_id,
            "zone_name": zone_name,
        })
    return result


@router.get("/{project_id}/tasks")
def admin_list_tasks(
    project_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id
    ).order_by(ProjectTask.created_at.asc()).all()
    return [
        {
            "id": t.id,
            "project_id": t.project_id,
            "title": t.title,
            "is_done": t.is_done,
            "created_at": t.created_at,
            "done_at": t.done_at,
        }
        for t in tasks
    ]


class ProjectsExportPdfBody(BaseModel):
    filter: Optional[str] = "all"
    generated_by_name: Optional[str] = "Administrator"


@router.post("/export/pdf")
def export_projects_pdf(
    body: ProjectsExportPdfBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Stream a PDF listing of all projects, matching the PPE report visual style."""
    from ...services.pdf_report_service import generate_projects_pdf_report, ReportGenerationError

    filter_val = str(body.filter or "all").lower()
    filter_label_map = {
        "all": "All Projects",
        "active": "Active Projects",
        "archived": "Archived Projects",
        "completed": "Completed Projects",
        "draft": "Draft Projects",
        "setup": "Setup In Progress",
    }
    filter_label = filter_label_map.get(filter_val, "All Projects")

    query = db.query(Project).order_by(Project.created_at.desc())
    if filter_val == "active":
        query = query.filter(Project.status == ProjectStatus.ACTIVE)
    elif filter_val == "archived":
        query = query.filter(Project.status == ProjectStatus.ARCHIVED)
    elif filter_val == "completed":
        query = query.filter(Project.status == ProjectStatus.COMPLETED)
    elif filter_val == "draft":
        query = query.filter(Project.status == ProjectStatus.DRAFT)
    elif filter_val == "setup":
        query = query.filter(Project.status == ProjectStatus.SETUP_IN_PROGRESS)

    projects = query.all()

    generated_by = str(body.generated_by_name or admin.full_name or "Administrator")

    try:
        pdf_bytes = generate_projects_pdf_report(
            projects=projects,
            filter_label=filter_label,
            generated_by=generated_by,
        )
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    import io
    from datetime import date
    filename = f"Projects_Export_{date.today().isoformat()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ── Dashboard Stats ──────────────────────────────────────────────────────────

@router.get("/dashboard/stats")
def dashboard_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return aggregated stats for the analytics dashboard."""
    from sqlalchemy import text, extract
    from ...models.camera import Camera
    from datetime import date as _date, timedelta as _timedelta

    # ── counts ────────────────────────────────────────────────────────────────
    total_projects = db.query(func.count(Project.id)).scalar() or 0
    active_projects = db.query(func.count(Project.id)).filter(Project.status == "active").scalar() or 0
    archived_projects = db.query(func.count(Project.id)).filter(Project.status == "archived").scalar() or 0
    draft_projects = db.query(func.count(Project.id)).filter(Project.status == "draft").scalar() or 0
    setup_projects = db.query(func.count(Project.id)).filter(Project.status == "setup_in_progress").scalar() or 0

    total_cameras = db.query(func.count(Camera.id)).filter(Camera.registry_status != "archived").scalar() or 0
    online_cameras = db.query(func.count(Camera.id)).filter(
        Camera.registry_status == "verified",
        Camera.archived_at.is_(None),
    ).scalar() or 0

    total_users = db.query(func.count(User.id)).scalar() or 0
    approved_users = db.query(func.count(User.id)).filter(User.is_approved == True).scalar() or 0

    # ── monthly data (last 12 months by creation month, current year) ─────────
    current_year = _date.today().year

    proj_by_month_rows = db.execute(text("""
        SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*) AS cnt
        FROM projects
        WHERE EXTRACT(YEAR FROM created_at) = :yr
        GROUP BY m
    """), {"yr": current_year}).fetchall()
    proj_by_month = {r.m: int(r.cnt) for r in proj_by_month_rows}

    cam_by_month_rows = db.execute(text("""
        SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*) AS cnt
        FROM cameras
        WHERE EXTRACT(YEAR FROM created_at) = :yr
        GROUP BY m
    """), {"yr": current_year}).fetchall()
    cam_by_month = {r.m: int(r.cnt) for r in cam_by_month_rows}

    events_by_month_rows = db.execute(text("""
        SELECT EXTRACT(MONTH FROM created_at)::int AS m, COUNT(*) AS cnt
        FROM auth_events
        WHERE EXTRACT(YEAR FROM created_at) = :yr
        GROUP BY m
    """), {"yr": current_year}).fetchall()
    events_by_month = {r.m: int(r.cnt) for r in events_by_month_rows}

    monthly_projects = [proj_by_month.get(m, 0) for m in range(1, 13)]
    monthly_cameras = [cam_by_month.get(m, 0) for m in range(1, 13)]
    monthly_events = [events_by_month.get(m, 0) for m in range(1, 13)]

    # ── last 7 days (chronological) ──────────────────────────────────────────
    start_day = _date.today() - _timedelta(days=6)
    daily_rows = db.execute(text("""
        WITH days AS (
            SELECT generate_series(CAST(:start_day AS date), CURRENT_DATE, interval '1 day')::date AS d
        ),
        proj AS (
            SELECT created_at::date AS d, COUNT(*)::int AS cnt
            FROM projects
            WHERE created_at::date >= CAST(:start_day AS date)
            GROUP BY 1
        ),
        cam AS (
            SELECT created_at::date AS d, COUNT(*)::int AS cnt
            FROM cameras
            WHERE created_at::date >= CAST(:start_day AS date)
            GROUP BY 1
        ),
        events AS (
            SELECT created_at::date AS d, COUNT(*)::int AS cnt
            FROM auth_events
            WHERE created_at::date >= CAST(:start_day AS date)
            GROUP BY 1
        ),
        logins_ok AS (
            SELECT created_at::date AS d, COUNT(*)::int AS cnt
            FROM auth_events
            WHERE event_type = 'login_success'
              AND created_at::date >= CAST(:start_day AS date)
            GROUP BY 1
        ),
        logins_fail AS (
            SELECT created_at::date AS d, COUNT(*)::int AS cnt
            FROM auth_events
            WHERE event_type IN ('login_fail', 'login_failed')
              AND created_at::date >= CAST(:start_day AS date)
            GROUP BY 1
        )
        SELECT
            days.d,
            COALESCE(proj.cnt, 0)   AS projects,
            COALESCE(cam.cnt, 0)    AS cameras,
            COALESCE(events.cnt, 0) AS events,
            COALESCE(logins_ok.cnt, 0) AS logins,
            COALESCE(logins_fail.cnt, 0) AS login_fails
        FROM days
        LEFT JOIN proj   ON proj.d = days.d
        LEFT JOIN cam    ON cam.d = days.d
        LEFT JOIN events     ON events.d = days.d
        LEFT JOIN logins_ok  ON logins_ok.d = days.d
        LEFT JOIN logins_fail ON logins_fail.d = days.d
        ORDER BY days.d ASC
    """), {"start_day": start_day}).fetchall()

    last7_labels = []
    last7_projects = []
    last7_cameras = []
    last7_events = []
    last7_logins = []
    last7_login_fails = []
    for r in daily_rows:
        d = r.d
        last7_labels.append(f"{int(d.day):02d}/{int(d.month):02d}")
        last7_projects.append(int(r.projects or 0))
        last7_cameras.append(int(r.cameras or 0))
        last7_events.append(int(r.events or 0))
        last7_logins.append(int(r.logins or 0))
        last7_login_fails.append(int(r.login_fails or 0))

    # ── weekly activity (last 4 weeks, grouped by day-of-week 0=Sun … 6=Sat) ─
    proj_dow_rows = db.execute(text("""
        SELECT EXTRACT(DOW FROM created_at)::int AS d, COUNT(*) AS cnt
        FROM projects
        WHERE created_at >= NOW() - INTERVAL '28 days'
        GROUP BY d
    """)).fetchall()
    cam_dow_rows = db.execute(text("""
        SELECT EXTRACT(DOW FROM created_at)::int AS d, COUNT(*) AS cnt
        FROM cameras
        WHERE created_at >= NOW() - INTERVAL '28 days'
        GROUP BY d
    """)).fetchall()
    login_dow_rows = db.execute(text("""
        SELECT EXTRACT(DOW FROM created_at)::int AS d, COUNT(*) AS cnt
        FROM auth_events
        WHERE event_type = 'login_success'
          AND created_at >= NOW() - INTERVAL '28 days'
        GROUP BY d
    """)).fetchall()

    proj_dow = {r.d: int(r.cnt) for r in proj_dow_rows}
    cam_dow = {r.d: int(r.cnt) for r in cam_dow_rows}
    login_dow = {r.d: int(r.cnt) for r in login_dow_rows}
    weekly_projects = [proj_dow.get(d, 0) for d in range(7)]
    weekly_cameras = [cam_dow.get(d, 0) for d in range(7)]
    weekly_logins = [login_dow.get(d, 0) for d in range(7)]

    # ── recent auth events (last 50) ────────────────────────────────────────
    recent_rows = db.execute(text("""
        SELECT ae.id, ae.event_type, ae.user_id, ae.identifier, ae.extra, ae.created_at,
               u.full_name AS actor_name
        FROM auth_events ae
        LEFT JOIN users u ON u.id = ae.user_id
        ORDER BY ae.created_at DESC
        LIMIT 50
    """)).fetchall()

    recent_events = []
    for r in recent_rows:
        import json as _json
        meta = {}
        if r.extra:
            try:
                meta = _json.loads(r.extra) if isinstance(r.extra, str) else r.extra
            except Exception:
                pass
        if r.identifier and isinstance(meta, dict):
            if "@" in str(r.identifier):
                meta.setdefault("email", r.identifier)
            else:
                meta.setdefault("identifier", r.identifier)
        recent_events.append({
            "id": r.id,
            "event_type": r.event_type,
            "user_id": r.user_id,
            "actor_name": r.actor_name,
            "target_type": "auth",
            "target_id": None,
            "details": meta,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    login_rows = db.execute(text("""
        SELECT ae.id, ae.event_type, ae.user_id, ae.identifier, ae.extra, ae.created_at,
               u.full_name AS actor_name
        FROM auth_events ae
        LEFT JOIN users u ON u.id = ae.user_id
        WHERE ae.event_type IN ('login_success', 'login_fail', 'login_failed', 'logout', 'logout_all')
        ORDER BY ae.created_at DESC
        LIMIT 50
    """)).fetchall()
    login_events = []
    for r in login_rows:
        import json as _json
        meta = {}
        if r.extra:
            try:
                meta = _json.loads(r.extra) if isinstance(r.extra, str) else r.extra
            except Exception:
                pass
        if r.identifier and isinstance(meta, dict):
            if "@" in str(r.identifier):
                meta.setdefault("email", r.identifier)
            else:
                meta.setdefault("identifier", r.identifier)
        login_events.append({
            "id": r.id,
            "event_type": r.event_type,
            "user_id": r.user_id,
            "actor_name": r.actor_name,
            "details": meta,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })

    return {
        "counts": {
            "total_projects": total_projects,
            "active": active_projects,
            "archived": archived_projects,
            "draft": draft_projects,
            "setup": setup_projects,
            "total_cameras": total_cameras,
            "online_cameras": online_cameras,
            "total_users": total_users,
            "approved_users": approved_users,
        },
        "monthly_projects": monthly_projects,
        "monthly_cameras": monthly_cameras,
        "monthly_events": monthly_events,
        "last_7_days": {
            "labels": last7_labels,
            "projects": last7_projects,
            "cameras": last7_cameras,
            "events": last7_events,
            "logins": last7_logins,
            "login_fails": last7_login_fails,
        },
        "weekly_activity": {
            "projects": weekly_projects,
            "cameras": weekly_cameras,
            "logins": weekly_logins,
        },
        "recent_events": recent_events,
        "login_events": login_events,
    }


@router.get("/dashboard/events")
def dashboard_events(
    page: int = 1,
    per_page: int = 30,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Paginated audit_logs for the last 30 days (admin dashboard table)."""
    import json as _json
    from datetime import datetime as _dt, timedelta as _td
    from sqlalchemy import text as _text

    per_page = max(1, min(per_page, 100))
    page     = max(1, page)
    offset   = (page - 1) * per_page

    total = db.execute(
        _text("SELECT COUNT(*) FROM audit_logs"),
    ).scalar() or 0

    rows = db.execute(_text("""
        SELECT al.id, al.action, al.actor_id, al.target_type, al.target_id,
               al.metadata, al.created_at,
               u.full_name AS actor_name
        FROM audit_logs al
        LEFT JOIN users u ON u.id = al.actor_id
        ORDER BY al.created_at DESC
        LIMIT :lim OFFSET :off
    """), {"lim": per_page, "off": offset}).fetchall()

    items = []
    for r in rows:
        meta = {}
        if r.metadata:
            try:
                meta = _json.loads(r.metadata) if isinstance(r.metadata, str) else r.metadata
            except Exception:
                pass
        items.append({
            "id":          r.id,
            "event_type":  r.action,
            "actor_id":    r.actor_id,
            "actor_name":  r.actor_name,
            "target_type": r.target_type,
            "target_id":   r.target_id,
            "details":     meta,
            "created_at":  r.created_at.isoformat() if r.created_at else None,
        })

    return {"items": items, "total": total, "page": page, "per_page": per_page}
