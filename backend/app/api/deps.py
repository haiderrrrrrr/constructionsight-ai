from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session
from typing import Optional
import json

from ..core.db import get_db
from ..core.security import decode_access_token
from ..models.user import User, PlatformRole


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    authz = request.headers.get("authorization") or ""
    if not authz.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authz.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid access token")
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid access token")
    user = db.query(User).filter(User.id == int(sub)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account disabled")
    if not user.is_approved:
        raise HTTPException(status_code=403, detail="Account pending approval. Please wait for an administrator to approve your account.")
    ver = payload.get("ver")
    if ver is None or int(ver) != int(user.token_version or 1):
        raise HTTPException(status_code=401, detail="Invalid access token")
    return user


def get_current_user_optional(request: Request, db: Session = Depends(get_db)) -> Optional[User]:
    """Like get_current_user but returns None instead of raising for missing/invalid tokens."""
    authz = request.headers.get("authorization") or ""
    if not authz.lower().startswith("bearer "):
        return None
    token = authz.split(" ", 1)[1].strip()
    try:
        payload = decode_access_token(token)
    except Exception:
        return None
    sub = payload.get("sub")
    if not sub:
        return None
    user = db.query(User).filter(User.id == int(sub)).first()
    if not user or not user.is_active or not user.is_approved:
        return None
    ver = payload.get("ver")
    if ver is None or int(ver) != int(user.token_version or 1):
        return None
    return user


def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.platform_role != PlatformRole.ADMIN:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def log_event(
    db: Session,
    event_type: str,
    user_id: Optional[int],
    extra: Optional[dict] = None,
    *,
    request: Request | None = None,
    target_type: str | None = None,
    target_id: int | None = None,
):
    """
    Write a structured audit event to the dedicated audit_logs table.

    Uses a savepoint (begin_nested) so that if the insert fails — e.g. because
    the audit_logs table doesn't exist yet on first boot — only that savepoint
    is rolled back.  The outer transaction (camera create, health-check, etc.)
    is completely unaffected.
    """
    try:
        from sqlalchemy import text as _text
        meta = json.dumps(extra) if extra else None
        ip = _client_ip(request) if request else None
        with db.begin_nested():   # SAVEPOINT — failure rolls back only this block
            db.execute(
                _text(
                    "INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, ip_address) "
                    "VALUES (:actor, :action, :target_type, :target_id, CAST(:meta AS jsonb), :ip)"
                ),
                {
                    "actor": user_id,
                    "action": event_type,
                    "target_type": target_type,
                    "target_id": target_id,
                    "meta": meta,
                    "ip": ip,
                },
            )
        # caller is responsible for the outer db.commit()
    except Exception:
        pass  # never let audit logging break the main flow


def build_runtime_status(camera_obj, analytics_obj=None):
    """
    Build structured runtime status for a camera (Fix 3: separate status layers).

    Returns:
    {
        "stream_status": "online" | "offline",
        "reader_status": "running" | "error" | "unknown",
        "feature_statuses": {
            "ppe": {"status": "running" | "idle" | "error", "error": str | null},
            "workforce": {"status": "running" | "idle" | "error", "error": str | null},
            ...
        }
    }
    """
    # Determine stream_status from latest health check
    latest_health = camera_obj.last_health_check_at
    stream_status = "online" if latest_health and camera_obj.worker_status != "error" else "offline"

    # Determine reader_status from worker_status and error
    if camera_obj.worker_status == "error":
        reader_status = "error"
    elif camera_obj.worker_status == "running":
        reader_status = "running"
    else:
        reader_status = "unknown"

    # Build feature statuses from analytics
    feature_statuses = {}
    if analytics_obj:
        features = [
            ("ppe", analytics_obj.ppe_enabled),
            ("workforce", analytics_obj.workforce_enabled),
            ("activity", analytics_obj.activity_enabled),
            ("equipment", analytics_obj.equipment_enabled),
        ]
        for feat_name, feat_enabled in features:
            if feat_enabled:
                feature_statuses[feat_name] = {"status": "running", "error": None}
            else:
                feature_statuses[feat_name] = {"status": "idle", "error": None}

    return {
        "stream_status": stream_status,
        "reader_status": reader_status,
        "feature_statuses": feature_statuses,
    }
