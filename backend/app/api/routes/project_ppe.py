"""
PPE Detection REST endpoints for the project workspace dashboard.

Prefix: /projects/{project_id}/ppe
Auth:   get_current_user + membership check (any active member may read)
        PATCH /incidents/{id}/status also requires membership.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, log_event
from ...models.user import User

router = APIRouter(prefix="/projects/{project_id}/ppe", tags=["ppe"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _require_member(project_id: int, user: User, db: Session) -> None:
    """Raise 403 if user is not an active member (or creator) of the project."""
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


def _parse_date_range(date_from: Optional[str], date_to: Optional[str]):
    """Parse date_from / date_to strings into datetimes. Defaults to today."""
    now = datetime.now(timezone.utc)
    dt_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    dt_to   = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")

    return dt_from, dt_to


# ── schemas ───────────────────────────────────────────────────────────────────

class StatusPatch(BaseModel):
    status: str  # "acknowledged" | "resolved"


class PpeEventsEnabledPatch(BaseModel):
    enabled: bool


# ── summary stats helper (reused by endpoint + SSE push) ─────────────────────

def _get_summary_stats(
    project_id: int,
    db: Session,
    dt_from: datetime = None,
    dt_to: datetime   = None,
) -> dict:
    """Compute PPE summary stats for a date range. No auth check — callers must verify access."""
    from ...models.ppe_incident import PpeIncident
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    now = datetime.now(timezone.utc)
    if dt_from is None:
        dt_from = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if dt_to is None:
        dt_to = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    def _range_filter(q):
        return q.filter(
            PpeIncident.project_id == project_id,
            PpeIncident.started_at >= dt_from,
            PpeIncident.started_at <= dt_to,
        )

    violations_total = (
        _range_filter(db.query(func.count(PpeIncident.id)))
        .scalar() or 0
    )

    workers_detected = (
        _range_filter(
            db.query(func.count(func.distinct(
                func.coalesce(PpeIncident.global_person_id, PpeIncident.track_id)
            )))
        ).scalar() or 0
    )

    project_camera_ids_sub = (
        select(ProjectCamera.camera_id)
        .filter(ProjectCamera.project_id == project_id)
    )
    cameras_with_violations = (
        _range_filter(
            db.query(func.count(func.distinct(PpeIncident.camera_id)))
        ).scalar() or 0
    )
    cameras_total_for_compliance = (
        db.query(func.count(Camera.id))
        .filter(Camera.id.in_(project_camera_ids_sub))
        .scalar() or 0
    )
    if cameras_total_for_compliance > 0:
        compliance_rate = round(
            (cameras_total_for_compliance - cameras_with_violations)
            / cameras_total_for_compliance * 100, 1
        )
        compliance_rate = max(0.0, min(100.0, compliance_rate))
    else:
        compliance_rate = 100.0

    # open_incidents: all currently open (not range-filtered — they're a live count)
    open_incidents = (
        db.query(func.count(PpeIncident.id))
        .filter(
            PpeIncident.project_id == project_id,
            PpeIncident.status == "open",
        )
        .scalar() or 0
    )

    # open_incidents_in_range: open incidents that started within the selected date range
    open_incidents_in_range = (
        _range_filter(db.query(func.count(PpeIncident.id)))
        .filter(PpeIncident.status == "open")
        .scalar() or 0
    )

    cameras_total = (
        db.query(func.count(Camera.id))
        .filter(Camera.id.in_(project_camera_ids_sub))
        .scalar() or 0
    )
    cameras_online = (
        db.query(func.count(Camera.id))
        .filter(
            Camera.id.in_(project_camera_ids_sub),
            Camera.worker_status == "running",
        )
        .scalar() or 0
    )

    # Violation type breakdown
    type_rows = (
        _range_filter(
            db.query(
                PpeIncident.incident_type,
                func.count(PpeIncident.id).label("cnt"),
            )
        )
        .group_by(PpeIncident.incident_type)
        .all()
    )
    type_map = {r.incident_type: r.cnt for r in type_rows}

    resolved_in_range = (
        _range_filter(db.query(func.count(PpeIncident.id)))
        .filter(PpeIncident.status == "resolved")
        .scalar() or 0
    )

    acknowledged_in_range = (
        _range_filter(db.query(func.count(PpeIncident.id)))
        .filter(PpeIncident.status == "acknowledged")
        .scalar() or 0
    )

    return {
        "compliance_rate_today":  compliance_rate,
        "violations_today":       violations_total,
        "workers_detected_today": workers_detected,
        "open_incidents":          open_incidents,
        "open_incidents_in_range": open_incidents_in_range,
        "resolved_today":          resolved_in_range,
        "acknowledged_in_range":  acknowledged_in_range,
        "cameras_online":         cameras_online,
        "cameras_total":          cameras_total,
        "no_helmet_today":        type_map.get("no_helmet", 0),
        "no_vest_today":          type_map.get("no_vest", 0),
        "both_missing_today":     type_map.get("both_missing", 0),
    }


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_ppe_summary(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Returns high-level PPE compliance stats for the given date range (defaults to today)."""
    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)
    return _get_summary_stats(project_id, db, dt_from, dt_to)


