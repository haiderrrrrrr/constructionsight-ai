from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from ...models.note import Note
from ...models.project import Project, ProjectStatus
from ...models.project_membership import ProjectMembership, MembershipStatus
from ...models.user import User, PlatformRole
from ...schemas.note import NoteCreate, NoteUpdate, NoteOut
from ..deps import get_db, get_current_user, log_event

router = APIRouter(prefix="/projects/{project_id}/notes", tags=["notes"])


def _require_access(db: Session, project_id: int, user: User) -> None:
    """Admins always have access. Members need an active membership."""
    if user.platform_role == PlatformRole.ADMIN:
        return
    m = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user.id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this project")


def _require_active_project(db: Session, project_id: int) -> Project:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Notes cannot be modified on archived projects")
    return project


@router.get("", response_model=List[NoteOut])
def list_notes(
    project_id: int,
    limit: int = Query(default=12, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_access(db, project_id, user)
    notes = (
        db.query(Note)
        .filter(Note.project_id == project_id, Note.user_id == user.id)
        .order_by(Note.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return notes


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    project_id: int,
    body: NoteCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_access(db, project_id, user)
    _require_active_project(db, project_id)

    note = Note(
        project_id=project_id,
        user_id=user.id,
        title=body.title,
        content=body.content,
        category=body.category,
    )
    db.add(note)
    db.flush()
    log_event(
        db,
        "note_created",
        user.id,
        {"project_id": project_id, "note_id": note.id, "title": body.title},
        request=request,
        target_type="note",
        target_id=note.id,
    )
    db.commit()
    db.refresh(note)
    return note


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(
    project_id: int,
    note_id: int,
    body: NoteUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_access(db, project_id, user)
    _require_active_project(db, project_id)

    note = db.query(Note).filter(
        Note.id == note_id,
        Note.project_id == project_id,
        Note.user_id == user.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if body.title is not None:
        note.title = body.title
    if body.content is not None:
        note.content = body.content
    if body.category is not None:
        note.category = body.category
    if body.is_favourite is not None:
        note.is_favourite = body.is_favourite
    note.updated_at = datetime.now(timezone.utc)

    log_event(
        db,
        "note_updated",
        user.id,
        {"project_id": project_id, "note_id": note_id},
        request=request,
        target_type="note",
        target_id=note_id,
    )
    db.commit()
    db.refresh(note)
    return note


@router.delete("/{note_id}", status_code=204)
def delete_note(
    project_id: int,
    note_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _require_access(db, project_id, user)
    _require_active_project(db, project_id)

    note = db.query(Note).filter(
        Note.id == note_id,
        Note.project_id == project_id,
        Note.user_id == user.id,
    ).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    log_event(
        db,
        "note_deleted",
        user.id,
        {"project_id": project_id, "note_id": note_id, "title": note.title},
        request=request,
        target_type="note",
        target_id=note_id,
    )
    db.delete(note)
    db.commit()
