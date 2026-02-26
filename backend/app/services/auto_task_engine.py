"""
Auto Task Engine — creates ProjectTask rows from PPE incidents following RBAC rules.

Rules:
  no_helmet    → safety_officer + project_manager : "PPE Non-Compliance: Missing Helmet (Vest Detected) — {cam}"
  no_vest      → safety_officer + project_manager : "PPE Non-Compliance: Missing Vest (Helmet Detected) — {cam}"
  both_missing → safety_officer + project_manager : "Critical Alert: Missing Helmet & Vest — {cam}"

Dedup: no new auto-task for same camera + incident_type if an open auto-task
was created for that combination in the last 60 minutes.

Repeat-offender rule: if the same global_person_id has 3+ incidents today on the
same camera → create a task for project_manager (once per hour per camera+person).
"""

import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Mapping: incident_type -> list of roles that get a task
_TASK_RULES: dict = {
    "no_helmet":    ["safety_officer", "project_manager"],
    "no_vest":      ["safety_officer", "project_manager"],
    "both_missing": ["safety_officer", "project_manager"],
}

_TASK_TITLES: dict = {
    "no_helmet":    "PPE Non-Compliance: Missing Helmet (Vest Detected)",
    "no_vest":      "PPE Non-Compliance: Missing Vest (Helmet Detected)",
    "both_missing": "Critical Alert: Missing Helmet & Vest",
}

def _ensure_system_user_id(db: Session) -> int | None:
    try:
        from sqlalchemy.exc import IntegrityError

        from ..core.security import get_password_hash
        from ..models.user import PlatformRole, User

        user = db.query(User).filter(User.username == "system").first()
        if user:
            if not user.is_approved:
                user.is_approved = True
            if user.platform_role != PlatformRole.USER:
                user.platform_role = PlatformRole.USER
            if user.is_active:
                user.is_active = False
            return user.id

        user = db.query(User).filter(User.email == "system@constructionsightai.com").first()
        if user:
            if user.username != "system":
                user.username = "system"
            if not user.is_approved:
                user.is_approved = True
            if user.platform_role != PlatformRole.USER:
                user.platform_role = PlatformRole.USER
            if user.is_active:
                user.is_active = False
            return user.id

        try:
            user = User(
                full_name="System",
                email="system@constructionsightai.com",
                username="system",
                password_hash=get_password_hash("system-user-not-for-login"),
                is_active=False,
                platform_role=PlatformRole.USER,
                is_approved=True,
                can_create_project=False,
            )
            db.add(user)
            db.flush()
            return user.id
        except IntegrityError:
            db.rollback()
            user = db.query(User).filter(User.username == "system").first()
            return user.id if user else None
    except Exception:
        return None


def evaluate(db: Session, project_id: int, camera_id: int, incident) -> None:
    """
    Evaluate incident against RBAC rules and create auto-tasks.
    Called inside incident queue worker. Never raises.
    """
    try:
        from ..models.camera import Camera
        from ..models.project_task import ProjectTask
        from ..models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
        from ..models.ppe_incident import PpeIncident

        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        cam_name = camera.name if camera else f"Camera #{camera_id}"

        incident_type = incident.incident_type
        roles = _TASK_RULES.get(incident_type, [])
        base_title = _TASK_TITLES.get(incident_type, "PPE Violation")
        title = f"{base_title} — {cam_name}"

        cutoff_60m = datetime.now(timezone.utc) - timedelta(minutes=60)
        system_user_id = _ensure_system_user_id(db)

        for role_str in roles:
            # Dedup: open auto-task for same camera + type in last 60 min
            existing = (
                db.query(ProjectTask)
                .filter(
                    ProjectTask.project_id == project_id,
                    ProjectTask.auto_generated == True,  # noqa: E712
                    ProjectTask.assigned_role == role_str,
                    ProjectTask.is_done == False,  # noqa: E712
                    ProjectTask.created_at >= cutoff_60m,
                )
                .join(PpeIncident, PpeIncident.id == ProjectTask.source_incident_id, isouter=True)
                .filter(PpeIncident.camera_id == camera_id, PpeIncident.incident_type == incident_type)
                .first()
            )
            if existing:
                continue

            task = ProjectTask(
                project_id         = project_id,
                title              = title,
                description        = (
                    f"Auto-generated alert: {incident_type.replace('_', ' ')} detected. "
                    f"Camera: {cam_name}. Zone: {incident.zone_name or 'N/A'}. "
                    f"Person {'G-' + str(incident.global_person_id) if incident.global_person_id is not None else 'T-' + str(incident.track_id)}."
                ),
                created_by         = system_user_id,
                auto_generated     = True,
                source_incident_id = incident.id,
                assigned_role      = role_str,
            )
            db.add(task)

        # ── Repeat-offender rule ─────────────────────────────────────────────
        global_id = incident.global_person_id
        if global_id is not None:
            today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            repeat_count = (
                db.query(PpeIncident)
                .filter(
                    PpeIncident.camera_id == camera_id,
                    PpeIncident.global_person_id == global_id,
                    PpeIncident.started_at >= today_start,
                )
                .count()
            )
            if repeat_count >= 3:
                # Only create repeat-offender task if none in last 60 min for this person+camera
                repeat_existing = (
                    db.query(ProjectTask)
                    .filter(
                        ProjectTask.project_id == project_id,
                        ProjectTask.auto_generated == True,  # noqa: E712
                        ProjectTask.assigned_role == "project_manager",
                        ProjectTask.title.like(f"%Repeat PPE offender G-{global_id}%"),
                        ProjectTask.created_at >= cutoff_60m,
                    )
                    .first()
                )
                if not repeat_existing:
                    db.add(ProjectTask(
                        project_id         = project_id,
                        title              = f"Repeat PPE offender G-{global_id} on {cam_name}",
                        description        = (
                            f"Person G-{global_id} has triggered {repeat_count} PPE violations today "
                            f"on {cam_name}. Immediate intervention required."
                        ),
                        created_by         = system_user_id,
                        auto_generated     = True,
                        source_incident_id = incident.id,
                        assigned_role      = "project_manager",
                    ))

    except Exception as e:
        logger.error(f"[auto_task_engine] Failed to create tasks: {e}", exc_info=True)
