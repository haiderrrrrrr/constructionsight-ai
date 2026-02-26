"""
Workforce Analytics REST + SSE + MJPEG endpoints.

Prefix: /projects/{project_id}/workforce
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

router = APIRouter(prefix="/projects/{project_id}/workforce", tags=["workforce"])


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


# ── schemas ───────────────────────────────────────────────────────────────────

class AcknowledgePatch(BaseModel):
    pass  # no body needed — acknowledges by act of PATCH


# ── endpoints ─────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_workforce_summary(
    project_id: int,
    date_from:  Optional[str] = Query(None),
    date_to:    Optional[str] = Query(None),
    camera_id:  Optional[int] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    High-level workforce stats for the given date range (defaults to today).
    Aggregates across all cameras in the project.
    """
    from ...models.workforce_snapshot import WorkforceSnapshot
    from ...models.workforce_alert import WorkforceAlert
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)

    camera_ids = _get_project_camera_ids(project_id, db)
    # When a specific camera is requested, restrict all queries to that camera
    scoped_camera_ids = [camera_id] if (camera_id and camera_id in camera_ids) else camera_ids

    # Total workers today = max worker_count snapshot in range (per camera, then sum)
    total_workers_today = 0
    peak_worker_count   = 0
    utilization_scores  = []
    avg_dwell_list      = []
    idle_ratio_list     = []

    if scoped_camera_ids:
        snap_q = (
            db.query(
                WorkforceSnapshot.camera_id,
                func.max(WorkforceSnapshot.worker_count).label("peak"),
                func.avg(WorkforceSnapshot.utilization_score).label("avg_util"),
                func.avg(WorkforceSnapshot.avg_dwell_seconds).label("avg_dwell"),
                func.avg(
                    case(
                        (WorkforceSnapshot.worker_count > 0,
                         WorkforceSnapshot.idle_count * 100.0 / WorkforceSnapshot.worker_count),
                        else_=literal(0.0),
                    )
                ).label("avg_idle_ratio"),
            )
            .filter(
                WorkforceSnapshot.project_id == project_id,
                WorkforceSnapshot.camera_id.in_(scoped_camera_ids),
                WorkforceSnapshot.recorded_at >= dt_from,
                WorkforceSnapshot.recorded_at <= dt_to,
            )
            .group_by(WorkforceSnapshot.camera_id)
        )
        rows = snap_q.all()
        for r in rows:
            total_workers_today += r.peak or 0
            if r.peak and r.peak > peak_worker_count:
                peak_worker_count = r.peak
            if r.avg_util is not None:
                utilization_scores.append(float(r.avg_util))
            if r.avg_dwell is not None:
                avg_dwell_list.append(float(r.avg_dwell))
            if r.avg_idle_ratio is not None:
                idle_ratio_list.append(float(r.avg_idle_ratio))

    avg_utilization = round(sum(utilization_scores) / len(utilization_scores), 1) if utilization_scores else 0.0
    avg_dwell_secs  = round(sum(avg_dwell_list) / len(avg_dwell_list), 1) if avg_dwell_list else 0.0
    avg_idle_ratio  = round(sum(idle_ratio_list) / len(idle_ratio_list), 1) if idle_ratio_list else 0.0

    alert_base_q = db.query(func.count(WorkforceAlert.id)).filter(
        WorkforceAlert.project_id == project_id,
        WorkforceAlert.triggered_at >= dt_from,
        WorkforceAlert.triggered_at <= dt_to,
    )
    if camera_id and camera_id in camera_ids:
        alert_base_q = alert_base_q.filter(WorkforceAlert.camera_id == camera_id)

    understaffed_alerts = (
        alert_base_q.filter(WorkforceAlert.alert_type == "understaffed").scalar() or 0
    )
    idle_alerts = (
        alert_base_q.filter(WorkforceAlert.alert_type == "idle_ratio_high").scalar() or 0
    )
    congestion_events = (
        alert_base_q.filter(WorkforceAlert.alert_type == "overload").scalar() or 0
    )

    open_alerts         = (alert_base_q.filter(WorkforceAlert.status == "open").scalar() or 0)
    acknowledged_alerts = (alert_base_q.filter(WorkforceAlert.status == "acknowledged").scalar() or 0)
    resolved_alerts     = (alert_base_q.filter(WorkforceAlert.status == "resolved").scalar() or 0)

    # open_alerts_total: all currently open alerts regardless of date — identical to PPE's
    # open_incidents field. Used by the "Active Insights" KPI card in live mode so the
    # count reflects the project's full live state, not just the current session window.
    _open_total_q = db.query(func.count(WorkforceAlert.id)).filter(
        WorkforceAlert.project_id == project_id,
        WorkforceAlert.status == "open",
    )
    if camera_id and camera_id in camera_ids:
        _open_total_q = _open_total_q.filter(WorkforceAlert.camera_id == camera_id)
    open_alerts_total = _open_total_q.scalar() or 0

    cameras_total  = len(camera_ids)
    cameras_online = 0
    if camera_ids:
        from ...models.camera import Camera
        cameras_online = (
            db.query(func.count(Camera.id))
            .filter(Camera.id.in_(camera_ids), Camera.worker_status == "running")
            .scalar() or 0
        )

    return {
        "total_workers_today":       total_workers_today,
        "peak_worker_count":         peak_worker_count,
        "avg_utilization":           avg_utilization,
        "avg_dwell_seconds":         avg_dwell_secs,
        "avg_idle_ratio":            avg_idle_ratio,
        "understaffed_alerts_today": understaffed_alerts,
        "idle_alerts_today":         idle_alerts,
        "congestion_events":         congestion_events,
        "open_alerts":               open_alerts,
        "open_alerts_total":         open_alerts_total,
        "acknowledged_alerts":       acknowledged_alerts,
        "resolved_alerts":           resolved_alerts,
        "cameras_online":            cameras_online,
        "cameras_total":             cameras_total,
    }


