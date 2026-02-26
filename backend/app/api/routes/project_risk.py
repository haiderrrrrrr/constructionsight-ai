"""
Risk Analytics REST + SSE endpoints.
Prefix: /projects/{project_id}/risk
Auth:   get_current_user + active membership check
"""
from __future__ import annotations

import json
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db
from ...models.user import User

router = APIRouter(prefix="/projects/{project_id}/risk", tags=["risk"])


# ── Helpers ───────────────────────────────────────────────────────────────────

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


def _get_camera_ids(project_id: int, db: Session) -> list[int]:
    from ...models.project_camera import ProjectCamera
    return [pc.camera_id for pc in db.query(ProjectCamera).filter(ProjectCamera.project_id == project_id).all()]


def _latest_snapshot_per_zone(project_id: int, db: Session) -> list:
    """Return the most recent RiskSnapshot per camera_id for this project (all cameras, including deregistered)."""
    from ...models.risk_snapshot import RiskSnapshot
    from sqlalchemy import func

    subq = (
        db.query(
            RiskSnapshot.camera_id,
            func.max(RiskSnapshot.recorded_at).label("max_at"),
        )
        .filter(RiskSnapshot.project_id == project_id)
        .group_by(RiskSnapshot.camera_id)
        .subquery()
    )
    return (
        db.query(RiskSnapshot)
        .join(
            subq,
            (RiskSnapshot.camera_id == subq.c.camera_id) &
            (RiskSnapshot.recorded_at == subq.c.max_at),
        )
        .filter(RiskSnapshot.project_id == project_id)
        .all()
    )


def _snap_to_zone_dict(snap, extra_recs: list | None = None) -> dict:
    factors = json.loads(snap.factors_json or "[]")
    return {
        "camera_id":                snap.camera_id,
        "zone_id":                  snap.zone_id,
        "zone_name":                snap.zone_name or f"Camera {snap.camera_id}",
        "overall_risk":             snap.overall_risk,
        "delay_risk":               snap.delay_risk,
        "safety_risk":              snap.safety_risk,
        "productivity_risk":        snap.productivity_risk,
        "risk_level":               snap.risk_level,
        "trend":                    snap.trend,
        "momentum":                 snap.momentum,
        "compound_risk_flag":       snap.compound_risk_flag,
        "factors":                  factors,
        "prediction_risk":          snap.prediction_risk,
        "prediction_window_minutes": snap.prediction_window_minutes,
        "recommendations":          extra_recs or [],
        "recorded_at":              snap.recorded_at.isoformat() if snap.recorded_at else None,
        "weather_condition":        snap.weather_condition,
        "weather_temp":             snap.weather_temp,
        "weather_wind":             snap.weather_wind,
        "weather_rain":             snap.weather_rain,
    }


def _build_active_signals(zones: list) -> list[str]:
    signals = set()
    for z in zones:
        for f in z.get("factors", []):
            source = f.get("source", "")
            if source == "activity":
                signals.add("Idle")
            elif source == "workforce":
                signals.add("Workforce")
            elif source == "ppe":
                signals.add("PPE")
            elif source == "weather":
                cond = f.get("factor", "").lower()
                if "rain" in cond:
                    signals.add("Rain")
                elif "wind" in cond:
                    signals.add("Wind")
                else:
                    signals.add("Weather")
    return sorted(signals)


# ── GET /summary ──────────────────────────────────────────────────────────────

