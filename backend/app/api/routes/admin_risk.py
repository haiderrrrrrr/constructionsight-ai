"""
Admin Risk Analytics endpoints — scheduler configuration.
Prefix: /admin/risk
Auth:   require_admin
These endpoints are registered in BOTH app.main (port 8000) and app_stream (port 8001).
- Port 8000: updates DB, returns status (scheduler in-memory state from 8001 not visible)
- Port 8001: updates DB + calls in-memory risk_scheduler directly (trigger_now works here)
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..deps import get_db, get_current_user
from ...models.user import User
from ...schemas.risk import RiskSchedulerConfigUpdate, RiskSchedulerStatusOut

router = APIRouter(prefix="/admin/risk", tags=["admin-risk"])


def _require_risk_manager(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Allow platform admin OR any active project manager."""
    from ...models.user import PlatformRole
    if user.platform_role == PlatformRole.ADMIN:
        return user
    from ...models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
    has_pm = db.query(ProjectMembership).filter(
        ProjectMembership.user_id == user.id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
        ProjectMembership.project_role == ProjectRole.PROJECT_MANAGER,
    ).first()
    if not has_pm:
        raise HTTPException(status_code=403, detail="Project Manager or Admin access required")
    return user


def _get_db_config(db: Session) -> dict:
    from ...models.risk_scheduler_config import RiskSchedulerConfig
    cfg = db.query(RiskSchedulerConfig).filter(RiskSchedulerConfig.id == 1).first()
    if not cfg:
        return {"enabled": True, "interval_seconds": 30}
    return {"enabled": cfg.enabled, "interval_seconds": cfg.interval_seconds}


def _upsert_db_config(db: Session, enabled: Optional[bool], interval_seconds: Optional[int]) -> None:
    from ...models.risk_scheduler_config import RiskSchedulerConfig
    cfg = db.query(RiskSchedulerConfig).filter(RiskSchedulerConfig.id == 1).first()
    if not cfg:
        cfg = RiskSchedulerConfig(id=1)
        db.add(cfg)
    if enabled is not None:
        cfg.enabled = enabled
    if interval_seconds is not None:
        cfg.interval_seconds = interval_seconds
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()


# ── GET /admin/risk/scheduler/status ─────────────────────────────────────────

@router.get("/scheduler/status")
def get_scheduler_status(
    admin: User   = Depends(_require_risk_manager),
    db:    Session = Depends(get_db),
):
    # Try in-memory scheduler (works when called from port 8001 process)
    try:
        from ...services.risk.risk_scheduler import get_status
        status = get_status()
        return status
    except Exception:
        pass

    # Fallback: return DB config only (when called from port 8000)
    cfg = _get_db_config(db)
    return {
        "enabled":          cfg["enabled"],
        "interval_seconds": cfg["interval_seconds"],
        "last_run_at":      None,
        "next_run_at":      None,
        "last_summary":     None,
        "is_running":       False,
        "scheduler_active": False,
    }


# ── PATCH /admin/risk/scheduler/config ────────────────────────────────────────

@router.patch("/scheduler/config")
def update_scheduler_config(
    body:  RiskSchedulerConfigUpdate,
    admin: User    = Depends(_require_risk_manager),
    db:    Session = Depends(get_db),
):
    if body.enabled is None and body.interval_seconds is None:
        raise HTTPException(status_code=400, detail="Provide enabled or interval_seconds")

    _upsert_db_config(db, body.enabled, body.interval_seconds)

    # Hot-update in-memory scheduler if available (port 8001 process)
    try:
        from ...services.risk.risk_scheduler import update_config, get_status
        update_config(
            interval_seconds=body.interval_seconds,
            enabled=body.enabled,
        )
        return get_status()
    except Exception:
        pass

    return _get_db_config(db)


# ── POST /admin/risk/scheduler/trigger ────────────────────────────────────────

@router.post("/scheduler/trigger")
def trigger_scheduler_now(
    admin: User   = Depends(_require_risk_manager),
    db:    Session = Depends(get_db),
):
    try:
        from ...services.risk.risk_scheduler import trigger_now
        trigger_now()
        return {"message": "Risk analysis cycle triggered — results will update shortly."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Trigger failed: {exc}")