@router.get("/trend")
def get_workforce_trend(
    project_id: int,
    date_from:  Optional[str]  = Query(None),
    date_to:    Optional[str]  = Query(None),
    camera_id:  Optional[int]  = Query(None),
    per_camera: bool           = Query(False),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Minute-bucketed (≤2h) or hourly (wider) workforce trend for the project.
    per_camera=true → returns one row per (camera_id, bucket) with camera_id,
    zone_name and avg_dwell_seconds included — used by the scatter chart.
    """
    from ...models.workforce_snapshot import WorkforceSnapshot

    _require_member(project_id, user, db)
    dt_from, dt_to = _parse_date_range(date_from, date_to)
    span_hours = (dt_to - dt_from).total_seconds() / 3600
    trunc_unit = "minute" if span_hours <= 2 else ("hour" if span_hours <= 48 else "day")

    bucket_col = func.date_trunc(trunc_unit, WorkforceSnapshot.recorded_at).label("bucket")

    if per_camera:
        # Group by (camera_id, bucket) — returns one row per camera per time bucket
        q = (
            db.query(
                bucket_col,
                WorkforceSnapshot.camera_id,
                WorkforceSnapshot.zone_name,
                func.avg(WorkforceSnapshot.worker_count).label("avg_workers"),
                func.avg(WorkforceSnapshot.utilization_score).label("avg_util"),
                func.avg(WorkforceSnapshot.avg_dwell_seconds).label("avg_dwell"),
                func.max(WorkforceSnapshot.zone_status).label("zone_status"),
                func.avg(
                    case(
                        (WorkforceSnapshot.worker_count > 0,
                         WorkforceSnapshot.idle_count * 100.0 / WorkforceSnapshot.worker_count),
                        else_=literal(0.0),
                    )
                ).label("avg_idle_ratio"),
            )
            .filter(
                WorkforceSnapshot.project_id == project_id,
                WorkforceSnapshot.recorded_at >= dt_from,
                WorkforceSnapshot.recorded_at <= dt_to,
            )
        )
        if camera_id is not None:
            q = q.filter(WorkforceSnapshot.camera_id == camera_id)
        rows = (
            q.group_by(
                func.date_trunc(trunc_unit, WorkforceSnapshot.recorded_at),
                WorkforceSnapshot.camera_id,
                WorkforceSnapshot.zone_name,
            )
            .order_by(func.date_trunc(trunc_unit, WorkforceSnapshot.recorded_at))
            .all()
        )
        return [
            {
                "recorded_at":     row.bucket.isoformat() if row.bucket else None,
                "camera_id":       row.camera_id,
                "zone_name":       row.zone_name,
                "avg_workers":     round(float(row.avg_workers), 1)    if row.avg_workers    else 0,
                "avg_utilization": round(float(row.avg_util), 1)       if row.avg_util       else 0.0,
                "avg_dwell":       round(float(row.avg_dwell), 1)      if row.avg_dwell      else 0.0,
                "zone_status":     row.zone_status or "BALANCED",
                "avg_idle_ratio":  round(float(row.avg_idle_ratio), 1) if row.avg_idle_ratio else 0.0,
            }
            for row in rows
        ]

    # Default: project aggregate per time bucket
    q = (
        db.query(
            bucket_col,
            func.avg(WorkforceSnapshot.worker_count).label("avg_workers"),
            func.avg(WorkforceSnapshot.utilization_score).label("avg_util"),
            func.avg(WorkforceSnapshot.avg_dwell_seconds).label("avg_dwell"),
            func.max(WorkforceSnapshot.zone_status).label("zone_status"),
        )
        .filter(
            WorkforceSnapshot.project_id == project_id,
            WorkforceSnapshot.recorded_at >= dt_from,
            WorkforceSnapshot.recorded_at <= dt_to,
        )
    )
    if camera_id is not None:
        q = q.filter(WorkforceSnapshot.camera_id == camera_id)
    rows = (
        q.group_by(func.date_trunc(trunc_unit, WorkforceSnapshot.recorded_at))
        .order_by(func.date_trunc(trunc_unit, WorkforceSnapshot.recorded_at))
        .all()
    )
    return [
        {
            "recorded_at":     row.bucket.isoformat() if row.bucket else None,
            "avg_workers":     round(float(row.avg_workers), 1) if row.avg_workers else 0,
            "avg_utilization": round(float(row.avg_util), 1)    if row.avg_util    else 0.0,
            "avg_dwell":       round(float(row.avg_dwell), 1)   if row.avg_dwell   else 0.0,
            "zone_status":     row.zone_status or "BALANCED",
        }
        for row in rows
    ]


@router.get("/cameras")
def get_workforce_cameras(
    project_id: int,
    date_from: Optional[str] = Query(None),
    date_to:   Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    Latest workforce metrics per camera in the project (from last snapshot).
    """
    from ...models.workforce_snapshot import WorkforceSnapshot
    from ...models.workforce_alert import WorkforceAlert
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera
    from sqlalchemy import select

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    pc_map = {pc.camera_id: pc for pc in pcs}

    cameras = db.query(Camera).filter(Camera.id.in_(camera_ids)).all()
    camera_map = {c.id: c for c in cameras}

    open_alert_q = db.query(WorkforceAlert.camera_id, func.count(WorkforceAlert.id)).filter(
        WorkforceAlert.project_id == project_id,
        WorkforceAlert.status == "open",
    )
    if date_from or date_to:
        dt_from, dt_to = _parse_date_range(date_from, date_to)
        open_alert_q = open_alert_q.filter(
            WorkforceAlert.triggered_at >= dt_from,
            WorkforceAlert.triggered_at <= dt_to,
        )
    open_alert_rows = open_alert_q.group_by(WorkforceAlert.camera_id).all()
    open_alerts_map = {row[0]: row[1] for row in open_alert_rows}

    result = []
    for cam_id in camera_ids:
        cam = camera_map.get(cam_id)
        pc  = pc_map.get(cam_id)

        # Latest snapshot for this camera
        latest = (
            db.query(WorkforceSnapshot)
            .filter(
                WorkforceSnapshot.project_id == project_id,
                WorkforceSnapshot.camera_id  == cam_id,
            )
            .order_by(WorkforceSnapshot.recorded_at.desc())
            .first()
        )

        sparkline = []
        if latest and latest.sparkline_json:
            try:
                sparkline = json.loads(latest.sparkline_json)
            except (ValueError, TypeError):
                sparkline = []

        result.append({
            "camera_id":           cam_id,
            "camera_name":         cam.name if cam else f"Camera #{cam_id}",
            "zone_name":           latest.zone_name if latest else None,
            "latest_worker_count": latest.worker_count if latest else 0,
            "active_count":        latest.active_count if latest else 0,
            "idle_count":          latest.idle_count if latest else 0,
            "latest_utilization":  latest.utilization_score if latest else 0.0,
            "latest_zone_status":  latest.zone_status if latest else "BALANCED",
            "congestion_flag":     latest.congestion_flag if latest else False,
            "avg_dwell_seconds":   latest.avg_dwell_seconds if latest else 0.0,
            "open_alerts":         open_alerts_map.get(cam_id, 0),
            "sparkline":           sparkline,
            "last_snapshot_at":    latest.recorded_at.isoformat() if latest and latest.recorded_at else None,
        })

    return result


@router.get("/live")
def get_workforce_live(
    project_id: int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """
    In-memory live metrics from all running WorkforceProcessors in this project.
    Also computes rule-based optimization recommendations.
    Returns:
      {cameras: [...], project_totals: {...}, recommendations: [...]}
    """
    from ...models.project_camera import ProjectCamera
    from ...models.camera import Camera
    from ...services.workforce_analytics import get_all_processors

    _require_member(project_id, user, db)

    pcs = db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
    camera_ids = [pc.camera_id for pc in pcs]
    cameras = {c.id: c for c in db.query(Camera).filter(Camera.id.in_(camera_ids)).all()}

    all_processors = get_all_processors()
    cameras_data = []

    for cam_id in camera_ids:
        proc = all_processors.get(cam_id)
        if proc is None or proc.project_id != project_id:
            continue
        m = proc.get_latest_metrics()
        if m is None:
            continue
        cam = cameras.get(cam_id)
        cameras_data.append({
            "camera_id":        cam_id,
            "camera_name":      cam.name if cam else None,
            "zone_name":        m.get("zone_name"),
            "total":            m.get("total", 0),
            "active_count":     m.get("active_count", 0),
            "idle_count":       m.get("idle_count", 0),
            "entering_count":   m.get("entering_count", 0),
            "active_ratio":     m.get("active_ratio", 0.0),
            "utilization_score": m.get("utilization_score", 0),
            "zone_status":      m.get("zone_status", "BALANCED"),
            "congestion_flag":  m.get("congestion_flag", False),
            "avg_dwell_seconds": m.get("avg_dwell_seconds", 0.0),
            "sparkline":        m.get("sparkline", []),
        })

    # Project-level totals
    total    = sum(c["total"] for c in cameras_data)
    active   = sum(c["active_count"] for c in cameras_data)
    idle     = sum(c["idle_count"] for c in cameras_data)
    util_avg = (
        round(sum(c["utilization_score"] for c in cameras_data) / len(cameras_data), 1)
        if cameras_data else 0.0
    )

    # Rule-based recommendations
    recs = []
    for c in cameras_data:
        zone = c["zone_name"] or f"Camera {c['camera_id']}"
        if c["zone_status"] == "UNDERSTAFFED":
            recs.append(
                f"Zone '{zone}' appears understaffed ({c['total']} workers). "
                "Consider assigning more."
            )
        if c["active_ratio"] < 0.4 and c["total"] > 0:
            idle_pct = round((1 - c["active_ratio"]) * 100)
            recs.append(
                f"High idle concentration in '{zone}' ({idle_pct}% idle). "
                "Review task assignment."
            )
        if c["congestion_flag"]:
            recs.append(
                f"Congestion risk in '{zone}' ({c['total']} workers). "
                "Redistribute if possible."
            )

    overloaded   = [c for c in cameras_data if c["congestion_flag"]]
    understaffed = [c for c in cameras_data if c["zone_status"] == "UNDERSTAFFED"]
    if overloaded and understaffed:
        recs.append(
            f"Consider moving workers from '{overloaded[0]['zone_name'] or 'overloaded zone'}' "
            f"to '{understaffed[0]['zone_name'] or 'understaffed zone'}'."
        )

    if not recs:
        recs.append("All zones balanced. Workforce utilization is optimal.")

    return {
        "cameras": cameras_data,
        "project_totals": {
            "total":            total,
            "active":           active,
            "idle":             idle,
            "avg_utilization":  util_avg,
        },
        "recommendations": recs,
    }


@router.get("/alerts")
def list_workforce_alerts(
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
    """Paginated workforce alert list with optional filters."""
    from ...models.workforce_alert import WorkforceAlert
    from ...models.camera import Camera

    _require_member(project_id, user, db)

    q = (
        db.query(WorkforceAlert, Camera.name.label("camera_name"))
          .outerjoin(Camera, Camera.id == WorkforceAlert.camera_id)
          .filter(WorkforceAlert.project_id == project_id)
    )
    if camera_id is not None:
        q = q.filter(WorkforceAlert.camera_id == camera_id)
    if status:
        q = q.filter(WorkforceAlert.status == status)
    if alert_type:
        q = q.filter(WorkforceAlert.alert_type == alert_type)
    if severity:
        q = q.filter(WorkforceAlert.severity == severity)
    if acknowledged is not None:
        q = q.filter(WorkforceAlert.acknowledged == acknowledged)
    if date_from:
        try:
            q = q.filter(WorkforceAlert.triggered_at >= datetime.fromisoformat(date_from.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from")
    if date_to:
        try:
            q = q.filter(WorkforceAlert.triggered_at <= datetime.fromisoformat(date_to.replace("Z", "+00:00")))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to")

    total = q.count()
    rows = q.order_by(WorkforceAlert.triggered_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

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
                "worker_id":       a.worker_id,
                "triggered_at":    a.triggered_at.isoformat() if a.triggered_at else None,
                "acknowledged":    a.acknowledged,
                "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
                "snapshot_url":    a.snapshot_url,
                "status":          a.status,
            }
            for a, cam_name in rows
        ],
    }


@router.patch("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    project_id: int,
    alert_id:   int,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Acknowledge a workforce alert."""
    from ...models.workforce_alert import WorkforceAlert

    _require_member(project_id, user, db)

    alert = (
        db.query(WorkforceAlert)
        .filter(WorkforceAlert.id == alert_id, WorkforceAlert.project_id == project_id)
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
def update_alert_status(
    project_id: int,
    alert_id:   int,
    body:       dict,
    db: Session = Depends(get_db),
    user: User  = Depends(get_current_user),
):
    """Update workforce alert status: open → acknowledged → resolved."""
    from ...models.workforce_alert import WorkforceAlert

    _require_member(project_id, user, db)

    new_status = body.get("status", "")
    if new_status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be 'acknowledged' or 'resolved'")

    alert = (
        db.query(WorkforceAlert)
        .filter(WorkforceAlert.id == alert_id, WorkforceAlert.project_id == project_id)
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

    # Broadcast SSE event so every tab/window/account updates the alerts table
    # without polling. Carries open_alerts so summary KPI cards stay in sync too.
    try:
        from ...services.workforce_dashboard_broker import push as wf_broker_push
        open_count = (
            db.query(func.count(WorkforceAlert.id))
              .filter(
                  WorkforceAlert.project_id == project_id,
                  WorkforceAlert.status     == "open",
              )
              .scalar() or 0
        )
        wf_broker_push(project_id, {
            "type":        "workforce_alert_updated",
            "alert_id":    alert.id,
            "status":      alert.status,
            "open_alerts": int(open_count),
        })
    except Exception:
        pass  # non-critical — table will still reflect on next user interaction / fallback poll

    return {
        "id":           alert.id,
        "status":       alert.status,
        "acknowledged": alert.acknowledged,
    }


# ── SSE: real-time workforce stats stream ─────────────────────────────────────

@router.get("/stream")
async def workforce_stream(
    project_id: int,
    token: str = Query(...),
    db: Session = Depends(get_db),
):
    """
    SSE stream for the Workforce Analytics dashboard.
    Events: workforce_stats_update | workforce_alert | heartbeat
    Auth via ?token= because browser EventSource cannot send headers.
    """
    import asyncio
    from ...core.security import decode_access_token
    from ...services.workforce_dashboard_broker import register, unregister
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


# ── MJPEG: workforce overlay video stream ─────────────────────────────────────
# No auth required — same pattern as PPE MJPEG stream at /stream/{camera_id}.
# Camera ownership is validated via project_id + camera_id.

@router.get("/stream/{camera_id}")
async def workforce_video_stream(
    project_id: int,
    camera_id:  int,
    db: Session = Depends(get_db),
):
    """MJPEG stream of the workforce-overlaid camera feed (no auth, like PPE stream)."""
    import asyncio
    import cv2
    import time as _time_module
    import numpy as _np

    # Verify this camera belongs to the project
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
        _workforce_annotated,
        _workforce_standalone_pipelines,
        _workforce_standalone_lock,
        _camera_captures,
    )

    async def mjpeg_generator():
        boundary = b"--frame"
        last_seq  = -1

        def _get_raw_frame():
            """Return latest raw frame from standalone pipeline, or shared capture (PPE running), or None."""
            with _workforce_standalone_lock:
                p = _workforce_standalone_pipelines.get(camera_id)
            if p is not None:
                fresh = p.get("fresh")
                if fresh is not None:
                    with fresh["lock"]:
                        frame = fresh.get("frame")
                    if frame is not None:
                        return frame
            # Fallback: PPE pipeline is running and owns the shared capture
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
            entry = _workforce_annotated.get(camera_id)
            annotated_frame = None
            seq = last_seq  # default: treat as unchanged
            if entry is not None:
                lock = entry.get("lock")
                if lock is not None:
                    with lock:
                        annotated_frame = entry.get("frame")
                        seq = entry.get("seq", last_seq)

            if annotated_frame is not None and seq != last_seq:
                # Annotated frame ready — stream it
                chunk = _encode_and_yield(annotated_frame)
                if chunk:
                    last_seq = seq
                    inference_started = True
                    any_frame_yielded = True
                    yield chunk
                await asyncio.sleep(0.033)
            elif not inference_started:
                # Inference hasn't produced its first frame yet — show raw feed.
                # Once inference starts we never come back here, eliminating flicker.
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
                # Inference running, waiting for next annotated frame
                await asyncio.sleep(0.01)

    from fastapi.responses import StreamingResponse as _SR
    return _SR(
        mjpeg_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── PM Workforce Settings ─────────────────────────────────────────────────────

class WorkforceZoneSettingsUpdateBody(BaseModel):
    required_workers:             Optional[int] = None
    max_workers:                  Optional[int] = None
    idle_alert_threshold:         Optional[int] = None
    alert_sensitivity:            Optional[str] = None
    understaffed_confirm_samples: Optional[int] = None
    overload_confirm_seconds:     Optional[int] = None


@router.get("/settings", response_model=list)
def get_workforce_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get project-level and per-camera workforce settings for a project."""
    _require_member(project_id, user, db)
    from ...models.workforce_zone_settings import WorkforceZoneSettings
    from ...schemas.workforce_settings import WorkforceZoneSettingsResponse
    rows = (
        db.query(WorkforceZoneSettings)
        .filter(WorkforceZoneSettings.project_id == project_id)
        .order_by(WorkforceZoneSettings.camera_id.nullsfirst())
        .all()
    )
    return [WorkforceZoneSettingsResponse.model_validate(r) for r in rows]


@router.patch("/settings", status_code=200)
def upsert_workforce_settings(
    project_id: int,
    body: WorkforceZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update project-level workforce settings (camera_id=None)."""
    _require_member(project_id, user, db)
    from ...models.workforce_zone_settings import WorkforceZoneSettings
    from ...schemas.workforce_settings import WorkforceZoneSettingsResponse
    row = (
        db.query(WorkforceZoneSettings)
        .filter(
            WorkforceZoneSettings.project_id == project_id,
            WorkforceZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row is None:
        row = WorkforceZoneSettings(project_id=project_id, camera_id=None)
        db.add(row)
    _apply_settings(row, body)
    db.commit()
    db.refresh(row)

    # Hot-reload: push the merged cfg into any running WorkforceProcessor for this project
    try:
        from ...services.workforce_analytics import get_processor
        from ...services.feature_branches.workforce_branch import _build_merged_cfg
        from ...models.project_camera import ProjectCamera
        camera_ids = [
            pc.camera_id
            for pc in db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()
        ]
        for cid in camera_ids:
            proc = get_processor(cid)
            if proc and proc.is_running():
                new_cfg = _build_merged_cfg(db, project_id)
                proc.update_config(new_cfg)
    except Exception:
        pass  # best-effort; next feature restart will pick up the new values

    return WorkforceZoneSettingsResponse.model_validate(row)


@router.delete("/settings", status_code=200)
def reset_workforce_settings(
    project_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete project-level workforce settings row, restoring factory defaults on next start."""
    _require_member(project_id, user, db)
    from ...models.workforce_zone_settings import WorkforceZoneSettings
    row = (
        db.query(WorkforceZoneSettings)
        .filter(
            WorkforceZoneSettings.project_id == project_id,
            WorkforceZoneSettings.camera_id.is_(None),
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return {"detail": "Settings reset to defaults"}


@router.put("/settings/{camera_id}", status_code=200)
def upsert_camera_workforce_settings(
    project_id: int,
    camera_id: int,
    body: WorkforceZoneSettingsUpdateBody,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create or update per-camera workforce settings override."""
    _require_member(project_id, user, db)
    from ...models.workforce_zone_settings import WorkforceZoneSettings
    from ...schemas.workforce_settings import WorkforceZoneSettingsResponse
    row = (
        db.query(WorkforceZoneSettings)
        .filter(
            WorkforceZoneSettings.project_id == project_id,
            WorkforceZoneSettings.camera_id == camera_id,
        )
        .first()
    )
    if row is None:
        row = WorkforceZoneSettings(project_id=project_id, camera_id=camera_id)
        db.add(row)
    _apply_settings(row, body)
    db.commit()
    db.refresh(row)
    return WorkforceZoneSettingsResponse.model_validate(row)


# ── Settings helpers ──────────────────────────────────────────────────────────

def _apply_settings(row, body: WorkforceZoneSettingsUpdateBody) -> None:
    if body.required_workers             is not None: row.required_workers             = body.required_workers
    if body.max_workers                  is not None: row.max_workers                  = body.max_workers
    if body.idle_alert_threshold         is not None: row.idle_alert_threshold         = body.idle_alert_threshold
    if body.alert_sensitivity            is not None: row.alert_sensitivity            = body.alert_sensitivity
    if body.understaffed_confirm_samples is not None: row.understaffed_confirm_samples = body.understaffed_confirm_samples
    if body.overload_confirm_seconds     is not None: row.overload_confirm_seconds     = body.overload_confirm_seconds
