"""
BIM (3D Model) endpoints for the project workspace.

Prefix: /projects/{project_id}/bim
Auth:   get_current_user + membership check
        Write endpoints additionally require project_manager role.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, log_event
from ...models.user import User

router = APIRouter(prefix="/projects/{project_id}/bim", tags=["bim"])

MAX_GLB_BYTES = 150 * 1024 * 1024  # 150 MB


# ── helpers ──────────────────────────────────────────────────────────────────

def _require_member(project_id: int, user: User, db: Session):
    from ...models.project_membership import ProjectMembership, MembershipStatus
    from ...models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == user.id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        .first()
    )
    if not membership and project.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    return membership


def _require_pm(project_id: int, user: User, db: Session):
    from ...models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if project.created_by == user.id or user.platform_role.value == "admin":
        return

    from ...models.project_membership import ProjectMembership, MembershipStatus
    membership = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == user.id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="Access denied")
    if membership.project_role.value not in ("project_manager",):
        raise HTTPException(status_code=403, detail="Project manager role required")


def _get_or_create_config(project_id: int, db: Session):
    from ...models.project_bim import ProjectBimConfig

    config = db.query(ProjectBimConfig).filter(ProjectBimConfig.project_id == project_id).first()
    if not config:
        config = ProjectBimConfig(project_id=project_id, bim_enabled=True, overlay_enabled=False)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


# ── schemas ───────────────────────────────────────────────────────────────────

class BimConfigResponse(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    id: int
    project_id: int
    model_url: Optional[str]
    model_filename: Optional[str]
    model_size_bytes: Optional[int]
    model_uploaded_at: Optional[datetime]


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/config", response_model=BimConfigResponse)
def get_bim_config(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_member(project_id, user, db)
    config = _get_or_create_config(project_id, db)
    return config


@router.post("/model", response_model=BimConfigResponse)
async def upload_bim_model(
    project_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_pm(project_id, user, db)

    if not file.filename or not file.filename.lower().endswith((".glb", ".gltf")):
        raise HTTPException(status_code=400, detail="Only .glb or .gltf files are accepted")

    contents = await file.read()
    if len(contents) > MAX_GLB_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 150 MB limit")

    from ...services.bim_storage import save_glb, delete_glb

    config = _get_or_create_config(project_id, db)

    if config.model_url:
        delete_glb(config.model_url)

    result = await save_glb(contents, project_id)

    config.model_url = result["model_url"]
    config.model_filename = file.filename
    config.model_size_bytes = result["size_bytes"]
    config.model_uploaded_at = datetime.now(timezone.utc)
    config.uploaded_by = user.id
    config.updated_at = datetime.now(timezone.utc)

    log_event(db, "bim_model_uploaded", user.id, {
        "project_id": project_id,
        "filename": file.filename,
        "size_bytes": result["size_bytes"],
    })
    db.commit()
    db.refresh(config)
    return config


@router.delete("/model", response_model=BimConfigResponse)
def delete_bim_model(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_pm(project_id, user, db)

    from ...services.bim_storage import delete_glb

    config = _get_or_create_config(project_id, db)
    if config.model_url:
        delete_glb(config.model_url)

    config.model_url = None
    config.model_filename = None
    config.model_size_bytes = None
    config.model_uploaded_at = None
    config.uploaded_by = None
    config.updated_at = datetime.now(timezone.utc)

    log_event(db, "bim_model_deleted", user.id, {"project_id": project_id})
    db.commit()
    db.refresh(config)
    return config
