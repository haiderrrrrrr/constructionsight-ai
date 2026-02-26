"""
Activity / Idle Monitoring REST + SSE + MJPEG endpoints.

Prefix: /projects/{project_id}/activity
Auth:   get_current_user + active membership check
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ...models.user import User

router = APIRouter(prefix="/projects/{project_id}/activity", tags=["activity"])


# ── helpers ──────────────────────────────────────────────────────────────────

def _require_member(project_id: int, user: User, db: Session) -> None:
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
    if not membership and project.created_by != user.id and user.platform_role != "admin":
        raise HTTPException(status_code=403, detail="Access denied")


def _parse_date_range(date_from: Optional[str], date_to: Optional[str]):
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


def _get_project_camera_ids(project_id: int, db: Session) -> list[int]:
    from ...models.project_camera import ProjectCamera
    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    return [pc.camera_id for pc in pcs]


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_activity_summary(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    High-level activity stats for the given date range (defaults to today).
    Aggregates across all cameras in the project.
    """
    from ...models.activity_snapshot import ActivitySnapshot
    from ...models.activity_alert import ActivityAlert
    from ...models.camera import Camera

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)

    camera_ids = _get_project_camera_ids(project_id, db)

    # Latest snapshot per camera (for live zone state)
    latest_zone_states = []
    motion_scores      = []
    activity_scores    = []
    moving_totals      = []
    stationary_totals  = []
    idle_totals        = []
    active_min_today   = 0
    idle_min_today     = 0
    low_min_today      = 0
    longest_idle_secs  = 0
    current_idle_secs  = 0
    idle_zone_count    = 0

    if camera_ids:
        # Per-camera aggregates in date range
        rows = (
            db.query(
                ActivitySnapshot.camera_id,
                func.avg(ActivitySnapshot.motion_intensity_score).label("avg_intensity"),
                func.avg(ActivitySnapshot.activity_score).label("avg_activity"),
                func.max(ActivitySnapshot.moving_count).label("max_moving"),
                func.max(ActivitySnapshot.stationary_count).label("max_stationary"),
                func.max(ActivitySnapshot.idle_count).label("max_idle"),
                func.sum(ActivitySnapshot.active_minutes_today).label("active_min"),
                func.sum(ActivitySnapshot.idle_minutes_today).label("idle_min"),
                func.sum(ActivitySnapshot.low_activity_minutes_today).label("low_min"),
                func.max(ActivitySnapshot.longest_idle_seconds).label("longest_idle"),
            )
            .filter(
                ActivitySnapshot.project_id == project_id,
                ActivitySnapshot.recorded_at >= dt_from,
                ActivitySnapshot.recorded_at <= dt_to,
            )
            .group_by(ActivitySnapshot.camera_id)
            .all()
        )
        for r in rows:
            if r.avg_intensity is not None:
                motion_scores.append(float(r.avg_intensity))
            if r.avg_activity is not None:
                activity_scores.append(float(r.avg_activity))
            moving_totals.append(r.max_moving or 0)
            stationary_totals.append(r.max_stationary or 0)
            idle_totals.append(r.max_idle or 0)
            active_min_today  += r.active_min or 0
            idle_min_today    += r.idle_min or 0
            low_min_today     += r.low_min or 0
            if (r.longest_idle or 0) > longest_idle_secs:
                longest_idle_secs = r.longest_idle or 0

        # Latest zone state per camera (most recent snapshot)
        for cam_id in camera_ids:
            latest = (
                db.query(ActivitySnapshot)
                .filter(
                    ActivitySnapshot.project_id == project_id,
                    ActivitySnapshot.camera_id  == cam_id,
                )
                .order_by(ActivitySnapshot.recorded_at.desc())
                .first()
            )
            if latest:
                latest_zone_states.append(latest.zone_state)
                if (latest.zone_state or "").upper() == "IDLE":
                    idle_zone_count += 1
                if latest.idle_duration_seconds:
                    current_idle_secs = max(current_idle_secs, latest.idle_duration_seconds)

    # Derive aggregate zone state (worst-case)
    _state_order = {"ALERTED": 0, "IDLE": 1, "LOW_ACTIVITY": 2, "ACTIVE": 3}
    agg_zone_state = min(latest_zone_states, key=lambda s: _state_order.get(s, 99)) if latest_zone_states else "ACTIVE"

    avg_motion_intensity = round(sum(motion_scores) / len(motion_scores), 1) if motion_scores else 0.0
    avg_activity_score   = round(sum(activity_scores) / len(activity_scores), 1) if activity_scores else 0.0

    total_workers = sum(moving_totals) + sum(stationary_totals) + sum(idle_totals)
    avg_idle_ratio = round((sum(stationary_totals) / total_workers) * 100, 1) if total_workers > 0 else 0.0

    alert_base_q = db.query(func.count(ActivityAlert.id)).filter(
        ActivityAlert.project_id == project_id,
        ActivityAlert.triggered_at >= dt_from,
        ActivityAlert.triggered_at <= dt_to,
    )
    open_alerts         = (alert_base_q.filter(ActivityAlert.status == "open").scalar() or 0)
    acknowledged_alerts = (alert_base_q.filter(ActivityAlert.status == "acknowledged").scalar() or 0)
    resolved_alerts     = (alert_base_q.filter(ActivityAlert.status == "resolved").scalar() or 0)

    open_alerts_total = (
        db.query(func.count(ActivityAlert.id))
          .filter(ActivityAlert.project_id == project_id, ActivityAlert.status == "open")
          .scalar() or 0
    )

    # Alert counts today
    zone_idle_today = (
        db.query(func.count(ActivityAlert.id))
        .filter(
            ActivityAlert.project_id == project_id,
            ActivityAlert.alert_type == "zone_idle",
            ActivityAlert.triggered_at >= dt_from,
            ActivityAlert.triggered_at <= dt_to,
        )
        .scalar() or 0
    )
    activity_drop_today = (
        db.query(func.count(ActivityAlert.id))
        .filter(
            ActivityAlert.project_id == project_id,
            ActivityAlert.alert_type == "activity_drop",
            ActivityAlert.triggered_at >= dt_from,
            ActivityAlert.triggered_at <= dt_to,
        )
        .scalar() or 0
    )

    cameras_total  = len(camera_ids)
    cameras_online = 0
    if camera_ids:
        cameras_online = (
            db.query(func.count(Camera.id))
            .filter(Camera.id.in_(camera_ids), Camera.worker_status == "running")
            .scalar() or 0
        )

    return {
        "zone_state":                  agg_zone_state,
        "motion_intensity_score":      avg_motion_intensity,
        "activity_score":              avg_activity_score,
        "avg_idle_ratio":              avg_idle_ratio,
        "moving_count":                sum(moving_totals),
        "stationary_count":            sum(stationary_totals),
        "idle_count":                  sum(idle_totals),
        "current_idle_duration_seconds": current_idle_secs,
        "active_minutes_today":        int(active_min_today),
        "idle_minutes_today":          int(idle_min_today),
        "low_activity_minutes_today":  int(low_min_today),
        "longest_idle_seconds":        int(longest_idle_secs),
        "idle_zone_count":             int(idle_zone_count),
        "zone_idle_alerts_today":      zone_idle_today,
        "activity_drop_alerts_today":  activity_drop_today,
        "open_alerts":                 int(open_alerts),
        "open_alerts_total":           int(open_alerts_total),
        "acknowledged_alerts":         int(acknowledged_alerts),
        "resolved_alerts":             int(resolved_alerts),
        "cameras_total":               cameras_total,
        "cameras_online":              cameras_online,
    }


