"""
Risk Notification Engine — creates Notification rows for PM, Site Supervisor,
and Safety Officer when a HIGH or CRITICAL risk event is generated.
Mirrors notification_engine.py pattern exactly.
Never raises — all errors logged and swallowed.
"""
import logging
from datetime import datetime, timezone
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def notify_risk_event(db: Session, project_id: int, risk_event, camera_name: str = None) -> None:
    try:
        from ...models.notification import Notification
        from ...models.project import Project
        from ...models.project_membership import MembershipStatus, ProjectMembership, ProjectRole

        if risk_event.severity not in ("high", "critical"):
            return

        project = db.query(Project).filter(Project.id == project_id).first()
        proj_name = project.name if project else f"Project #{project_id}"

        zone_label = risk_event.zone_name or "Unknown Zone"
        is_compound = risk_event.event_type == "compound_risk"
        is_critical = risk_event.severity == "critical"

        if is_compound:
            title = f"⚡ Compound Risk — Zone {zone_label}"
            ntype = "risk_critical"
        elif is_critical:
            title = f"Critical Risk Alert — Zone {zone_label}"
            ntype = "risk_critical"
        else:
            title = f"Risk Alert — Zone {zone_label}"
            ntype = "risk_alert"

        cam_label = camera_name or "N/A"
        msg = (
            f"Project: {proj_name} | Zone: {zone_label} | Camera: {cam_label} | "
            f"Score: {risk_event.risk_score:.0f}/100"
        )

        target_roles = [
            ProjectRole.PROJECT_MANAGER,
            ProjectRole.SITE_SUPERVISOR,
            ProjectRole.SAFETY_OFFICER,
        ]
        memberships = (
            db.query(ProjectMembership)
            .filter(
                ProjectMembership.project_id == project_id,
                ProjectMembership.project_role.in_(target_roles),
                ProjectMembership.status == MembershipStatus.ACTIVE,
            )
            .all()
        )

        new_notifs = []
        for m in memberships:
            notif = Notification(
                user_id    = m.user_id,
                type       = ntype,
                title      = title,
                message    = msg,
                project_id = project_id,
                category   = "risk",
                priority   = risk_event.severity,
                action_url = f"/projects/{project_id}/risk",
            )
            db.add(notif)
            new_notifs.append(notif)

        db.flush()

        try:
            from .. import notification_broker as broker
            for notif in new_notifs:
                payload = {
                    "id":         notif.id,
                    "type":       notif.type,
                    "title":      notif.title,
                    "message":    notif.message,
                    "project_id": notif.project_id,
                    "is_read":    False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                broker.push(notif.user_id, payload)
        except Exception as broker_err:
            logger.warning(f"[risk_notification] SSE push failed (non-fatal): {broker_err}")

    except Exception as exc:
        logger.error(f"[risk_notification] notify_risk_event failed: {exc}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
