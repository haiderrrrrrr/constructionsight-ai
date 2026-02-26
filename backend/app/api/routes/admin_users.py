"""Admin endpoints for managing users."""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models.user import User
from ...models.project_membership import ProjectMembership
from ...models.token import RefreshToken
from ...schemas.user import AdminUserOut, UserRoleUpdate
from ..deps import get_db, require_admin, log_event

router = APIRouter(prefix="/admin/users", tags=["admin-users"])


@router.get("", response_model=List[AdminUserOut])
def list_users(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """List all users with active project counts (admin only)."""
    # Subquery to count unique active projects per user
    count_subq = db.query(
        ProjectMembership.user_id,
        func.count(func.distinct(ProjectMembership.project_id)).label('count')
    ).filter(ProjectMembership.status == 'active').group_by(ProjectMembership.user_id).subquery()

    # Main query with LEFT JOIN to include users with no memberships
    rows = db.query(
        User,
        func.coalesce(count_subq.c.count, 0).label('active_project_count')
    ).outerjoin(
        count_subq,
        User.id == count_subq.c.user_id
    ).order_by(User.created_at.desc()).all()

    return [
        AdminUserOut(
            id=user.id,
            full_name=user.full_name,
            email=user.email,
            username=user.username,
            platform_role=user.platform_role.value,
            is_active=user.is_active,
            is_approved=user.is_approved,
            auth_provider=user.auth_provider,
            avatar_url=user.avatar_url,
            created_at=user.created_at.isoformat(),
            failed_login_count=user.failed_login_count,
            locked_until=user.locked_until.isoformat() if user.locked_until else None,
            active_project_count=int(count),
        )
        for user, count in rows
    ]


class UsersExportPdfBody(BaseModel):
    filter: str = "all"
    generated_by_name: str = "Administrator"


@router.post("/export/pdf")
def export_users_pdf(
    body: UsersExportPdfBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date, timezone as _tz, timedelta as _td
    from fastapi.responses import StreamingResponse as _SR
    from ...models.user import PlatformRole

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Users",
        "active": "Active Users",
        "inactive": "Inactive Users",
        "pending": "Pending Approval",
        "approved": "Approved Users",
        "admins": "Admins",
    }
    filter_label = filter_map.get(filter_val, "All Users")

    count_subq = db.query(
        ProjectMembership.user_id,
        func.count(func.distinct(ProjectMembership.project_id)).label('count')
    ).filter(ProjectMembership.status == 'active').group_by(ProjectMembership.user_id).subquery()

    query = db.query(
        User,
        func.coalesce(count_subq.c.count, 0).label('active_project_count')
    ).outerjoin(
        count_subq,
        User.id == count_subq.c.user_id
    ).order_by(User.created_at.desc())

    if filter_val == "active":
        query = query.filter(User.is_active == True)
    elif filter_val == "inactive":
        query = query.filter(User.is_active == False)
    elif filter_val == "pending":
        query = query.filter(User.is_approved == False, User.is_active == True)
    elif filter_val == "approved":
        query = query.filter(User.is_approved == True)
    elif filter_val == "admins":
        query = query.filter(User.platform_role == PlatformRole.ADMIN)

    rows = query.all()

    def _fmt_date_pk(v):
        if not v:
            return "—"
        try:
            pk = _tz(_td(hours=5))
            if getattr(v, "tzinfo", None) is None:
                v = v.replace(tzinfo=_tz.utc)
            return v.astimezone(pk).strftime("%b %d, %Y")
        except Exception:
            return str(v)

    headers = ["User", "Email", "Access Level", "Account Status", "Approval", "Assigned", "Joined At"]
    rows_data = []
    for u, project_count in rows:
        access = "Administrator" if str(u.platform_role.value).lower() == "admin" else "User"
        active = "Active" if u.is_active else "Deactivated"
        approval = "Approved" if u.is_approved else "Pending"
        rows_data.append([
            str(u.full_name or "—"),
            str(u.email or "—"),
            access,
            active,
            approval,
            str(int(project_count) if project_count else 0),
            _fmt_date_pk(u.created_at),
        ])

    total = len(rows_data)
    active_n = sum(1 for (u, _c) in rows if u.is_active)
    inactive_n = sum(1 for (u, _c) in rows if not u.is_active)
    pending_n = sum(1 for (u, _c) in rows if (not u.is_approved) and u.is_active)
    admin_n = sum(1 for (u, _c) in rows if str(u.platform_role.value).lower() == "admin")

    kpi_items = [
        (total, "Total", HexColor("#ffffff"), HexColor("#1e3a5f")),
        (active_n, "Active", HexColor("#15803d"), HexColor("#dcfce7")),
        (inactive_n, "Inactive", HexColor("#b91c1c"), HexColor("#fee2e2")),
        (admin_n, "Admins", HexColor("#7c3aed"), HexColor("#ede9fe")),
    ]

    status_fg = {"active": HexColor("#15803d"), "deactivated": HexColor("#b91c1c")}
    status_bg = {"active": HexColor("#dcfce7"), "deactivated": HexColor("#fee2e2")}

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Users Directory Report",
            headers=headers,
            rows=rows_data,
            col_widths=[110, 140, 70, 65, 60, 45, 61],
            meta_pairs=[("Report", "Users Directory")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or admin.full_name or "Administrator"),
            kpi_items=kpi_items,
            status_col_index=3,
            status_fg=status_fg,
            status_bg=status_bg,
        )
        fname = f"Users_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf",
                   headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/stats")