@router.get("/summary")
def get_risk_summary(
    project_id: int,
    user: User = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    _require_member(project_id, user, db)

    snapshots = _latest_snapshot_per_zone(project_id, db)
    zones_out = [_snap_to_zone_dict(s) for s in snapshots]

    def _p95(vals: list[float]) -> float:
        if not vals:
            return 0.0
        vs = sorted(vals)
        if len(vs) <= 2:
            return float(vs[-1])
        idx = int(math.ceil(0.95 * (len(vs) - 1)))
        return float(vs[idx])

    overall_risks = [float(z["overall_risk"] or 0.0) for z in zones_out]
    overall_max = max(overall_risks) if overall_risks else 0.0
    overall_avg = (sum(overall_risks) / len(overall_risks)) if overall_risks else 0.0
    overall_p95 = _p95(overall_risks)
    project_overall = overall_p95

    if project_overall >= 75:
        risk_level = "critical"
    elif project_overall >= 50:
        risk_level = "high"
    elif project_overall >= 25:
        risk_level = "moderate"
    else:
        risk_level = "low"

    high_risk  = [z for z in zones_out if z["risk_level"] in ("high", "critical")]
    critical   = [z for z in zones_out if z["risk_level"] == "critical"]

    # Best prediction among rising zones
    delay_prob = None
    for z in zones_out:
        if z.get("prediction_risk") and z["trend"] == "rising":
            delay_prob = z["prediction_risk"]
            break

    active_signals = _build_active_signals(zones_out)

    # Return cached weather instantly; if cache cold, fetch in background and return None this call
    import threading as _th
    from ...services.weather_service import get_weather, _CACHE, _resolve_city
    from ...models.project import Project
    project = db.query(Project).filter(Project.id == project_id).first()
    weather = None
    if project and project.location:
        candidates = _resolve_city(project.location)
        cached = _CACHE.get(candidates[0].lower())
        if cached:
            weather = cached["data"]
        else:
            _th.Thread(target=get_weather, args=(project.location,), daemon=True).start()

    # Open alerts from all 3 features — from project start_date to now, per camera and total
    # camera_ids still needed for active_signals / scheduler context; per_cam uses all snapshot zones
    camera_ids = _get_camera_ids(project_id, db)
    open_alerts_ppe = 0
    open_alerts_wf  = 0
    open_alerts_act = 0
    # per-camera counts keyed by all zone camera IDs (including deregistered)
    all_zone_cam_ids = [z["camera_id"] for z in zones_out if z.get("camera_id")]
    per_cam: dict[int, dict] = {cid: {"ppe": 0, "wf": 0, "act": 0} for cid in all_zone_cam_ids}
    start_cutoff = None
    if project and project.start_date:
        sd = project.start_date
        start_cutoff = datetime(sd.year, sd.month, sd.day, tzinfo=timezone.utc)

    # Totals use project_id (matches report); per-camera breakdown uses camera_ids for zone table
    try:
        from ...models.ppe_incident import PpeIncident
        from sqlalchemy import func as _func
        # Project-scoped total
        q_total = db.query(_func.count(PpeIncident.id)).filter(
            PpeIncident.project_id == project_id,
            PpeIncident.status == "open",
        )
        if start_cutoff:
            q_total = q_total.filter(PpeIncident.started_at >= start_cutoff)
        open_alerts_ppe = q_total.scalar() or 0
        # Per-camera for zone breakdown — all zones in this project (including deregistered cameras)
        if all_zone_cam_ids:
            q_cam = db.query(PpeIncident.camera_id, _func.count(PpeIncident.id)).filter(
                PpeIncident.project_id == project_id,
                PpeIncident.camera_id.in_(all_zone_cam_ids),
                PpeIncident.status == "open",
            )
            if start_cutoff:
                q_cam = q_cam.filter(PpeIncident.started_at >= start_cutoff)
            for cam_id, cnt in q_cam.group_by(PpeIncident.camera_id).all():
                if cam_id in per_cam:
                    per_cam[cam_id]["ppe"] = cnt
    except Exception:
        pass

    try:
        from ...models.workforce_alert import WorkforceAlert
        from sqlalchemy import func as _func
        q_total = db.query(_func.count(WorkforceAlert.id)).filter(
            WorkforceAlert.project_id == project_id,
            WorkforceAlert.status == "open",
        )
        if start_cutoff:
            q_total = q_total.filter(WorkforceAlert.triggered_at >= start_cutoff)
        open_alerts_wf = q_total.scalar() or 0
        if all_zone_cam_ids:
            q_cam = db.query(WorkforceAlert.camera_id, _func.count(WorkforceAlert.id)).filter(
                WorkforceAlert.project_id == project_id,
                WorkforceAlert.camera_id.in_(all_zone_cam_ids),
                WorkforceAlert.status == "open",
            )
            if start_cutoff:
                q_cam = q_cam.filter(WorkforceAlert.triggered_at >= start_cutoff)
            for cam_id, cnt in q_cam.group_by(WorkforceAlert.camera_id).all():
                if cam_id in per_cam:
                    per_cam[cam_id]["wf"] = cnt
    except Exception:
        pass

    try:
        from ...models.activity_alert import ActivityAlert
        from sqlalchemy import func as _func
        q_total = db.query(_func.count(ActivityAlert.id)).filter(
            ActivityAlert.project_id == project_id,
            ActivityAlert.status == "open",
        )
        if start_cutoff:
            q_total = q_total.filter(ActivityAlert.triggered_at >= start_cutoff)
        open_alerts_act = q_total.scalar() or 0
        if all_zone_cam_ids:
            q_cam = db.query(ActivityAlert.camera_id, _func.count(ActivityAlert.id)).filter(
                ActivityAlert.project_id == project_id,
                ActivityAlert.camera_id.in_(all_zone_cam_ids),
                ActivityAlert.status == "open",
            )
            if start_cutoff:
                q_cam = q_cam.filter(ActivityAlert.triggered_at >= start_cutoff)
            for cam_id, cnt in q_cam.group_by(ActivityAlert.camera_id).all():
                if cam_id in per_cam:
                    per_cam[cam_id]["act"] = cnt
    except Exception:
        pass

    # Aggregate per_cam counts by zone_name so cameras replaced in the same zone are summed together
    zone_name_counts: dict[str, dict] = {}
    for cid, counts in per_cam.items():
        zname = next((z["zone_name"] for z in zones_out if z.get("camera_id") == cid), f"Camera {cid}")
        if zname not in zone_name_counts:
            zone_name_counts[zname] = {"ppe": 0, "wf": 0, "act": 0}
        zone_name_counts[zname]["ppe"] += counts["ppe"]
        zone_name_counts[zname]["wf"]  += counts["wf"]
        zone_name_counts[zname]["act"] += counts["act"]

    # Deduplicate zones_out by zone_name — keep the snapshot with the highest overall_risk
    seen_zones: dict[str, dict] = {}
    for z in zones_out:
        zname = z.get("zone_name") or f"Camera {z.get('camera_id')}"
        if zname not in seen_zones or (z.get("overall_risk") or 0) > (seen_zones[zname].get("overall_risk") or 0):
            seen_zones[zname] = z
    zones_out = list(seen_zones.values())

    # Attach aggregated incident counts (all cameras that share this zone_name)
    for z in zones_out:
        zname = z.get("zone_name") or f"Camera {z.get('camera_id')}"
        counts = zone_name_counts.get(zname, {"ppe": 0, "wf": 0, "act": 0})
        z["open_incidents"] = counts["ppe"] + counts["wf"] + counts["act"]
        z["open_incidents_breakdown"] = counts

    return {
        "overall_risk":     round(project_overall, 2),
        "overall_risk_max": round(overall_max, 2),
        "overall_risk_avg": round(overall_avg, 2),
        "overall_risk_p95": round(overall_p95, 2),
        "risk_level":       risk_level,
        "high_risk_count":  len(high_risk),
        "critical_count":   len(critical),
        "delay_probability": round(delay_prob, 2) if delay_prob else None,
        "active_signals":   active_signals,
        "weather":          weather,
        "zones":            zones_out,
        "open_alerts":      open_alerts_ppe + open_alerts_wf + open_alerts_act,
        "open_alerts_breakdown": {
            "ppe":       open_alerts_ppe,
            "workforce": open_alerts_wf,
            "activity":  open_alerts_act,
        },
    }


# ── GET /zones ────────────────────────────────────────────────────────────────

@router.get("/zones")
def get_risk_zones(
    project_id: int,
    user: User = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    _require_member(project_id, user, db)
    snapshots = _latest_snapshot_per_zone(project_id, db)
    return [_snap_to_zone_dict(s) for s in snapshots]


# ── GET /trend ────────────────────────────────────────────────────────────────

@router.get("/trend")
def get_risk_trend(
    project_id: int,
    hours:      int  = Query(24, ge=1, le=8760),
    from_start: bool = Query(False),
    zone_id:    Optional[int] = Query(None),
    user: User  = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    from ...models.risk_snapshot import RiskSnapshot
    from ...models.project import Project

    _require_member(project_id, user, db)

    if from_start:
        project = db.query(Project).filter(Project.id == project_id).first()
        start = project.start_date if project and project.start_date else None
        if start:
            # start_date may be date-only — make it timezone-aware
            if hasattr(start, "tzinfo") and start.tzinfo is None:
                from datetime import timezone as _tz
                import datetime as _dt
                start = _dt.datetime.combine(start, _dt.time.min).replace(tzinfo=_tz.utc)
            cutoff = start
        else:
            cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    else:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    q = (
        db.query(RiskSnapshot)
        .filter(
            RiskSnapshot.project_id == project_id,
            RiskSnapshot.recorded_at >= cutoff,
        )
        .order_by(RiskSnapshot.recorded_at.asc())
    )
    if zone_id:
        q = q.filter(RiskSnapshot.zone_id == zone_id)

    rows = q.all()

    # Downsample to max 200 points so the chart stays fast regardless of run count
    MAX_POINTS = 200
    if len(rows) > MAX_POINTS:
        step = len(rows) / MAX_POINTS
        rows = [rows[int(i * step)] for i in range(MAX_POINTS)]

    return [
        {
            "recorded_at":        r.recorded_at.isoformat(),
            "overall_risk":       r.overall_risk,
            "delay_risk":         r.delay_risk,
            "safety_risk":        r.safety_risk,
            "productivity_risk":  r.productivity_risk,
            "zone_id":            r.zone_id,
            "zone_name":          r.zone_name,
            "risk_level":         r.risk_level,
            "trend":              r.trend,
            "compound_risk_flag": r.compound_risk_flag,
        }
        for r in rows
    ]


# ── GET /events ───────────────────────────────────────────────────────────────

@router.get("/events")
def get_risk_events(
    project_id: int,
    page:       int = Query(1, ge=1),
    page_size:  int = Query(20, ge=1, le=100),
    severity:   Optional[str] = Query(None),
    status:     Optional[str] = Query(None),
    zone_id:    Optional[int] = Query(None),
    user: User  = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    from ...models.risk_event import RiskEvent

    _require_member(project_id, user, db)

    q = db.query(RiskEvent).filter(RiskEvent.project_id == project_id)
    if severity:
        q = q.filter(RiskEvent.severity == severity)
    if status:
        q = q.filter(RiskEvent.status == status)
    if zone_id:
        q = q.filter(RiskEvent.zone_id == zone_id)

    total  = q.count()
    events = q.order_by(RiskEvent.triggered_at.desc()).offset((page - 1) * page_size).limit(page_size).all()

    return {
        "total":    total,
        "page":     page,
        "per_page": page_size,
        "items": [
            {
                "id":                   e.id,
                "event_type":           e.event_type,
                "severity":             e.severity,
                "message":              e.message,
                "zone_name":            e.zone_name,
                "risk_score":           e.risk_score,
                "previous_risk_score":  e.previous_risk_score,
                "triggered_at":         e.triggered_at.isoformat(),
                "status":               e.status,
                "acknowledged":         e.acknowledged,
            }
            for e in events
        ],
    }


# ── PATCH /events/{event_id}/status ──────────────────────────────────────────

class EventStatusPatch(BaseModel):
    status: str  # acknowledged | resolved


@router.patch("/events/{event_id}/status")
def patch_risk_event_status(
    project_id: int,
    event_id:   int,
    body:       EventStatusPatch,
    user: User  = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    from ...models.risk_event import RiskEvent

    _require_member(project_id, user, db)

    event = db.query(RiskEvent).filter(
        RiskEvent.id == event_id,
        RiskEvent.project_id == project_id,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="Risk event not found")

    if body.status not in ("acknowledged", "resolved"):
        raise HTTPException(status_code=400, detail="status must be acknowledged or resolved")

    event.status = body.status
    if body.status == "acknowledged" and not event.acknowledged:
        event.acknowledged    = True
        event.acknowledged_at = datetime.now(timezone.utc)
        event.acknowledged_by = user.id

    db.commit()
    db.refresh(event)

    # Push update via SSE so all tabs patch their cache
    try:
        from ...services.risk_dashboard_broker import push as risk_push
        risk_push(project_id, {
            "type":     "risk_event_updated",
            "event_id": event.id,
            "status":   event.status,
        })
    except Exception:
        pass

    return {"id": event.id, "status": event.status, "acknowledged": event.acknowledged}


# ── GET /stream (SSE) ─────────────────────────────────────────────────────────

@router.get("/stream")
async def risk_stream(
    project_id: int,
    token:      str = Query(...),
    db:         Session = Depends(get_db),
):
    """
    SSE stream for the Risk Analytics dashboard.
    Events: risk_stats_update | risk_event_created | heartbeat
    Auth via ?token= (browser EventSource cannot send headers).
    """
    import asyncio
    from ...core.security import decode_access_token
    from ...services.risk_dashboard_broker import register, unregister
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
    db_user = db.get(User, user_id)
    if not db_user or not db_user.is_active or not db_user.is_approved:
        from fastapi.responses import Response
        return Response(status_code=401)
    if int(payload.get("ver", 1) or 1) != int(db_user.token_version or 1):
        from fastapi.responses import Response
        return Response(status_code=401)

    _require_member(project_id, db_user, db)
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


# ── Scheduler endpoints (any authenticated user) ──────────────────────────────

@router.get("/scheduler/status")
def get_risk_scheduler_status(
    project_id: int,
    user: User    = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    try:
        from ...services.risk.risk_scheduler import get_status
        return get_status()
    except Exception:
        pass
    # Fallback: return DB config
    from ...models.risk_scheduler_config import RiskSchedulerConfig
    cfg = db.query(RiskSchedulerConfig).filter(RiskSchedulerConfig.id == 1).first()
    return {
        "enabled":          cfg.enabled if cfg else True,
        "interval_seconds": cfg.interval_seconds if cfg else 30,
        "last_run_at":      None,
        "next_run_at":      None,
        "last_summary":     None,
        "is_running":       False,
        "scheduler_active": False,
    }


class RiskSchedulerConfigPatch(BaseModel):
    enabled: Optional[bool] = None
    interval_seconds: Optional[int] = None


@router.patch("/scheduler/config")
def patch_risk_scheduler_config(
    project_id: int,
    body: RiskSchedulerConfigPatch,
    user: User    = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    if body.enabled is None and body.interval_seconds is None:
        raise HTTPException(status_code=400, detail="Provide enabled or interval_seconds")
    from ...models.risk_scheduler_config import RiskSchedulerConfig
    from datetime import datetime, timezone
    cfg = db.query(RiskSchedulerConfig).filter(RiskSchedulerConfig.id == 1).first()
    if not cfg:
        cfg = RiskSchedulerConfig(id=1)
        db.add(cfg)
    if body.enabled is not None:
        cfg.enabled = body.enabled
    if body.interval_seconds is not None:
        cfg.interval_seconds = body.interval_seconds
    cfg.updated_at = datetime.now(timezone.utc)
    db.commit()
    try:
        from ...services.risk.risk_scheduler import update_config, get_status
        update_config(interval_seconds=body.interval_seconds, enabled=body.enabled)
        return get_status()
    except Exception:
        pass
    return {"enabled": cfg.enabled, "interval_seconds": cfg.interval_seconds}


@router.post("/scheduler/trigger")
def trigger_risk_scheduler(
    project_id: int,
    user: User    = Depends(get_current_user),
    db:   Session = Depends(get_db),
):
    try:
        from ...services.risk.risk_scheduler import trigger_now
        trigger_now()
        return {"message": "Risk analysis cycle triggered — results will update shortly."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Trigger failed: {exc}")