@router.get("/trend")
def get_activity_trend(
    project_id: int,
    date_from:  Optional[str] = Query(None),
    date_to:    Optional[str] = Query(None),
    camera_id:  Optional[int] = Query(None),
    per_camera: bool          = Query(False),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Minute-bucketed (≤2h) or hourly (wider) activity trend.
    Returns [{recorded_at, avg_activity_score, avg_motion_intensity, zone_state}].
    """
    from ...models.activity_snapshot import ActivitySnapshot

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)
    span_hours = (dt_to - dt_from).total_seconds() / 3600
    trunc_unit = "minute" if span_hours <= 2 else ("hour" if span_hours <= 48 else "day")

    bucket_col = func.date_trunc(trunc_unit, ActivitySnapshot.recorded_at).label("bucket")

    if per_camera:
        q = (
            db.query(
                bucket_col,
                ActivitySnapshot.camera_id.label("camera_id"),
                func.max(ActivitySnapshot.zone_name).label("zone_name"),
                func.avg(ActivitySnapshot.activity_score).label("avg_activity"),
                func.avg(ActivitySnapshot.motion_intensity_score).label("avg_intensity"),
                func.avg(ActivitySnapshot.idle_duration_seconds).label("avg_idle_dur"),
                func.avg(ActivitySnapshot.moving_count).label("avg_moving"),
                func.avg(ActivitySnapshot.idle_count).label("avg_idle"),
                func.avg(ActivitySnapshot.stationary_count).label("avg_stationary"),
                func.avg(ActivitySnapshot.total_count).label("avg_total"),
            )
            .filter(
                ActivitySnapshot.project_id == project_id,
                ActivitySnapshot.recorded_at >= dt_from,
                ActivitySnapshot.recorded_at <= dt_to,
            )
        )
        if camera_id is not None:
            q = q.filter(ActivitySnapshot.camera_id == camera_id)
        rows = (
            q.group_by(bucket_col, ActivitySnapshot.camera_id)
             .order_by(bucket_col, ActivitySnapshot.camera_id)
             .all()
        )
        out = []
        for row in rows:
            denom = float(row.avg_total or 0)
            idle_ratio = round((float(row.avg_stationary or 0) / denom) * 100, 1) if denom > 0 else 0.0
            out.append({
                "recorded_at":           row.bucket.isoformat() if row.bucket else None,
                "camera_id":             int(row.camera_id) if row.camera_id is not None else None,
                "zone_name":             row.zone_name,
                "activity_score":        round(float(row.avg_activity), 1) if row.avg_activity else 0.0,
                "motion_intensity_score": round(float(row.avg_intensity), 1) if row.avg_intensity else 0.0,
                "idle_duration_seconds": round(float(row.avg_idle_dur), 1) if row.avg_idle_dur else 0.0,
                "moving_count":          round(float(row.avg_moving), 1) if row.avg_moving else 0.0,
                "idle_count":            round(float(row.avg_idle), 1) if row.avg_idle else 0.0,
                "stationary_count":      round(float(row.avg_stationary), 1) if row.avg_stationary else 0.0,
                "total_count":           round(float(row.avg_total), 1) if row.avg_total else 0.0,
                "idle_ratio":            idle_ratio,
            })
        return out

    q = (
        db.query(
            bucket_col,
            func.avg(ActivitySnapshot.activity_score).label("avg_activity"),
            func.avg(ActivitySnapshot.motion_intensity_score).label("avg_intensity"),
            func.max(ActivitySnapshot.zone_state).label("zone_state"),
            func.avg(ActivitySnapshot.stationary_count).label("avg_stationary"),
            func.avg(ActivitySnapshot.total_count).label("avg_total"),
        )
        .filter(
            ActivitySnapshot.project_id == project_id,
            ActivitySnapshot.recorded_at >= dt_from,
            ActivitySnapshot.recorded_at <= dt_to,
        )
    )
    if camera_id is not None:
        q = q.filter(ActivitySnapshot.camera_id == camera_id)
    rows = (
        q.group_by(bucket_col)
         .order_by(bucket_col)
         .all()
    )

    out = []
    for row in rows:
        denom = float(row.avg_total or 0)
        idle_ratio = round((float(row.avg_stationary or 0) / denom) * 100, 1) if denom > 0 else 0.0
        out.append({
            "recorded_at":           row.bucket.isoformat() if row.bucket else None,
            "avg_activity_score":    round(float(row.avg_activity), 1) if row.avg_activity else 0.0,
            "avg_motion_intensity":  round(float(row.avg_intensity), 1) if row.avg_intensity else 0.0,
            "idle_ratio":            idle_ratio,
            "zone_state":            row.zone_state or "ACTIVE",
        })
    return out


@router.get("/cameras")
def get_activity_cameras(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Latest activity metrics per camera in the project (from last snapshot)."""
    from ...models.activity_snapshot import ActivitySnapshot
    from ...models.activity_alert import ActivityAlert
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    cameras    = {c.id: c for c in db.query(Camera).filter(Camera.id.in_(camera_ids)).all()}

    open_alert_q = db.query(ActivityAlert.camera_id, func.count(ActivityAlert.id)).filter(
        ActivityAlert.project_id == project_id,
        ActivityAlert.status == "open",
    )
    if date_from or date_to:
        dt_from, dt_to = _parse_date_range(date_from, date_to)
        open_alert_q = open_alert_q.filter(
            ActivityAlert.triggered_at >= dt_from,
            ActivityAlert.triggered_at <= dt_to,
        )
    open_alert_rows = open_alert_q.group_by(ActivityAlert.camera_id).all()
    open_alert_map = {cid: int(cnt) for cid, cnt in open_alert_rows}

    result = []
    for cam_id in camera_ids:
        cam = cameras.get(cam_id)
        latest = (
            db.query(ActivitySnapshot)
            .filter(
                ActivitySnapshot.project_id == project_id,
                ActivitySnapshot.camera_id  == cam_id,
            )
            .order_by(ActivitySnapshot.recorded_at.desc())
            .first()
        )
        result.append({
            "camera_id":              cam_id,
            "camera_name":            cam.name if cam else f"Camera #{cam_id}",
            "zone_name":              latest.zone_name if latest else None,
            "zone_state":             latest.zone_state if latest else "ACTIVE",
            "motion_intensity_score": latest.motion_intensity_score if latest else 0.0,
            "activity_score":         latest.activity_score if latest else 0,
            "moving_count":           latest.moving_count if latest else 0,
            "stationary_count":       latest.stationary_count if latest else 0,
            "idle_count":             latest.idle_count if latest else 0,
            "total_count":            latest.total_count if latest else 0,
            "idle_duration_seconds":  latest.idle_duration_seconds if latest else 0,
            "last_snapshot_at":       latest.recorded_at.isoformat() if latest and latest.recorded_at else None,
            "open_alerts":            open_alert_map.get(cam_id, 0),
        })

    return result


@router.get("/live")
def get_activity_live(
    project_id: int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    In-memory live metrics from all running ActivityProcessors in this project.
    Returns {cameras: [...], project_totals: {...}}.
    """
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera
    from ...services.activity_analytics import get_all_processors

    _require_member(project_id, user, db)

    pcs        = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    cameras    = {c.id: c for c in db.query(Camera).filter(Camera.id.in_(camera_ids)).all()}

    all_procs   = get_all_processors()
    cameras_data = []

    for cam_id in camera_ids:
        proc = all_procs.get(cam_id)
        if proc is None or proc.project_id != project_id:
            continue
        m = proc.get_latest_metrics()
        if m is None:
            continue
        cam = cameras.get(cam_id)
        cameras_data.append({
            "camera_id":              cam_id,
            "camera_name":            cam.name if cam else f"Camera #{cam_id}",
            "zone_name":              m.get("zone_name"),
            "zone_state":             m.get("zone_state", "ACTIVE"),
            "motion_intensity_score": m.get("motion_intensity_score", 0.0),
            "activity_score":         m.get("activity_score", 0),
            "moving_count":           m.get("moving_count", 0),
            "stationary_count":       m.get("stationary_count", 0),
            "idle_count":             m.get("idle_count", 0),
            "total_count":            m.get("total_count", 0),
            "current_idle_duration_seconds": m.get("current_idle_duration_seconds", 0),
            "sparkline":              m.get("sparkline", []),
            "optical_flow_score":     m.get("optical_flow_score"),
        })

    total_moving     = sum(c["moving_count"] for c in cameras_data)
    total_idle       = sum(c["idle_count"] for c in cameras_data)
    total_workers    = sum(c["total_count"] for c in cameras_data)
    avg_intensity    = (
        round(sum(c["motion_intensity_score"] for c in cameras_data) / len(cameras_data), 1)
        if cameras_data else 0.0
    )

    return {
        "cameras": cameras_data,
        "project_totals": {
            "total_count":            total_workers,
            "moving_count":           total_moving,
            "idle_count":             total_idle,
            "avg_motion_intensity":   avg_intensity,
        },
    }


@router.get("/alerts")
def list_activity_alerts(
    project_id:   int,
    alert_type:   Optional[str]  = Query(None),
    severity:     Optional[str]  = Query(None),
    acknowledged: Optional[bool] = Query(None),
    camera_id:    Optional[int]  = Query(None),
    status:       Optional[str]  = Query(None),
    date_from:    Optional[str]  = Query(None),
    date_to:      Optional[str]  = Query(None),
    page:         int            = Query(1, ge=1),
    per_page:     int            = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Paginated activity alert list with optional filters."""
    from ...models.activity_alert import ActivityAlert

    _require_member(project_id, user, db)

    q = db.query(ActivityAlert).filter(ActivityAlert.project_id == project_id)
    if camera_id is not None:
        q = q.filter(ActivityAlert.camera_id == camera_id)
    if status:
        q = q.filter(ActivityAlert.status == status)
    if alert_type:
        q = q.filter(ActivityAlert.alert_type == alert_type)
    if severity:
        q = q.filter(ActivityAlert.severity == severity)
    if acknowledged is not None:
        q = q.filter(ActivityAlert.acknowledged == acknowledged)
    if date_from:
        try:
            q = q.filter(ActivityAlert.triggered_at >= datetime.fromisoformat(date_from.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if date_to:
        try:
            q = q.filter(ActivityAlert.triggered_at <= datetime.fromisoformat(date_to.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")

    total = q.count()
    items = q.order_by(ActivityAlert.triggered_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "items": [
            {
                "id":              a.id,
                "camera_id":       a.camera_id,
                "zone_name":       a.zone_name,
                "alert_type":      a.alert_type,
                "severity":        a.severity,
                "message":         a.message,
                "triggered_at":    a.triggered_at.isoformat() if a.triggered_at else None,
                "acknowledged":    a.acknowledged,
                "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                "snapshot_url":    a.snapshot_url,
                "status":          a.status,
            }
            for a in items
        ],
    }


@router.patch("/alerts/{alert_id}/acknowledge")
def acknowledge_activity_alert(
    project_id: int,
    alert_id:   int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Acknowledge an activity alert."""
    from ...models.activity_alert import ActivityAlert

    _require_member(project_id, user, db)

    alert = (
        db.query(ActivityAlert)
        .filter(ActivityAlert.id == alert_id, ActivityAlert.project_id == project_id)
        .first()
    )
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.acknowledged    = True
    alert.acknowledged_at = datetime.now(timezone.utc)
    alert.acknowledged_by = user.id
    db.commit()
    db.refresh(alert)

    return {
        "id":              alert.id,
        "acknowledged":    alert.acknowledged,
        "acknowledged_at": alert.acknowledged_at.isoformat() if alert.acknowledged_at else None,
        "status":          alert.status,
    }


@router.patch("/alerts/{alert_id}/status")
def update_activity_alert_status(
    project_id: int,
    alert_id:   int,
    body:       dict,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Update activity alert status: open → acknowledged → resolved."""
    from ...models.activity_alert import ActivityAlert

    _require_member(project_id, user, db)

    new_status = body.get("status", "")
    if new_status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be 'acknowledged' or 'resolved'")

    alert = (
        db.query(ActivityAlert)
        .filter(ActivityAlert.id == alert_id, ActivityAlert.project_id == project_id)
        .first()
    )
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.status = new_status
    if new_status == "acknowledged" and not alert.acknowledged:
        alert.acknowledged    = True
        alert.acknowledged_at = datetime.now(timezone.utc)
        alert.acknowledged_by = user.id
    db.commit()
    db.refresh(alert)

    try:
        from ...services.activity_dashboard_broker import push as act_broker_push
        open_count = (
            db.query(func.count(ActivityAlert.id))
              .filter(
                  ActivityAlert.project_id == project_id,
                  ActivityAlert.status == "open",
              )
              .scalar() or 0
        )
        act_broker_push(project_id, {
            "type":        "activity_alert_updated",
            "alert_id":    alert.id,
            "status":      alert.status,
            "open_alerts": int(open_count),
        })
    except Exception:
        pass

    return {
        "id":           alert.id,
        "status":       alert.status,
        "acknowledged": alert.acknowledged,
    }


# ── Settings ──────────────────────────────────────────────────────────────────

class ActivityZoneSettingsUpdateBody(BaseModel):
    idle_threshold_seconds:         Optional[int]   = None
    alert_idle_minutes:             Optional[int]   = None
    low_activity_threshold:         Optional[int]   = None
    movement_thresh_px:             Optional[float] = None
    stationary_thresh_secs:         Optional[int]   = None
    alert_sensitivity:              Optional[str]   = None
    optical_flow_weight:            Optional[float] = None
    zone_idle_confirm_cycles:       Optional[int]   = None
    low_activity_sustained_minutes: Optional[int]   = None


def _apply_activity_settings(row, body: ActivityZoneSettingsUpdateBody) -> None:
    if body.idle_threshold_seconds is not None: row.idle_threshold_seconds = body.idle_threshold_seconds
    if body.alert_idle_minutes     is not None: row.alert_idle_minutes     = body.alert_idle_minutes
    if body.low_activity_threshold is not None: row.low_activity_threshold = body.low_activity_threshold
    if body.movement_thresh_px     is not None: row.movement_thresh_px     = body.movement_thresh_px
    if body.stationary_thresh_secs is not None: row.stationary_thresh_secs = body.stationary_thresh_secs
    if body.alert_sensitivity              is not None: row.alert_sensitivity              = body.alert_sensitivity
    if body.optical_flow_weight            is not None: row.optical_flow_weight            = body.optical_flow_weight
    if body.zone_idle_confirm_cycles       is not None: row.zone_idle_confirm_cycles       = body.zone_idle_confirm_cycles
    if body.low_activity_sustained_minutes is not None: row.low_activity_sustained_minutes = body.low_activity_sustained_minutes


@router.get("/settings", response_model=list)
def get_activity_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Get project-level and per-camera activity settings."""
    _require_member(project_id, user, db)
    from ...models.activity_zone_settings import ActivityZoneSettings
    from ...schemas.activity_settings import ActivityZoneSettingsResponse
    rows = (
        db.query(ActivityZoneSettings)
        .filter(ActivityZoneSettings.project_id == project_id)
        .order_by(ActivityZoneSettings.camera_id.nullsfirst())
        .all()
    )
    return [ActivityZoneSettingsResponse.model_validate(r) for r in rows]


@router.patch("/settings", status_code=200)
def upsert_activity_settings(
    project_id: int,
    body: ActivityZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Create or update project-level activity settings (camera_id=None)."""
    _require_member(project_id, user, db)
    from ...models.activity_zone_settings import ActivityZoneSettings
    from ...schemas.activity_settings import ActivityZoneSettingsResponse

    row = (
        db.query(ActivityZoneSettings)
        .filter(
            ActivityZoneSettings.project_id == project_id,
            ActivityZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row is None:
        row = ActivityZoneSettings(project_id=project_id, camera_id=None)
        db.add(row)
    _apply_activity_settings(row, body)
    db.commit()
    db.refresh(row)

    # Hot-reload: push updated config into any running ActivityProcessor for this project
    try:
        from ...services.activity_analytics import get_processor
        from ...services.ml_config_service import load_config
        from ...models.project_camera import ProjectCamera

        camera_ids = [
            pc.camera_id
            for pc in db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
        ]
        for cid in camera_ids:
            proc = get_processor(cid)
            if proc and proc.is_running():
                new_cfg = load_config(db)
                # Merge updated row into cfg
                if row.idle_threshold_seconds  is not None:
                    new_cfg["activity_idle_threshold_seconds"]  = row.idle_threshold_seconds
                if row.alert_idle_minutes       is not None:
                    new_cfg["activity_alert_idle_minutes"]      = row.alert_idle_minutes
                if row.low_activity_threshold   is not None:
                    new_cfg["activity_low_activity_threshold"]  = row.low_activity_threshold
                if row.movement_thresh_px       is not None:
                    new_cfg["activity_movement_thresh_px"]      = row.movement_thresh_px
                if row.stationary_thresh_secs   is not None:
                    new_cfg["activity_stationary_thresh_secs"]  = row.stationary_thresh_secs
                if row.alert_sensitivity        is not None:
                    new_cfg["alert_sensitivity"]                = row.alert_sensitivity
                if row.optical_flow_weight      is not None:
                    new_cfg["activity_optical_flow_weight"]     = row.optical_flow_weight
                if row.zone_idle_confirm_cycles is not None:
                    new_cfg["activity_zone_transition_cycles"]         = row.zone_idle_confirm_cycles
                if row.low_activity_sustained_minutes is not None:
                    new_cfg["activity_low_activity_sustained_seconds"] = row.low_activity_sustained_minutes * 60
                proc.update_config(new_cfg)
    except Exception:
        pass  # best-effort

    return ActivityZoneSettingsResponse.model_validate(row)


@router.delete("/settings", status_code=200)
def reset_activity_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Delete project-level activity settings row, restoring factory defaults on next start."""
    _require_member(project_id, user, db)
    from ...models.activity_zone_settings import ActivityZoneSettings
    row = (
        db.query(ActivityZoneSettings)
        .filter(
            ActivityZoneSettings.project_id == project_id,
            ActivityZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"detail": "Settings reset to defaults"}


@router.put("/settings/{camera_id}", status_code=200)
def upsert_camera_activity_settings(
    project_id: int,
    camera_id:  int,
    body: ActivityZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Create or update per-camera activity settings override."""
    _require_member(project_id, user, db)
    from ...models.activity_zone_settings import ActivityZoneSettings
    from ...schemas.activity_settings import ActivityZoneSettingsResponse

    row = (
        db.query(ActivityZoneSettings)
        .filter(
            ActivityZoneSettings.project_id == project_id,
            ActivityZoneSettings.camera_id  == camera_id,
        )
        .first()
    )
    if row is None:
        row = ActivityZoneSettings(project_id=project_id, camera_id=camera_id)
        db.add(row)
    _apply_activity_settings(row, body)
    db.commit()
    db.refresh(row)
    return ActivityZoneSettingsResponse.model_validate(row)


# ── SSE: real-time activity stats stream ──────────────────────────────────────

@router.get("/stream")
async def activity_stream(
    project_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    SSE stream for the Activity Monitoring dashboard.
    Events: activity_stats_update | activity_alert | heartbeat
    Auth via ?token= because browser EventSource cannot send headers.
    """
    import asyncio
    from ...core.security import decode_access_token
    from ...services.activity_dashboard_broker import register, unregister
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
    if not user or not user.is_active or not user.is_approved:
        from fastapi.responses import Response
        return Response(status_code=401)
    if int(payload.get("ver", 1) or 1) != int(user.token_version or 1):
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
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
            "Connection":        "keep-alive",
        },
    )


# ── MJPEG: activity overlay video stream ──────────────────────────────────────

@router.get("/stream/{camera_id}")
async def activity_video_stream(
    project_id: int,
    camera_id:  int,
    db: Session = Depends(get_db),
):
    """MJPEG stream of the activity-overlaid camera feed."""
    import asyncio
    import cv2
    import time as _time_module
    import numpy as _np

    from ...models.project_camera import ProjectCamera
    pc = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id  == camera_id,
    ).first()
    if not pc:
        from fastapi.responses import Response
        return Response(status_code=404)

    db.close()

    from ...api.routes.ml_stream_enterprise import (
        _activity_annotated,
        _activity_standalone_pipelines,
        _activity_standalone_lock,
        _camera_captures,
    )

    async def mjpeg_generator():
        boundary = b"--frame"
        last_seq  = -1

        def _get_raw_frame():
            with _activity_standalone_lock:
                p = _activity_standalone_pipelines.get(camera_id)
            if p is not None:
                fresh = p.get("fresh")
                if fresh is not None:
                    with fresh["lock"]:
                        frame = fresh.get("frame")
                    if frame is not None:
                        return frame
            # Fallback: PPE/Workforce pipeline owns the shared capture
            cap = _camera_captures.get(camera_id)
            if cap is not None and cap.isOpened():
                ok, frame = cap.read()
                if ok and frame is not None:
                    return frame
            return None

        def _encode_and_yield(frame):
            success, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
            if not success:
                return None
            jpg = buf.tobytes()
            return (
                boundary + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(jpg)).encode() + b"\r\n\r\n"
                + jpg + b"\r\n"
            )

        inference_started = False
        last_placeholder_ts = 0.0

        _ph = _np.zeros((360, 640, 3), dtype=_np.uint8)
        cv2.putText(_ph, "Starting stream…", (16, 48), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2, cv2.LINE_AA)
        cv2.putText(_ph, "Loading inference…", (16, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (210, 210, 210), 2, cv2.LINE_AA)
        _ph_chunk = _encode_and_yield(_ph)
        if _ph_chunk:
            last_placeholder_ts = _time_module.time()
            yield _ph_chunk

        while True:
            entry = _activity_annotated.get(camera_id)
            annotated_frame = None
            seq = last_seq  # default: treat as unchanged
            if entry is not None:
                lock = entry.get("lock")
                if lock is not None:
                    with lock:
                        annotated_frame = entry.get("frame")
                        seq = entry.get("seq", last_seq)

            if annotated_frame is not None and seq != last_seq:
                chunk = _encode_and_yield(annotated_frame)
                if chunk:
                    last_seq = seq
                    inference_started = True
                    any_frame_yielded = True
                    yield chunk
                await asyncio.sleep(0.033)
            elif not inference_started:
                raw = _get_raw_frame()
                if raw is not None:
                    chunk = _encode_and_yield(raw)
                    if chunk:
                        yield chunk
                        continue
                now = _time_module.time()
                if _ph_chunk and (now - last_placeholder_ts) > 1.0:
                    last_placeholder_ts = now
                    yield _ph_chunk
                await asyncio.sleep(0.05)
            else:
                await asyncio.sleep(0.01)

    from fastapi.responses import StreamingResponse as _SR
    return _SR(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
