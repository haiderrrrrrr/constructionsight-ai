"""
Notification Service — centralized helpers for creating and delivering notifications.

All three public functions:
  - Write Notification rows to the database
  - Push real-time payloads to active SSE connections via the broker
  - Never raise (errors are logged and swallowed)

Usage:
    from ..services.notification_service import notify_users, notify_admins, notify_project_members

    notify_admins(db, type='camera_offline', title='...', message='...', category='camera')
    notify_project_members(db, project_id=5, type='task_created', ..., exclude_user_id=current_user.id)
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional

logger = logging.getLogger(__name__)


def notify_users(
    db,
    user_ids: List[int],
    *,
    type: str,
    title: str,
    message: str,
    category: Optional[str] = None,
    priority: Optional[str] = "medium",
    action_url: Optional[str] = None,
    project_id: Optional[int] = None,
    camera_id: Optional[int] = None,
    task_id: Optional[int] = None,
) -> None:
    """Create a Notification row for each user_id and push via SSE broker."""
    if not user_ids:
        return
    try:
        from ..models.notification import Notification
        from . import notification_broker as broker

        created_at = datetime.now(timezone.utc)
        for uid in user_ids:
            n = Notification(
                user_id    = uid,
                type       = type,
                title      = title,
                message    = message,
                category   = category,
                priority   = priority,
                action_url = action_url,
                project_id = project_id,
                camera_id  = camera_id,
                task_id    = task_id,
                is_read    = False,
            )
            db.add(n)
        db.flush()  # get IDs without committing

        # Push real-time payload for each user
        for uid in user_ids:
            broker.push(uid, {
                "type":       type,
                "title":      title,
                "message":    message,
                "category":   category,
                "priority":   priority,
                "action_url": action_url,
                "project_id": project_id,
                "camera_id":  camera_id,
                "task_id":    task_id,
                "is_read":    False,
                "created_at": created_at.isoformat(),
            })
    except Exception as e:
        logger.error(f"[notification_service] notify_users failed: {e}", exc_info=True)


def notify_admins(
    db,
    *,
    type: str,
    title: str,
    message: str,
    category: Optional[str] = None,
    priority: Optional[str] = "medium",
    action_url: Optional[str] = None,
    project_id: Optional[int] = None,
    camera_id: Optional[int] = None,
) -> None:
    """Create notifications for all active platform admins."""
    try:
        from ..models.user import User, PlatformRole
        admins = (
            db.query(User)
            .filter(User.platform_role == PlatformRole.ADMIN, User.is_active == True)
            .all()
        )
        admin_ids = [a.id for a in admins]
        notify_users(
            db, admin_ids,
            type=type, title=title, message=message,
            category=category, priority=priority, action_url=action_url,
            project_id=project_id, camera_id=camera_id,
        )
    except Exception as e:
        logger.error(f"[notification_service] notify_admins failed: {e}", exc_info=True)


def notify_project_members(
    db,
    project_id: int,
    *,
    type: str,
    title: str,
    message: str,
    roles: Optional[List] = None,
    exclude_user_id: Optional[int] = None,
    category: Optional[str] = None,
    priority: Optional[str] = "medium",
    action_url: Optional[str] = None,
    camera_id: Optional[int] = None,
    task_id: Optional[int] = None,
) -> None:
    """Create notifications for active project members (optional role filter, optional exclude)."""
    try:
        from ..models.project_membership import ProjectMembership, MembershipStatus

        q = db.query(ProjectMembership).filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        if roles:
            q = q.filter(ProjectMembership.project_role.in_(roles))
        members = q.all()

        user_ids = [
            m.user_id for m in members
            if exclude_user_id is None or m.user_id != exclude_user_id
        ]
        notify_users(
            db, user_ids,
            type=type, title=title, message=message,
            category=category, priority=priority, action_url=action_url,
            project_id=project_id, camera_id=camera_id, task_id=task_id,
        )
    except Exception as e:
        logger.error(f"[notification_service] notify_project_members failed: {e}", exc_info=True)
