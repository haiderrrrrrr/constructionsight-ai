"""
Project ML Config endpoints.

GET  /projects/{project_id}/ml-config
     Get project-specific PPE detection settings

PATCH /projects/{project_id}/ml-config
      Update project-specific PPE detection settings

Auth: Project member (PM or higher)
"""

from __future__ import annotations

from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ...models.user import User
from ...models.project import Project, ProjectStatus
from ...models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
from ...models.project_ml_config import ProjectMLConfig

router = APIRouter(prefix="/projects/{project_id}", tags=["project-ml-config"])


class ProjectMLConfigUpdate(BaseModel):
    alert_cooldown_frames: Optional[int] = None
    violation_frames: Optional[int] = None
    confirm_frames: Optional[int] = None
    incident_dedup_seconds: Optional[int] = None
    lost_frames: Optional[int] = None
    stage1_conf: Optional[float] = None
    stage2_conf: Optional[float] = None
    reid_enabled: Optional[bool] = None


def _get_membership(db: Session, project_id: int, user_id: int) -> ProjectMembership:
    """Verify user is a member of the project."""
    m = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    return m


def _get_or_create_config(db: Session, project_id: int) -> ProjectMLConfig:
    """Get or create project ML config with defaults."""
    config = db.query(ProjectMLConfig).filter(ProjectMLConfig.project_id == project_id).first()
    if not config:
        config = ProjectMLConfig(project_id=project_id)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.get("/ml-config")
def get_project_ml_config(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get project-specific ML config settings."""
    _get_membership(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    config = _get_or_create_config(db, project_id)

    return {
        "project_id": project_id,
        "alert_cooldown_frames": config.alert_cooldown_frames,
        "violation_frames": config.violation_frames,
        "confirm_frames": config.confirm_frames,
        "lost_frames": config.lost_frames,
        "incident_dedup_seconds": config.incident_dedup_seconds,
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "reid_enabled": config.reid_enabled,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
        "updated_by": config.updated_by,
    }


@router.patch("/ml-config")
def patch_project_ml_config(
    project_id: int,
    body: ProjectMLConfigUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update project-specific ML config settings."""
    membership = _get_membership(db, project_id, user.id)
    if membership.project_role == ProjectRole.STAKEHOLDER:
        raise HTTPException(status_code=403, detail="Stakeholders cannot update ML config")

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    config = _get_or_create_config(db, project_id)

    # Apply updates
    updated_fields = []
    for field, value in body.model_dump(exclude_none=True).items():
        if hasattr(config, field):
            setattr(config, field, value)
            updated_fields.append(field)

    if not updated_fields:
        raise HTTPException(status_code=400, detail="No valid fields provided")

    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = user.id

    db.commit()
    db.refresh(config)

    return {
        "project_id": project_id,
        "updated_fields": updated_fields,
        "alert_cooldown_frames": config.alert_cooldown_frames,
        "violation_frames": config.violation_frames,
        "confirm_frames": config.confirm_frames,
        "lost_frames": config.lost_frames,
        "incident_dedup_seconds": config.incident_dedup_seconds,
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "reid_enabled": config.reid_enabled,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.post("/ml-config/reset")
def reset_project_ml_config(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reset project ML config to defaults."""
    _get_membership(db, project_id, user.id)

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    config = _get_or_create_config(db, project_id)

    # Reset to defaults (from scripts/run5.py + MLConfig model)
    config.alert_cooldown_frames = 90
    config.violation_frames = 8
    config.confirm_frames = 5
    config.lost_frames = 30
    config.incident_dedup_seconds = 30
    config.stage1_conf = 0.30
    config.stage2_conf = 0.30
    config.reid_enabled = True
    # Note: Other fields (padding, imgsz_stage1, imgsz_stage2, multipliers, etc.)
    # are only in global MLConfig, not in ProjectMLConfig

    config.updated_at = datetime.now(timezone.utc)
    config.updated_by = user.id

    db.commit()
    db.refresh(config)

    return {
        "project_id": project_id,
        "message": "PPE detection settings reset to defaults",
        "alert_cooldown_frames": config.alert_cooldown_frames,
        "violation_frames": config.violation_frames,
        "incident_dedup_seconds": config.incident_dedup_seconds,
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }
