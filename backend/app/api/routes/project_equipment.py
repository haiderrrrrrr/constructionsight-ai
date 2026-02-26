"""
Equipment Analytics REST + SSE + MJPEG endpoints.

Prefix: /projects/{project_id}/equipment
Auth:   get_current_user + active membership check
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, case, literal
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ...models.user import User

router = APIRouter(prefix="/projects/{project_id}/equipment", tags=["equipment"])

DEV_UPLOAD_CAMERA_ID = 9999
DEV_UPLOAD_CAMERA_NAME = "Uploaded Video"


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
def get_equipment_summary(
    project_id: int,
    date_from:  Optional[str] = Query(None),
    date_to:    Optional[str] = Query(None),
    camera_id:  Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    High-level equipment stats for the given date range (defaults to today).
    Aggregates across all cameras in the project.
    """
    from ...models.equipment_snapshot import EquipmentSnapshot
    from ...models.equipment_alert import EquipmentAlert
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)

    camera_ids = _get_project_camera_ids(project_id, db)
    scoped_camera_ids = [camera_id] if (camera_id and camera_id in camera_ids) else None

    total_equipment_today = 0
    peak_equipment_count  = 0
    utilization_scores    = []
    avg_active_dur_list   = []
    idle_ratio_list       = []

    snap_q = (
        db.query(
            EquipmentSnapshot.camera_id,
            func.max(EquipmentSnapshot.active_count).label("peak"),
            func.avg(EquipmentSnapshot.utilization_score).label("avg_util"),
            func.avg(EquipmentSnapshot.avg_active_duration).label("avg_dur"),
            func.avg(
                case(
                    (EquipmentSnapshot.total_count > 0,
                     EquipmentSnapshot.idle_count * 100.0 / EquipmentSnapshot.total_count),
                    else_=literal(0.0),
                )
            ).label("avg_idle_ratio"),
        )
        .filter(
            EquipmentSnapshot.project_id == project_id,
            EquipmentSnapshot.recorded_at >= dt_from,
            EquipmentSnapshot.recorded_at <= dt_to,
        )
    )
    if scoped_camera_ids:
        snap_q = snap_q.filter(EquipmentSnapshot.camera_id.in_(scoped_camera_ids))
    rows = snap_q.group_by(EquipmentSnapshot.camera_id).all()
    for r in rows:
        total_equipment_today += r.peak or 0
        if r.peak and r.peak > peak_equipment_count:
            peak_equipment_count = r.peak
        if r.avg_util is not None:
            utilization_scores.append(float(r.avg_util))
        if r.avg_dur is not None:
            avg_active_dur_list.append(float(r.avg_dur))
        if r.avg_idle_ratio is not None:
            idle_ratio_list.append(float(r.avg_idle_ratio))

    avg_utilization    = round(sum(utilization_scores) / len(utilization_scores), 1) if utilization_scores else 0.0
    avg_active_duration = round(sum(avg_active_dur_list) / len(avg_active_dur_list), 1) if avg_active_dur_list else 0.0
    avg_idle_ratio     = round(sum(idle_ratio_list) / len(idle_ratio_list), 1) if idle_ratio_list else 0.0

    alert_base_q = db.query(func.count(EquipmentAlert.id)).filter(
        EquipmentAlert.project_id == project_id,
        EquipmentAlert.triggered_at >= dt_from,
        EquipmentAlert.triggered_at <= dt_to,
    )
    if camera_id and camera_id in camera_ids:
        alert_base_q = alert_base_q.filter(EquipmentAlert.camera_id == camera_id)

    idle_waste_alerts    = (alert_base_q.filter(EquipmentAlert.alert_type == "idle_waste").scalar() or 0)
    overuse_alerts       = (alert_base_q.filter(EquipmentAlert.alert_type == "overuse").scalar() or 0)
    misuse_events        = idle_waste_alerts + overuse_alerts

    open_alerts         = (alert_base_q.filter(EquipmentAlert.status == "open").scalar() or 0)
    acknowledged_alerts = (alert_base_q.filter(EquipmentAlert.status == "acknowledged").scalar() or 0)
    resolved_alerts     = (alert_base_q.filter(EquipmentAlert.status == "resolved").scalar() or 0)

    _open_total_q = db.query(func.count(EquipmentAlert.id)).filter(
        EquipmentAlert.project_id == project_id,
        EquipmentAlert.status == "open",
    )
    if camera_id and camera_id in camera_ids:
        _open_total_q = _open_total_q.filter(EquipmentAlert.camera_id == camera_id)
    open_alerts_total = _open_total_q.scalar() or 0

    cameras_total  = len(camera_ids)
    cameras_online = 0
    if camera_ids:
        cameras_online = (
            db.query(func.count(Camera.id))
            .filter(Camera.id.in_(camera_ids), Camera.worker_status == "running")
            .scalar() or 0
        )

    return {
        "total_equipment_today":  total_equipment_today,
        "peak_equipment_count":   peak_equipment_count,
        "avg_utilization":        avg_utilization,
        "avg_active_duration":    avg_active_duration,
        "avg_idle_ratio":         avg_idle_ratio,
        "idle_waste_alerts_today": idle_waste_alerts,
        "overuse_alerts_today":   overuse_alerts,
        "misuse_events":          misuse_events,
        "open_alerts":            open_alerts,
        "open_alerts_total":      open_alerts_total,
        "acknowledged_alerts":    acknowledged_alerts,
        "resolved_alerts":        resolved_alerts,
        "cameras_online":         cameras_online,
        "cameras_total":          cameras_total,
    }


@router.get("/trend")
def get_equipment_trend(
    project_id: int,
    date_from:  Optional[str]  = Query(None),
    date_to:    Optional[str]  = Query(None),
    camera_id:  Optional[int]  = Query(None),
    per_camera: bool           = Query(False),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Minute-bucketed (≤2h) or hourly (wider) equipment trend for the project.
    per_camera=true → returns one row per (camera_id, bucket) with camera_id,
    zone_name and avg_active_duration included — used by the scatter chart.
    """
    from ...models.equipment_snapshot import EquipmentSnapshot

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)
    span_hours = (dt_to - dt_from).total_seconds() / 3600
    trunc_unit = "minute" if span_hours <= 2 else ("hour" if span_hours <= 48 else "day")

    bucket_col = func.date_trunc(trunc_unit, EquipmentSnapshot.recorded_at).label("bucket")

    if per_camera:
        q = (
            db.query(
                bucket_col,
                EquipmentSnapshot.camera_id,
                EquipmentSnapshot.zone_name,
                func.avg(EquipmentSnapshot.active_count).label("avg_equipment"),
                func.avg(EquipmentSnapshot.utilization_score).label("avg_util"),
                func.avg(EquipmentSnapshot.avg_active_duration).label("avg_dur"),
                func.max(EquipmentSnapshot.zone_status).label("zone_status"),
                func.avg(
                    case(
                        (EquipmentSnapshot.total_count > 0,
                         EquipmentSnapshot.idle_count * 100.0 / EquipmentSnapshot.total_count),
                        else_=literal(0.0),
                    )
                ).label("avg_idle_ratio"),
            )
            .filter(
                EquipmentSnapshot.project_id == project_id,
                EquipmentSnapshot.recorded_at >= dt_from,
                EquipmentSnapshot.recorded_at <= dt_to,
            )
        )
        if camera_id is not None:
            q = q.filter(EquipmentSnapshot.camera_id == camera_id)
        rows = (
            q.group_by(
                func.date_trunc(trunc_unit, EquipmentSnapshot.recorded_at),
                EquipmentSnapshot.camera_id,
                EquipmentSnapshot.zone_name,
            )
            .order_by(func.date_trunc(trunc_unit, EquipmentSnapshot.recorded_at))
            .all()
        )
        return [
            {
                "recorded_at":        row.bucket.isoformat() if row.bucket else None,
                "camera_id":          row.camera_id,
                "zone_name":          row.zone_name,
                "avg_equipment":      round(float(row.avg_equipment), 1)  if row.avg_equipment else 0,
                "avg_utilization":    round(float(row.avg_util), 1)       if row.avg_util      else 0.0,
                "avg_active_duration": round(float(row.avg_dur), 1)       if row.avg_dur       else 0.0,
                "zone_status":        row.zone_status or "BALANCED",
                "avg_idle_ratio":     round(float(row.avg_idle_ratio), 1) if row.avg_idle_ratio else 0.0,
            }
            for row in rows
        ]

    # Default: project aggregate per time bucket
    q = (
        db.query(
            bucket_col,
            func.avg(EquipmentSnapshot.active_count).label("avg_equipment"),
            func.avg(EquipmentSnapshot.utilization_score).label("avg_util"),
            func.avg(EquipmentSnapshot.avg_active_duration).label("avg_dur"),
            func.max(EquipmentSnapshot.zone_status).label("zone_status"),
        )
        .filter(
            EquipmentSnapshot.project_id == project_id,
            EquipmentSnapshot.recorded_at >= dt_from,
            EquipmentSnapshot.recorded_at <= dt_to,
        )
    )
    if camera_id is not None:
        q = q.filter(EquipmentSnapshot.camera_id == camera_id)
    rows = (
        q.group_by(func.date_trunc(trunc_unit, EquipmentSnapshot.recorded_at))
        .order_by(func.date_trunc(trunc_unit, EquipmentSnapshot.recorded_at))
        .all()
    )
    return [
        {
            "recorded_at":        row.bucket.isoformat() if row.bucket else None,
            "avg_equipment":      round(float(row.avg_equipment), 1) if row.avg_equipment else 0,
            "avg_utilization":    round(float(row.avg_util), 1)      if row.avg_util      else 0.0,
            "avg_active_duration": round(float(row.avg_dur), 1)      if row.avg_dur       else 0.0,
            "zone_status":        row.zone_status or "BALANCED",
        }
        for row in rows
    ]


@router.get("/cameras")
def get_equipment_cameras(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Latest equipment metrics per camera in the project (from last snapshot).
    """
    from ...models.equipment_snapshot import EquipmentSnapshot
    from ...models.equipment_alert import EquipmentAlert
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    pc_map = {pc.camera_id: pc for pc in pcs}

    cameras = db.query(Camera).filter(Camera.id.in_(camera_ids)).all()
    camera_map = {c.id: c for c in cameras}

    open_alert_q = db.query(EquipmentAlert.camera_id, func.count(EquipmentAlert.id)).filter(
        EquipmentAlert.project_id == project_id,
        EquipmentAlert.status == "open",
    )
    if date_from or date_to:
        dt_from, dt_to = _parse_date_range(date_from, date_to)
        open_alert_q = open_alert_q.filter(
            EquipmentAlert.triggered_at >= dt_from,
            EquipmentAlert.triggered_at <= dt_to,
        )
    open_alert_rows = open_alert_q.group_by(EquipmentAlert.camera_id).all()
    open_alerts_map = {row[0]: row[1] for row in open_alert_rows}

    result = []
    for cam_id in camera_ids:
        cam = camera_map.get(cam_id)

        latest = (
            db.query(EquipmentSnapshot)
            .filter(
                EquipmentSnapshot.project_id == project_id,
                EquipmentSnapshot.camera_id  == cam_id,
            )
            .order_by(EquipmentSnapshot.recorded_at.desc())
            .first()
        )

        sparkline = []
        if latest and latest.sparkline_json:
            try:
                sparkline = json.loads(latest.sparkline_json)
            except (ValueError, TypeError):
                sparkline = []

        misuse_flags = []
        if latest and latest.misuse_flags_json:
            try:
                misuse_flags = json.loads(latest.misuse_flags_json)
            except (ValueError, TypeError):
                misuse_flags = []

        result.append({
            "camera_id":             cam_id,
            "camera_name":           cam.name if cam else f"Camera #{cam_id}",
            "zone_name":             latest.zone_name if latest else None,
            "latest_active_count":   latest.active_count if latest else 0,
            "active_count":          latest.active_count if latest else 0,
            "idle_count":            latest.idle_count if latest else 0,
            "total_count":           latest.total_count if latest else 0,
            "latest_utilization":    latest.utilization_score if latest else 0.0,
            "latest_zone_status":    latest.zone_status if latest else "BALANCED",
            "misuse_flags":          misuse_flags,
            "avg_active_duration":   latest.avg_active_duration if latest else 0.0,
            "cross_zone_conflicts":  latest.cross_zone_conflicts if latest else 0,
            "open_alerts":           open_alerts_map.get(cam_id, 0),
            "sparkline":             sparkline,
            "last_snapshot_at":      latest.recorded_at.isoformat() if latest and latest.recorded_at else None,
        })

    extra_snapshot_ids = [
        row[0]
        for row in (
            db.query(EquipmentSnapshot.camera_id)
            .filter(
                EquipmentSnapshot.project_id == project_id,
                EquipmentSnapshot.camera_id.isnot(None),
                ~EquipmentSnapshot.camera_id.in_(camera_ids) if camera_ids else literal(True),
            )
            .distinct()
            .all()
        )
        if row[0] is not None
    ]
    for cam_id in extra_snapshot_ids:
        latest = (
            db.query(EquipmentSnapshot)
            .filter(
                EquipmentSnapshot.project_id == project_id,
                EquipmentSnapshot.camera_id == cam_id,
            )
            .order_by(EquipmentSnapshot.recorded_at.desc())
            .first()
        )
        if not latest:
            continue

        sparkline = []
        if latest.sparkline_json:
            try:
                sparkline = json.loads(latest.sparkline_json)
            except (ValueError, TypeError):
                sparkline = []

        misuse_flags = []
        if latest.misuse_flags_json:
            try:
                misuse_flags = json.loads(latest.misuse_flags_json)
            except (ValueError, TypeError):
                misuse_flags = []

        result.append({
            "camera_id":             cam_id,
            "camera_name":           DEV_UPLOAD_CAMERA_NAME if cam_id == DEV_UPLOAD_CAMERA_ID else f"Virtual Camera #{cam_id}",
            "zone_name":             latest.zone_name,
            "latest_active_count":   latest.active_count,
            "active_count":          latest.active_count,
            "idle_count":            latest.idle_count,
            "total_count":           latest.total_count,
            "latest_utilization":    latest.utilization_score,
            "latest_zone_status":    latest.zone_status or "BALANCED",
            "misuse_flags":          misuse_flags,
            "avg_active_duration":   latest.avg_active_duration or 0.0,
            "cross_zone_conflicts":  latest.cross_zone_conflicts or 0,
            "open_alerts":           open_alerts_map.get(cam_id, 0),
            "sparkline":             sparkline,
            "last_snapshot_at":      latest.recorded_at.isoformat() if latest.recorded_at else None,
        })

    return result


@router.get("/live")
def get_equipment_live(
    project_id: int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    In-memory live metrics from all running EquipmentProcessors in this project.
    Mirrors the Workforce live endpoint, including the dev upload virtual camera.
    """
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera
    from ...services.equipment_analytics import get_all_processors

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    cameras = {c.id: c for c in db.query(Camera).filter(Camera.id.in_(camera_ids)).all()}

    cameras_data = []
    for cam_id, proc in get_all_processors().items():
        if proc is None or proc.project_id != project_id:
            continue
        m = proc.get_latest_metrics()
        if m is None:
            continue
        cam = cameras.get(cam_id)
        cameras_data.append({
            "camera_id":            cam_id,
            "camera_name":          cam.name if cam else (DEV_UPLOAD_CAMERA_NAME if cam_id == DEV_UPLOAD_CAMERA_ID else f"Virtual Camera #{cam_id}"),
            "zone_name":            m.get("zone_name"),
            "active_count":         m.get("active_count", 0),
            "idle_count":           m.get("idle_count", 0),
            "total_count":          m.get("total_count", 0),
            "entering_count":       m.get("entering_count", 0),
            "active_ratio":         m.get("active_ratio", 0.0),
            "idle_ratio":           m.get("idle_ratio", 0.0),
            "utilization_score":    m.get("utilization_score", 0),
            "zone_status":          m.get("zone_status", "BALANCED"),
            "avg_active_duration":  m.get("avg_active_duration", 0.0),
            "cross_zone_conflicts": m.get("cross_zone_conflicts", 0),
            "misuse_flags":         m.get("misuse_flags", []),
            "sparkline":            m.get("sparkline", []),
        })

    total = sum(c["total_count"] for c in cameras_data)
    active = sum(c["active_count"] for c in cameras_data)
    idle = sum(c["idle_count"] for c in cameras_data)
    util_avg = (
        round(sum(c["utilization_score"] for c in cameras_data) / len(cameras_data), 1)
        if cameras_data else 0.0
    )

    recs = []
    for c in cameras_data:
        zone = c["zone_name"] or f"Camera {c['camera_id']}"
        if c["zone_status"] in ("OVERUSED", "HIGH_USAGE"):
            recs.append(f"High equipment activity in '{zone}'. Watch for overuse or unsafe congestion.")
        if c["idle_count"] > 0 and c["total_count"] > 0:
            recs.append(f"Idle equipment detected in '{zone}'. Review whether machines are waiting unnecessarily.")
    if not recs:
        recs.append("Equipment usage is balanced across active zones.")

    return {
        "cameras": cameras_data,
        "project_totals": {
            "total": total,
            "active": active,
            "idle": idle,
            "avg_utilization": util_avg,
        },
        "recommendations": recs,
    }


@router.get("/alerts")
def list_equipment_alerts(
    project_id: int,
    alert_type: Optional[str] = Query(None),
    severity:   Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    camera_id:  Optional[int] = Query(None),
    status:     Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    page:    int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Paginated equipment alert list with optional filters."""
    from ...models.equipment_alert import EquipmentAlert
    from ...models.camera import Camera

    _require_member(project_id, user, db)

    q = (
        db.query(EquipmentAlert, Camera.name.label("camera_name"))
          .outerjoin(Camera, Camera.id == EquipmentAlert.camera_id)
          .filter(EquipmentAlert.project_id == project_id)
    )
    if camera_id is not None:
        q = q.filter(EquipmentAlert.camera_id == camera_id)
    if status:
        q = q.filter(EquipmentAlert.status == status)
    if alert_type:
        q = q.filter(EquipmentAlert.alert_type == alert_type)
    if severity:
        q = q.filter(EquipmentAlert.severity == severity)
    if acknowledged is not None:
        q = q.filter(EquipmentAlert.acknowledged == acknowledged)
    if date_from:
        try:
            q = q.filter(EquipmentAlert.triggered_at >= datetime.fromisoformat(date_from.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if date_to:
        try:
            q = q.filter(EquipmentAlert.triggered_at <= datetime.fromisoformat(date_to.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")

    total = q.count()
    rows = q.order_by(EquipmentAlert.triggered_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "items": [
            {
                "id":              a.id,
                "camera_id":       a.camera_id,
                "camera_name":     cam_name,
                "zone_name":       a.zone_name,
                "alert_type":      a.alert_type,
                "severity":        a.severity,
                "message":         a.message,
                "equipment_type":  a.equipment_type,
                "track_id":        a.track_id,
                "triggered_at":    a.triggered_at.isoformat() if a.triggered_at else None,
                "acknowledged":    a.acknowledged,
                "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                "snapshot_url":    a.snapshot_url,
                "status":          a.status,
            }
            for a, cam_name in rows
        ],
    }


@router.patch("/alerts/{alert_id}/status")
def update_alert_status(
    project_id: int,
    alert_id:   int,
    body:       dict,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Update equipment alert status: open → acknowledged → resolved."""
    from ...models.equipment_alert import EquipmentAlert

    _require_member(project_id, user, db)

    new_status = body.get("status", "")
    if new_status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be 'acknowledged' or 'resolved'")

    alert = (
        db.query(EquipmentAlert)
        .filter(EquipmentAlert.id == alert_id, EquipmentAlert.project_id == project_id)
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
        from ...services.equipment_dashboard_broker import push as eq_broker_push
        open_count = (
            db.query(func.count(EquipmentAlert.id))
              .filter(
                  EquipmentAlert.project_id == project_id,
                  EquipmentAlert.status     == "open",
              )
              .scalar() or 0
        )
        eq_broker_push(project_id, {
            "type":        "equipment_alert_updated",
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


# ── SSE: real-time equipment stats stream ─────────────────────────────────────

@router.get("/stream")
async def equipment_stream(
    project_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    SSE stream for the Equipment Analytics dashboard.
    Events: equipment_stats_update | equipment_alert | heartbeat
    Auth via ?token= because browser EventSource cannot send headers.
    """
    import asyncio
    from ...core.security import decode_access_token
    from ...services.equipment_dashboard_broker import register, unregister
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


# ── MJPEG: equipment overlay video stream ─────────────────────────────────────

@router.get("/stream/{camera_id}")
async def equipment_video_stream(
    project_id: int,
    camera_id:  int,
    db: Session = Depends(get_db),
):
    """MJPEG stream of the equipment-overlaid camera feed."""
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
        _equipment_annotated,
        _equipment_standalone_pipelines,
        _equipment_standalone_lock,
        _camera_captures,
    )

    async def mjpeg_generator():
        boundary = b"--frame"
        last_seq  = -1

        def _get_raw_frame():
            with _equipment_standalone_lock:
                p = _equipment_standalone_pipelines.get(camera_id)
            if p is not None:
                fresh = p.get("fresh")
                if fresh is not None:
                    with fresh["lock"]:
                        frame = fresh.get("frame")
                    if frame is not None:
                        return frame
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
            entry = _equipment_annotated.get(camera_id)
            annotated_frame = None
            seq = last_seq
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


# ── Equipment Settings ─────────────────────────────────────────────────────────

class EquipmentZoneSettingsUpdateBody(BaseModel):
    expected_equipment_count:     Optional[int]   = None
    max_equipment_count:          Optional[int]   = None
    idle_alert_threshold_minutes: Optional[int]   = None
    overuse_threshold_hours:      Optional[float] = None
    min_workers_alongside:        Optional[int]   = None
    alert_sensitivity:            Optional[str]   = None
    confirm_frames:               Optional[int]   = None


@router.get("/settings", response_model=list)
def get_equipment_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get project-level and per-camera equipment settings for a project."""
    _require_member(project_id, user, db)
    from ...models.equipment_zone_settings import EquipmentZoneSettings
    from ...schemas.equipment_settings import EquipmentZoneSettingsResponse
    rows = (
        db.query(EquipmentZoneSettings)
        .filter(EquipmentZoneSettings.project_id == project_id)
        .order_by(EquipmentZoneSettings.camera_id.nullsfirst())
        .all()
    )
    return [EquipmentZoneSettingsResponse.model_validate(r) for r in rows]


@router.patch("/settings", status_code=200)
def upsert_equipment_settings(
    project_id: int,
    body: EquipmentZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update project-level equipment settings (camera_id=None)."""
    _require_member(project_id, user, db)
    from ...models.equipment_zone_settings import EquipmentZoneSettings
    from ...schemas.equipment_settings import EquipmentZoneSettingsResponse
    row = (
        db.query(EquipmentZoneSettings)
        .filter(
            EquipmentZoneSettings.project_id == project_id,
            EquipmentZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row is None:
        row = EquipmentZoneSettings(project_id=project_id, camera_id=None)
        db.add(row)
    _apply_settings(row, body)
    db.commit()
    db.refresh(row)

    try:
        from ...services.equipment_analytics import get_processor
        from ...models.project_camera import ProjectCamera
        camera_ids = [
            pc.camera_id
            for pc in db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
        ]
        for cid in camera_ids:
            proc = get_processor(cid)
            if proc and proc.is_running():
                from ...models.equipment_zone_settings import EquipmentZoneSettings as EZS
                merged = (
                    db.query(EZS)
                    .filter(EZS.project_id == project_id, EZS.camera_id.is_(None))
                    .first()
                )
                if merged:
                    proc.update_config(merged)
    except Exception:
        pass

    return EquipmentZoneSettingsResponse.model_validate(row)


@router.delete("/settings", status_code=200)
def reset_equipment_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete project-level equipment settings row, restoring factory defaults on next start."""
    _require_member(project_id, user, db)
    from ...models.equipment_zone_settings import EquipmentZoneSettings
    row = (
        db.query(EquipmentZoneSettings)
        .filter(
            EquipmentZoneSettings.project_id == project_id,
            EquipmentZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"detail": "Settings reset to defaults"}


@router.put("/settings/{camera_id}", status_code=200)
def upsert_camera_equipment_settings(
    project_id: int,
    camera_id: int,
    body: EquipmentZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update per-camera equipment settings override."""
    _require_member(project_id, user, db)
    from ...models.equipment_zone_settings import EquipmentZoneSettings
    from ...schemas.equipment_settings import EquipmentZoneSettingsResponse
    row = (
        db.query(EquipmentZoneSettings)
        .filter(
            EquipmentZoneSettings.project_id == project_id,
            EquipmentZoneSettings.camera_id == camera_id,
        )
        .first()
    )
    if row is None:
        row = EquipmentZoneSettings(project_id=project_id, camera_id=camera_id)
        db.add(row)
    _apply_settings(row, body)
    db.commit()
    db.refresh(row)
    return EquipmentZoneSettingsResponse.model_validate(row)


# ── Settings helpers ──────────────────────────────────────────────────────────

def _apply_settings(row, body: EquipmentZoneSettingsUpdateBody) -> None:
    if body.expected_equipment_count     is not None: row.expected_equipment_count     = body.expected_equipment_count
    if body.max_equipment_count          is not None: row.max_equipment_count          = body.max_equipment_count
    if body.idle_alert_threshold_minutes is not None: row.idle_alert_threshold_minutes = body.idle_alert_threshold_minutes
    if body.overuse_threshold_hours      is not None: row.overuse_threshold_hours      = body.overuse_threshold_hours
    if body.min_workers_alongside        is not None: row.min_workers_alongside        = body.min_workers_alongside
    if body.alert_sensitivity            is not None: row.alert_sensitivity            = body.alert_sensitivity
    if body.confirm_frames               is not None: row.confirm_frames               = body.confirm_frames
