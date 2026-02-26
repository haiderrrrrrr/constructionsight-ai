"""
Risk Auto Task Engine — creates ProjectTask rows for PM, Site Supervisor, and Safety Officer
when a HIGH or CRITICAL risk event is generated. Mirrors auto_task_engine.py pattern.
Dedup: 60-minute window per zone per event_type.
Never raises — all errors logged and swallowed.
"""
import logging
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

_RISK_TASK_RULES: dict[str, dict[str, str]] = {
    "risk_escalated": {
        "safety_officer":  "Investigate Risk Escalation — Zone {zone}",
        "site_supervisor": "Address Risk Conditions — Zone {zone}",
        "project_manager": "Risk Alert: Review Zone {zone} Status",
    },
    "compound_risk": {
        "safety_officer":  "URGENT: Compound Risk Active — Zone {zone} — Multiple Failures",
        "site_supervisor": "URGENT: Compound Risk — Immediate Action in Zone {zone}",
        "project_manager": "Compound Risk Alert — Zone {zone} requires immediate attention",
    },
    "prediction_alert": {
        "safety_officer":  "Predicted CRITICAL Risk in Zone {zone} within 15 min",
        "site_supervisor": "Pre-emptive Alert: Zone {zone} approaching critical threshold",
        "project_manager": "Risk Prediction Alert — Zone {zone}",
    },
    "weather_impact": {
        "safety_officer":  "Weather Hazard Alert — Zone {zone}",
        "site_supervisor": "Weather Conditions Affecting Zone {zone} — Review Safety",
        "project_manager": "Weather Impact on Zone {zone}",
    },
}


def _ensure_system_user_id(db: Session) -> int | None:
    try:
        from ...core.security import get_password_hash
        from ...models.user import PlatformRole, User

        user = db.query(User).filter(User.username == "system").first()
        if user:
            return user.id
        user = db.query(User).filter(User.email == "system@constructionsightai.com").first()
        if user:
            return user.id
        return None
    except Exception as exc:
        logger.warning(f"[risk_auto_task] _ensure_system_user_id failed: {exc}")
        return None


def evaluate_risk_tasks(
    db: Session,
    project_id: int,
    risk_event,
    risk_snapshot,
    camera_name: str = None,
) -> None:
    try:
        from ...models.project_task import ProjectTask

        if risk_event.severity not in ("high", "critical"):
            return

        zone_name = risk_event.zone_name or "Unknown"
        now_tz    = datetime.now(timezone.utc)

        # Dedup: no new task for same zone+event_type in last 60 minutes
        recent = (
            db.query(ProjectTask)
            .filter(
                ProjectTask.project_id == project_id,
                ProjectTask.auto_generated == True,       # noqa: E712
                ProjectTask.title.contains(zone_name),
                ProjectTask.created_at > now_tz - timedelta(minutes=60),
            )
            .first()
        )
        if recent:
            return

        rule_key = risk_event.event_type
        if rule_key not in _RISK_TASK_RULES:
            rule_key = "risk_escalated"

        roles_titles = _RISK_TASK_RULES[rule_key]
        system_uid   = _ensure_system_user_id(db)

        cam_label   = camera_name or "N/A"
        weather_str = risk_snapshot.weather_condition or "N/A"
        desc = (
            f"Auto-generated risk alert: {risk_event.message}. "
            f"Camera: {cam_label}. Zone: {zone_name}. "
            f"Risk Score: {risk_snapshot.overall_risk:.0f}/100 "
            f"(Delay: {risk_snapshot.delay_risk:.0f}, "
            f"Safety: {risk_snapshot.safety_risk:.0f}, "
            f"Productivity: {risk_snapshot.productivity_risk:.0f}). "
            f"Trend: {risk_snapshot.trend}. "
            f"{'⚡ COMPOUND RISK ACTIVE. ' if risk_snapshot.compound_risk_flag else ''}"
            f"Weather: {weather_str}."
        )

        for role, title_tpl in roles_titles.items():
            task = ProjectTask(
                project_id     = project_id,
                title          = title_tpl.format(zone=zone_name),
                description    = desc,
                auto_generated = True,
                assigned_role  = role,
                created_by     = system_uid,
                is_done        = False,
            )
            db.add(task)

        db.flush()

        # Push to project task broker so task list updates in real-time
        try:
            from .. import project_task_broker as task_broker
            task_broker.push(project_id, {"type": "risk_task_created", "project_id": project_id})
        except Exception as broker_err:
            logger.debug(f"[risk_auto_task] task broker push failed (non-fatal): {broker_err}")

    except Exception as exc:
        logger.error(f"[risk_auto_task] evaluate_risk_tasks failed: {exc}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
