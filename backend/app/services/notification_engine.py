"""
Notification Engine — creates Notification rows for relevant project members
when a PPE incident is confirmed.

Notification types written:
  'ppe_violation'  — no_helmet or no_vest (targets: safety_officer, site_supervisor, project_manager)
  'ppe_critical'   — both_missing        (targets: safety_officer, site_supervisor, project_manager)

Note: Notifications scoped to project team only (no platform admin push).
Audit trail captured in ppe_incident table for compliance.

Wording standard: ANSI/OSHA-aligned terminology (Missing, Non-Compliance, Alert)
"""

import logging
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def notify(db: Session, project_id: int, camera_id: int, incident) -> None:
    """
    Create Notification rows for active project members whose role should be alerted.
    Called inside the incident queue worker (after incident is flushed to DB).
    Never raises — all errors are logged and swallowed.
    """
    try:
        from ..models.camera import Camera
        from ..models.notification import Notification
        from ..models.project import Project
        from ..models.project_membership import ProjectMembership, ProjectRole, MembershipStatus

        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        cam_name = camera.name if camera else f"Camera #{camera_id}"

        project = db.query(Project).filter(Project.id == project_id).first()
        proj_name = project.name if project else f"Project #{project_id}"

        g_id = incident.global_person_id
        zone_label = incident.zone_name or "N/A"
        person_label = f"G-{g_id}" if g_id is not None else f"T-{incident.track_id}"
        msg = f"Project: {proj_name} | Person {person_label} | Zone: {zone_label}"

        if incident.incident_type == "both_missing":
            target_roles = [
                ProjectRole.SAFETY_OFFICER,
                ProjectRole.SITE_SUPERVISOR,
                ProjectRole.PROJECT_MANAGER,
            ]
            title = f"Critical Alert: Missing Helmet & Vest — {cam_name}"
            ntype = "ppe_critical"
        elif incident.incident_type == "no_helmet":
            target_roles = [ProjectRole.SAFETY_OFFICER, ProjectRole.SITE_SUPERVISOR, ProjectRole.PROJECT_MANAGER]
            title = f"PPE Non-Compliance: Missing Helmet (Vest Detected) — {cam_name}"
            ntype = "ppe_violation"
        elif incident.incident_type == "no_vest":
            target_roles = [ProjectRole.SAFETY_OFFICER, ProjectRole.SITE_SUPERVISOR, ProjectRole.PROJECT_MANAGER]
            title = f"PPE Non-Compliance: Missing Vest (Helmet Detected) — {cam_name}"
            ntype = "ppe_violation"
        else:
            target_roles = [ProjectRole.SAFETY_OFFICER, ProjectRole.SITE_SUPERVISOR, ProjectRole.PROJECT_MANAGER]
            title = f"PPE Non-Compliance Alert — {cam_name}"
            ntype = "ppe_violation"

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
                camera_id  = camera_id,
                project_id = project_id,
            )
            db.add(notif)
            new_notifs.append(notif)

        # Flush to get IDs, then push via SSE broker for real-time delivery
        db.flush()
        try:
            from . import notification_broker as broker
            from datetime import datetime, timezone
            import json
            for notif in new_notifs:
                payload = {
                    "id":         notif.id,
                    "type":       notif.type,
                    "title":      notif.title,
                    "message":    notif.message,
                    "camera_id":  notif.camera_id,
                    "project_id": notif.project_id,
                    "is_read":    False,
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                broker.push(notif.user_id, payload)
        except Exception as broker_err:
            logger.warning(f"[notification_engine] SSE push failed (non-fatal): {broker_err}")

        # Push real-time events to the PPE dashboard SSE stream (project-scoped)
        try:
            from . import ppe_dashboard_broker as dash_broker
            from datetime import datetime, timezone
            from ..api.routes.project_ppe import _get_summary_stats

            now_iso = datetime.now(timezone.utc).isoformat()

            # ppe_live_alert — incident details for the live feed panel
            alert_payload = {
                "type":          "ppe_live_alert",
                "incident_id":   incident.id,
                "camera_name":   cam_name,
                "zone_name":     zone_label,
                "incident_type": incident.incident_type,
                "severity":      incident.severity,
                "person_id":     f"G-{incident.global_person_id}" if incident.global_person_id is not None else f"T-{incident.track_id}",
                "timestamp":     now_iso,
                "snapshot_url":  incident.snapshot_url,
            }
            dash_broker.push(project_id, alert_payload)

            # ppe_stats_update — refreshed summary for the 4 stat cards
            try:
                stats = _get_summary_stats(project_id, db)
                stats_payload = {"type": "ppe_stats_update", **stats}
                dash_broker.push(project_id, stats_payload)
            except Exception as stats_err:
                logger.debug(f"[notification_engine] stats fetch for SSE skipped: {stats_err}")

        except Exception as dash_err:
            logger.warning(f"[notification_engine] dashboard SSE push failed (non-fatal): {dash_err}")

    except Exception as e:
        logger.error(f"[notification_engine] Failed to create notifications: {e}", exc_info=True)
