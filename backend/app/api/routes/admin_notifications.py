from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...api.deps import require_admin
from ...models.user import User
from ...models.notification import Notification
from ...schemas.notification import NotificationOut

router = APIRouter(prefix="/admin/notifications", tags=["admin-notifications"])


@router.get("", response_model=List[NotificationOut])
def list_notifications(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Return the 50 most recent notifications for the current admin."""
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if category:
        q = q.filter(Notification.category == category)
    return q.order_by(Notification.created_at.desc()).limit(50).all()


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    count = (
        db.query(Notification)
        .filter(Notification.user_id == current_user.id, Notification.is_read == False)
        .count()
    )
    return {"count": count}


# Register /mark-all-read BEFORE /{notification_id}/read to avoid path conflict
@router.patch("/mark-all-read")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.patch("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    notif = db.get(Notification, notification_id)
    if not notif or notif.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.is_read = True
    db.commit()
    return {"ok": True}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Permanently delete a notification."""
    notif = db.get(Notification, notification_id)
    if notif and notif.user_id == current_user.id:
        db.delete(notif)
        db.commit()
    return {"ok": True}
