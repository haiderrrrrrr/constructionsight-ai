"""
User-level notification endpoints — for non-admin users (PM, safety_officer, etc.).
Includes SSE stream endpoint for real-time push delivery.
"""
import asyncio
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ...core.db import get_db
from ...api.deps import get_current_user
from ...models.user import User
from ...models.notification import Notification
from ...schemas.notification import NotificationOut

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _user_from_token(token: str, db: Session) -> User:
    """Decode JWT query param and return User — used by SSE since EventSource can't send headers."""
    from ...core.security import decode_access_token
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
    return user


@router.get("/stream")
async def notification_stream(
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    SSE stream for real-time notification delivery.
    Auth via ?token= query param because browser EventSource cannot send Authorization headers.
    Heartbeat every 25s keeps the connection alive through proxies.
    """
    if not token:
        raise HTTPException(status_code=401, detail="token query param required")

    current_user = _user_from_token(token, db)
    user_id = current_user.id
    db.close()  # release DB connection before long-lived stream

    from ...services.notification_broker import register, unregister

    q = register(user_id)

    async def event_generator():
        try:
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(payload)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            unregister(user_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("", response_model=List[NotificationOut])
def list_notifications(
    category: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Notification).filter(Notification.user_id == current_user.id)
    if category:
        q = q.filter(Notification.category == category)
    return q.order_by(Notification.created_at.desc()).limit(50).all()


@router.get("/unread-count")
def unread_count(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = (
        db.query(Notification)
        .filter(
            Notification.user_id == current_user.id,
            Notification.is_read == False,  # noqa: E712
        )
        .count()
    )
    return {"count": count}


@router.patch("/mark-all-read")
def mark_all_read(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(Notification).filter(
        Notification.user_id == current_user.id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return {"ok": True}


@router.patch("/{notification_id}/read")
def mark_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.get(Notification, notification_id)
    if notif and notif.user_id == current_user.id:
        notif.is_read = True
        db.commit()
    return {"ok": True}


@router.delete("/{notification_id}")
def delete_notification(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = db.get(Notification, notification_id)
    if notif and notif.user_id == current_user.id:
        db.delete(notif)
        db.commit()
    return {"ok": True}