def get_user_stats(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Get user statistics (counts by status)."""
    total_active = db.query(User).filter(User.is_active == True).count()
    total_inactive = db.query(User).filter(User.is_active == False).count()
    total_pending = db.query(User).filter(User.is_approved == False, User.is_active == True).count()
    from ...models.user import PlatformRole
    total_admins = db.query(User).filter(User.platform_role == PlatformRole.ADMIN).count()

    return {
        "active": total_active,
        "inactive": total_inactive,
        "pending": total_pending,
        "admins": total_admins,
    }


@router.patch("/{user_id}/approve")
def toggle_user_approval(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Toggle user approval status (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot change approval for admin users
    if user.platform_role.value == 'admin':
        raise HTTPException(status_code=400, detail="Cannot change approval status for admin users")

    unapproving = bool(user.is_approved)
    user.is_approved = not user.is_approved

    # When unapproving: immediately invalidate all existing sessions
    sessions_cleared = False
    if unapproving:
        db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
        user.token_version = (user.token_version or 1) + 1
        sessions_cleared = True
    db.commit()
    db.refresh(user)

    if user.is_approved:
        # Notify the user their account was approved
        from ...services.notification_service import notify_users
        notify_users(
            db, [user.id],
            type="account_approved",
            title="Account Approved",
            message="Your account has been approved. You can now log in to ConstructionSight AI.",
            category="account",
            priority="high",
            action_url="/home",
        )
        db.commit()

    log_event(
        db,
        "user_approval_toggled",
        admin.id,
        {
            "user_id": user.id,
            "new_is_approved": user.is_approved,
            "sessions_cleared": sessions_cleared,
        },
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {
        "id": user.id,
        "is_approved": user.is_approved,
        "message": f"User {'approved' if user.is_approved else 'unapproved'}"
    }


@router.patch("/{user_id}/activate")
def toggle_user_activation(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Toggle user active status (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot deactivate yourself
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot deactivate your own account")

    deactivating = user.is_active  # True means we are deactivating
    user.is_active = not user.is_active

    # When deactivating: immediately invalidate all existing sessions
    sessions_cleared = False
    if deactivating:
        db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
        user.token_version = (user.token_version or 1) + 1
        sessions_cleared = True

    db.commit()
    db.refresh(user)

    log_event(
        db,
        "user_activation_toggled",
        admin.id,
        {
            "user_id": user.id,
            "new_is_active": user.is_active,
            "sessions_cleared": sessions_cleared,
        },
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {
        "id": user.id,
        "is_active": user.is_active,
        "message": f"User {'activated' if user.is_active else 'deactivated. All sessions cleared.'}"
    }


@router.patch("/{user_id}/role")
def change_user_role(
    user_id: int,
    body: UserRoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Change user platform role (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot change your own role
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot change your own role")

    # Validate role
    if body.role not in ['admin', 'user']:
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'user'")

    from ...models.user import PlatformRole
    old_role = user.platform_role.value
    user.platform_role = PlatformRole(body.role)

    # Role changes must invalidate existing sessions so old JWT role can't linger.
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
    user.token_version = (user.token_version or 1) + 1
    db.commit()
    db.refresh(user)

    log_event(
        db,
        "user_role_changed",
        admin.id,
        {
            "user_id": user.id,
            "old_role": old_role,
            "new_role": body.role,
            "sessions_cleared": True,
        },
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {
        "id": user.id,
        "platform_role": body.role,
        "message": f"User role changed to {body.role}"
    }


@router.post("/{user_id}/force-logout")
def force_logout_user(
    user_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Force logout user by incrementing token_version (admin only)."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Cannot force-logout yourself
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot force-logout your own account")

    old_version = user.token_version
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
    user.token_version = (user.token_version or 1) + 1
    db.commit()
    db.refresh(user)

    log_event(
        db,
        "user_force_logout",
        admin.id,
        {
            "user_id": user.id,
            "old_token_version": old_version,
            "new_token_version": user.token_version,
            "refresh_tokens_revoked": True,
        },
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {
        "id": user.id,
        "token_version": user.token_version,
        "message": "User sessions invalidated"
    }