@router.get("/incidents")
def list_incidents(
    project_id: int,
    camera_id: Optional[int] = Query(None),
    incident_type: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    severity: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Paginated incident list with optional filters."""
    from ...models.ppe_incident import PpeIncident

    _require_member(project_id, user, db)

    q = db.query(PpeIncident).filter(PpeIncident.project_id == project_id)

    if camera_id is not None:
        q = q.filter(PpeIncident.camera_id == camera_id)
    if incident_type:
        q = q.filter(PpeIncident.incident_type == incident_type)
    if status:
        statuses = [s.strip() for s in status.split(',') if s.strip()]
        if len(statuses) == 1:
            q = q.filter(PpeIncident.status == statuses[0])
        elif statuses:
            q = q.filter(PpeIncident.status.in_(statuses))
    if severity:
        q = q.filter(PpeIncident.severity == severity)
    if date_from:
        try:
            dt_from = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            q = q.filter(PpeIncident.started_at >= dt_from)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from format")
    if date_to:
        try:
            dt_to = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            q = q.filter(PpeIncident.started_at <= dt_to)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to format")

    total = q.count()
    items = (
        q.order_by(PpeIncident.started_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    from ...models.camera import Camera
    cam_ids = {inc.camera_id for inc in items if inc.camera_id}
    cam_name_map = {}
    if cam_ids:
        cams = db.query(Camera.id, Camera.name).filter(Camera.id.in_(cam_ids)).all()
        cam_name_map = {c.id: c.name for c in cams}

    return {
        "total": total,
        "page": page,
        "per_page": per_page,
        "items": [
            {
                "id":               inc.id,
                "camera_id":        inc.camera_id,
                "camera_name":      cam_name_map.get(inc.camera_id) if inc.camera_id else None,
                "zone_id":          inc.zone_id,
                "zone_name":        inc.zone_name,
                "track_id":         inc.track_id,
                "global_person_id": inc.global_person_id,
                "incident_type":    inc.incident_type,
                "has_helmet":       getattr(inc, "has_helmet", None),
                "has_vest":         getattr(inc, "has_vest", None),
                "severity":         inc.severity,
                "status":           inc.status,
                "started_at":       inc.started_at.isoformat() if inc.started_at else None,
                "ended_at":         inc.ended_at.isoformat() if inc.ended_at else None,
                "snapshot_url":     inc.snapshot_url,
                "video_clip_url":   inc.video_clip_url,
                "frame_confidence": inc.frame_confidence,
            }
            for inc in items
        ],
    }


@router.get("/trend")
def get_violation_trend(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Violations grouped by hour (≤48 h range) or day (wider).
    Returns list of {hour: ISO string, count: int}.
    """
    from ...models.ppe_incident import PpeIncident

    _require_member(project_id, user, db)

    dt_from, dt_to = _parse_date_range(date_from, date_to)
    span_hours = (dt_to - dt_from).total_seconds() / 3600
    trunc_unit = "hour" if span_hours <= 48 else "day"

    rows = (
        db.query(
            func.date_trunc(trunc_unit, PpeIncident.started_at).label("hour"),
            func.count(PpeIncident.id).label("count"),
        )
        .filter(
            PpeIncident.project_id == project_id,
            PpeIncident.started_at >= dt_from,
            PpeIncident.started_at <= dt_to,
        )
        .group_by(func.date_trunc(trunc_unit, PpeIncident.started_at))
        .order_by(func.date_trunc(trunc_unit, PpeIncident.started_at))
        .all()
    )

    return [
        {"hour": row.hour.isoformat() if row.hour else None, "count": row.count}
        for row in rows
    ]


@router.get("/cameras")
def get_camera_breakdown(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-camera violation summary for the given date range (defaults to today)."""
    from ...models.ppe_incident import PpeIncident
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    _require_member(project_id, user, db)

    dt_from, dt_to = _parse_date_range(date_from, date_to)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    cameras = db.query(Camera).filter(Camera.id.in_(camera_ids)).all()
    camera_map = {c.id: c for c in cameras}

    rows = (
        db.query(
            PpeIncident.camera_id,
            func.count(PpeIncident.id).label("violations_today"),
            func.count(func.distinct(PpeIncident.track_id)).label("workers_today"),
        )
        .filter(
            PpeIncident.project_id == project_id,
            PpeIncident.started_at >= dt_from,
            PpeIncident.started_at <= dt_to,
        )
        .group_by(PpeIncident.camera_id)
        .all()
    )
    stats_map = {r.camera_id: r for r in rows}

    result = []
    for cam_id in camera_ids:
        cam = camera_map.get(cam_id)
        stats = stats_map.get(cam_id)
        violations = stats.violations_today if stats else 0
        workers    = stats.workers_today    if stats else 0
        compliance = round((workers - violations) / workers * 100, 1) if workers > 0 else 100.0
        compliance = max(0.0, min(100.0, compliance))
        result.append({
            "camera_id":         cam_id,
            "camera_name":       cam.name if cam else f"Camera #{cam_id}",
            "violations_today":  violations,
            "compliance_rate":   compliance,
            "worker_status":     getattr(cam, "worker_status", None),
            "last_inference_at": (
                cam.last_inference_at.isoformat()
                if cam and getattr(cam, "last_inference_at", None) else None
            ),
        })

    return result


@router.get("/analytics")
def get_ppe_analytics(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Extended analytics for the dashboard:
      - severity_distribution: {high, medium, low} counts
      - peak_hour: hour-of-day (0-23) with most violations + its count
      - avg_resolution_minutes: average minutes from started_at to ended_at for resolved incidents
    """
    from ...models.ppe_incident import PpeIncident

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)

    def _base(q):
        return q.filter(
            PpeIncident.project_id == project_id,
            PpeIncident.started_at >= dt_from,
            PpeIncident.started_at <= dt_to,
        )

    # Severity distribution
    sev_rows = (
        _base(
            db.query(PpeIncident.severity, func.count(PpeIncident.id).label("cnt"))
        )
        .group_by(PpeIncident.severity)
        .all()
    )
    sev_map = {r.severity: r.cnt for r in sev_rows}
    severity_distribution = {
        "high":   sev_map.get("high",   0),
        "medium": sev_map.get("medium", 0),
        "low":    sev_map.get("low",    0),
    }

    # Peak hour of day (0-23) across the range
    hour_rows = (
        _base(
            db.query(
                func.extract("hour", PpeIncident.started_at).label("hr"),
                func.count(PpeIncident.id).label("cnt"),
            )
        )
        .group_by(func.extract("hour", PpeIncident.started_at))
        .order_by(func.count(PpeIncident.id).desc())
        .all()
    )

    all_hours = {int(r.hr): r.cnt for r in hour_rows}
    if all_hours:
        peak_hr    = max(all_hours, key=all_hours.get)
        peak_count = all_hours[peak_hr]
    else:
        peak_hr    = None
        peak_count = 0

    # Hourly distribution array (24 slots)
    hourly_distribution = [all_hours.get(h, 0) for h in range(24)]

    # Average resolution time (minutes) for resolved incidents with ended_at set
    resolved_rows = (
        _base(
            db.query(PpeIncident.started_at, PpeIncident.ended_at)
        )
        .filter(
            PpeIncident.status == "resolved",
            PpeIncident.ended_at.isnot(None),
        )
        .all()
    )

    if resolved_rows:
        deltas = []
        for r in resolved_rows:
            started = r.started_at
            ended   = r.ended_at
            if started and ended:
                # ensure both tz-aware
                if started.tzinfo is None:
                    started = started.replace(tzinfo=timezone.utc)
                if ended.tzinfo is None:
                    ended = ended.replace(tzinfo=timezone.utc)
                delta_min = (ended - started).total_seconds() / 60
                if delta_min >= 0:
                    deltas.append(delta_min)
        avg_resolution_minutes = round(sum(deltas) / len(deltas), 1) if deltas else None
        resolved_count = len(deltas)
    else:
        avg_resolution_minutes = None
        resolved_count = 0

    # Calculate Daily Safety Score (0-10 scale)
    # Formula: Resolution Rate × 10 + Violation Penalty
    # Get incident counts
    total_violations = _base(db.query(func.count(PpeIncident.id))).scalar() or 0

    resolved_incidents = (
        _base(db.query(func.count(PpeIncident.id)))
        .filter(PpeIncident.status == "resolved")
        .scalar() or 0
    )
    open_incidents = (
        _base(db.query(func.count(PpeIncident.id)))
        .filter(PpeIncident.status == "open")
        .scalar() or 0
    )

    # Resolution rate: resolved / total (if any incidents)
    if total_violations > 0:
        resolution_rate = (resolved_incidents / total_violations) * 10
        # Penalty for open incidents: max 4 points deducted
        open_penalty = min((open_incidents / total_violations) * 4, 4)
        safety_score = round(resolution_rate - open_penalty, 1)
    else:
        # No incidents = perfect score
        safety_score = 10.0

    safety_score = min(10, max(0, safety_score))  # Clamp to 0-10

    return {
        "severity_distribution":  severity_distribution,
        "peak_hour":               peak_hr,
        "peak_hour_count":         peak_count,
        "hourly_distribution":     hourly_distribution,
        "avg_resolution_minutes":  avg_resolution_minutes,
        "resolved_with_time":      resolved_count,
        "daily_safety_score":      safety_score,
    }


@router.patch("/incidents/{incident_id}/status")
def patch_incident_status(
    project_id: int,
    incident_id: int,
    body: StatusPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Acknowledge or resolve a PPE incident."""
    from ...models.ppe_incident import PpeIncident

    _require_member(project_id, user, db)

    if body.status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="Invalid status")

    incident = (
        db.query(PpeIncident)
        .filter(PpeIncident.id == incident_id, PpeIncident.project_id == project_id)
        .first()
    )
    if not incident:
        raise HTTPException(status_code=404, detail="Incident not found")

    incident.status = body.status
    if body.status == "resolved" and incident.ended_at is None:
        incident.ended_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(incident)

    # Push to all connected SSE clients so every tab/device updates instantly
    try:
        from sqlalchemy import func as sa_func
        from ...models.ppe_incident import PpeIncident as _PpeIncident
        from ...services.ppe_dashboard_broker import push as broker_push

        open_count = db.query(sa_func.count(_PpeIncident.id)).filter(
            _PpeIncident.project_id == project_id,
            _PpeIncident.status == "open",
        ).scalar()

        broker_push(project_id, {
            "type":       "ppe_incident_updated",
            "incident_id": incident_id,
            "status":     incident.status,
            "ended_at":   incident.ended_at.isoformat() if incident.ended_at else None,
        })
        broker_push(project_id, {
            "type":          "ppe_stats_update",
            "open_incidents": open_count,
        })
    except Exception:
        pass  # non-critical

    return {
        "id":       incident.id,
        "status":   incident.status,
        "ended_at": incident.ended_at.isoformat() if incident.ended_at else None,
    }


@router.get("/settings")
def get_ppe_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Returns current PPE analytics settings for all cameras in the project."""
    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()

    result = []
    for pc in pcs:
        analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )
        result.append({
            "project_camera_id": pc.id,
            "camera_id":         pc.camera_id,
            "ppe_enabled":       analytics.ppe_enabled if analytics else False,
            "inference_events_enabled": analytics.inference_events_enabled if analytics else False,
        })

    any_enabled = any(r["ppe_enabled"] for r in result) if result else False
    return {"ppe_enabled": any_enabled, "cameras": result}


@router.patch("/events-enabled")
def patch_events_enabled(
    project_id: int,
    body: PpeEventsEnabledPatch,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Enable or disable writing PPE incidents to the database."""
    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()

    for pc in pcs:
        analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )
        if analytics:
            analytics.inference_events_enabled = body.enabled
        else:
            analytics = ProjectCameraAnalytics(
                project_camera_id=pc.id,
                ppe_enabled=False,
                inference_events_enabled=body.enabled,
            )
            db.add(analytics)

    db.commit()
    try:
        log_event(
            db, "ppe_events_enabled_toggled", user.id,
            {"project_id": project_id, "enabled": body.enabled, "camera_count": len(pcs)},
            request=request, target_type="project", target_id=project_id,
        )
        db.commit()
    except Exception:
        pass
    try:
        from ...services.ppe_dashboard_broker import push as broker_push
        # Compute canonical PPE-enabled state across all cameras so SSE listeners
        # in other accounts (no shared broadcast/cache) can render from the event alone.
        per_cam = []
        ppe_starts = []
        for pc in pcs:
            a = (
                db.query(ProjectCameraAnalytics)
                .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
                .first()
            )
            cam_ppe = bool(a.ppe_enabled) if a else False
            per_cam.append({"camera_id": pc.camera_id, "ppe_enabled": cam_ppe})
            if cam_ppe and a and a.ppe_enabled_at:
                ppe_starts.append(a.ppe_enabled_at.isoformat())
        broker_push(project_id, {
            "type":                     "ppe_feature_changed",
            "inference_events_enabled": body.enabled,
            "any_camera_active":        any(c["ppe_enabled"] for c in per_cam),
            "cameras":                  per_cam,
            "live_session_start":       min(ppe_starts) if ppe_starts else None,
        })
    except Exception:
        pass  # non-critical — dashboard falls back to 30 s poll

    return {"inference_events_enabled": body.enabled, "project_id": project_id}


@router.get("/events-enabled")
def get_events_enabled(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return current inference_events_enabled state for the project."""
    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    states = []
    for pc in pcs:
        analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )
        states.append(analytics.inference_events_enabled if analytics else True)

    all_enabled = all(states) if states else True
    return {"inference_events_enabled": all_enabled, "project_id": project_id}


@router.get("/zones")
def get_zone_breakdown(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Zone-wise PPE violation summary for the given date range."""
    from ...models.ppe_incident import PpeIncident
    from ...models.camera import Camera
    from sqlalchemy import case

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)

    rows = (
        db.query(
            PpeIncident.zone_name,
            Camera.name.label("camera_name"),
            func.count(PpeIncident.id).label("violations_today"),
            func.count(func.distinct(
                func.coalesce(PpeIncident.global_person_id, PpeIncident.track_id)
            )).label("unique_persons"),
            func.sum(case((PpeIncident.status == "open", 1), else_=0)).label("open_incidents"),
            func.sum(case((PpeIncident.incident_type == "both_missing", 1), else_=0)).label("critical_violations"),
            func.sum(case((PpeIncident.incident_type == "no_helmet", 1), else_=0)).label("helmet_violations"),
            func.sum(case((PpeIncident.incident_type == "no_vest", 1), else_=0)).label("vest_violations"),
        )
        .join(Camera, Camera.id == PpeIncident.camera_id)
        .filter(
            PpeIncident.project_id == project_id,
            PpeIncident.started_at >= dt_from,
            PpeIncident.started_at <= dt_to,
        )
        .group_by(PpeIncident.zone_name, Camera.name)
        .all()
    )

    result = [
        {
            "zone_name":           row.zone_name or "Unassigned",
            "camera_name":         row.camera_name or "—",
            "violations_today":    row.violations_today,
            "unique_persons":      row.unique_persons,
            "open_incidents":      row.open_incidents or 0,
            "critical_violations": row.critical_violations or 0,
            "helmet_violations":   row.helmet_violations or 0,
            "vest_violations":     row.vest_violations or 0,
        }
        for row in rows
    ]
    result.sort(key=lambda x: x["violations_today"], reverse=True)
    return result


# ── SSE: real-time dashboard stream ───────────────────────────────────────────

@router.get("/stream")
async def ppe_dashboard_stream(
    project_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    Server-Sent Events stream for the PPE dashboard.
    Pushes two event types:
      - ppe_live_alert   : incident details as they are detected
      - ppe_stats_update : updated summary counters for stat cards

    Auth via ?token= query param because browser EventSource cannot send
    Authorization headers. Heartbeat every 25s keeps proxies from closing.
    """
    import asyncio
    import json
    from ...core.security import decode_access_token
    from ...services.ppe_dashboard_broker import register, unregister

    from jose import JWTError
    try:
        payload = decode_access_token(token)
    except JWTError:
        from fastapi.responses import Response
        return Response(status_code=401)
    if not payload:
        from fastapi.responses import Response
        return Response(status_code=401)
    user_id = int(payload.get("sub", 0))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        from fastapi.responses import Response
        return Response(status_code=401)
    if not user.is_approved:
        from fastapi.responses import Response
        return Response(status_code=403)
    token_ver = int(payload.get("ver", 1) or 1)
    user_ver  = int(user.token_version or 1)
    if token_ver != user_ver:
        from fastapi.responses import Response
        return Response(status_code=401)

    _require_member(project_id, user, db)
    db.close()

    q = register(project_id)

    async def event_generator():
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(data)}\n\n"
                except asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            unregister(project_id, q)

    from fastapi.responses import StreamingResponse as _SR
    return _SR(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control":    "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":       "keep-alive",
        },
    )
