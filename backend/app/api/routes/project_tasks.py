from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ...models.project import Project, ProjectStatus
from ...models.project_membership import ProjectMembership, MembershipStatus, ProjectRole
from ...models.project_task import ProjectTask
from ...models.user import User
from ...schemas.project_task import TaskCreate, TaskOut, TaskToggle
from ..deps import get_db, get_current_user, log_event

router = APIRouter(prefix="/projects/{project_id}/tasks", tags=["project-tasks"])


_CAN_CREATE_TOGGLE = {ProjectRole.PROJECT_MANAGER, ProjectRole.SITE_SUPERVISOR, ProjectRole.SAFETY_OFFICER}
_PM_ONLY = {ProjectRole.PROJECT_MANAGER}


def _get_membership(db: Session, project_id: int, user_id: int) -> ProjectMembership:
    m = db.query(ProjectMembership).filter(
        ProjectMembership.project_id == project_id,
        ProjectMembership.user_id == user_id,
        ProjectMembership.status == MembershipStatus.ACTIVE,
    ).first()
    if not m:
        raise HTTPException(status_code=403, detail="Not a member of this project")
    return m


def _require_active_project(db: Session, project_id: int) -> Project:
    """Return project only if ACTIVE. Raises 404/400 otherwise."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status != ProjectStatus.ACTIVE:
        raise HTTPException(status_code=400, detail="Tasks can only be modified on active projects")
    return project


def _build_creator_map(db: Session, tasks: list) -> Dict[int, str]:
    """Batch-fetch creator names for a list of tasks — avoids N+1 queries."""
    creator_ids = {t.created_by for t in tasks if t.created_by}
    if not creator_ids:
        return {}
    users = db.query(User).filter(User.id.in_(creator_ids)).all()
    return {u.id: u.full_name for u in users}


def _task_to_out(task: ProjectTask, creator_map: Dict[int, str]) -> TaskOut:
    return TaskOut(
        id=task.id,
        project_id=task.project_id,
        title=task.title,
        description=task.description or '',
        is_done=task.is_done,
        created_by=task.created_by,
        created_by_name=creator_map.get(task.created_by) if task.created_by else None,
        created_at=task.created_at,
        done_at=task.done_at,
    )


@router.get("", response_model=List[TaskOut])
def list_tasks(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _get_membership(db, project_id, user.id)
    tasks = db.query(ProjectTask).filter(
        ProjectTask.project_id == project_id
    ).order_by(ProjectTask.created_at.asc()).all()
    creator_map = _build_creator_map(db, tasks)
    return [_task_to_out(t, creator_map) for t in tasks]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(
    project_id: int,
    body: TaskCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = _get_membership(db, project_id, user.id)
    if m.project_role not in _CAN_CREATE_TOGGLE:
        raise HTTPException(status_code=403, detail="Your role cannot create tasks")
    _require_active_project(db, project_id)

    task = ProjectTask(
        project_id=project_id,
        title=body.title,
        description=body.description,
        created_by=user.id,
    )
    db.add(task)
    db.flush()
    log_event(
        db,
        "task_created",
        user.id,
        {"project_id": project_id, "task_id": task.id, "title": body.title},
        request=request,
        target_type="task",
        target_id=task.id,
    )
    db.commit()
    db.refresh(task)

    # Notify all project members except the creator
    from ...services.notification_service import notify_project_members
    notify_project_members(
        db, project_id,
        type="task_created",
        title=f"New Task: {task.title}",
        message=f"A new task has been added to the project.",
        category="task",
        priority="low",
        action_url=f"/projects/{project_id}/tasks",
        exclude_user_id=user.id,
        task_id=task.id,
    )
    db.commit()

    creator_map = _build_creator_map(db, [task])
    return _task_to_out(task, creator_map)


@router.get("/stream")
async def task_stream(
    project_id: int,
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    SSE stream — pushes task_refresh events when tasks are created, toggled, or
    deleted (including auto-generated tasks from incident detection).
    Auth via ?token= query param because EventSource cannot send Authorization headers.
    Heartbeat comment every 25s keeps the connection alive through proxies.
    """
    import asyncio as _asyncio
    import json as _json
    from fastapi.responses import StreamingResponse
    from ...core.security import decode_access_token
    from ...services.project_task_broker import register as _reg, unregister as _unreg

    if not token:
        raise HTTPException(status_code=401, detail="token query param required")

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

    _get_membership(db, project_id, user_id)
    db.close()  # release DB connection before long-lived stream

    q = _reg(project_id)

    async def event_generator():
        try:
            while True:
                try:
                    evt = await _asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {_json.dumps(evt)}\n\n"
                except _asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            _unreg(project_id, q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.patch("/{task_id}/toggle", response_model=TaskOut)
def toggle_task(
    project_id: int,
    task_id: int,
    body: TaskToggle,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = _get_membership(db, project_id, user.id)
    if m.project_role not in _CAN_CREATE_TOGGLE:
        raise HTTPException(status_code=403, detail="Your role cannot update task status")
    _require_active_project(db, project_id)

    task = db.query(ProjectTask).filter(
        ProjectTask.id == task_id,
        ProjectTask.project_id == project_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.is_done = body.is_done
    task.done_at = datetime.now(timezone.utc) if body.is_done else None
    log_event(
        db,
        "task_toggled",
        user.id,
        {"project_id": project_id, "task_id": task_id, "is_done": body.is_done},
        request=request,
        target_type="task",
        target_id=task_id,
    )
    db.commit()
    db.refresh(task)

    if body.is_done:
        # Notify project members that task was completed
        from ...services.notification_service import notify_project_members
        notify_project_members(
            db, project_id,
            type="task_completed",
            title=f"Task Completed: {task.title}",
            message=f"A task has been marked as complete.",
            category="task",
            priority="medium",
            action_url=f"/projects/{project_id}/tasks",
            exclude_user_id=user.id,
            task_id=task.id,
        )
        db.commit()

    creator_map = _build_creator_map(db, [task])
    return _task_to_out(task, creator_map)


@router.patch("/{task_id}", response_model=TaskOut)
def update_task(
    project_id: int,
    task_id: int,
    body: TaskCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = _get_membership(db, project_id, user.id)
    if m.project_role not in _PM_ONLY:
        raise HTTPException(status_code=403, detail="Only Project Managers can edit tasks")
    _require_active_project(db, project_id)

    task = db.query(ProjectTask).filter(
        ProjectTask.id == task_id,
        ProjectTask.project_id == project_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.title = body.title
    task.description = body.description
    log_event(
        db,
        "task_updated",
        user.id,
        {"project_id": project_id, "task_id": task_id, "title": body.title},
        request=request,
        target_type="task",
        target_id=task_id,
    )
    db.commit()
    db.refresh(task)
    creator_map = _build_creator_map(db, [task])
    return _task_to_out(task, creator_map)


@router.delete("/{task_id}", status_code=204)
def delete_task(
    project_id: int,
    task_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    m = _get_membership(db, project_id, user.id)
    if m.project_role not in _PM_ONLY:
        raise HTTPException(status_code=403, detail="Only Project Managers can delete tasks")
    _require_active_project(db, project_id)

    task = db.query(ProjectTask).filter(
        ProjectTask.id == task_id,
        ProjectTask.project_id == project_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    log_event(
        db,
        "task_deleted",
        user.id,
        {"project_id": project_id, "task_id": task_id, "title": task.title},
        request=request,
        target_type="task",
        target_id=task_id,
    )
    db.delete(task)
    db.commit()
