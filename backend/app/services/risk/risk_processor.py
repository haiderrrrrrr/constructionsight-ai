"""
Risk Processor — core compute cycle called by the risk scheduler.
For each active project: reads latest workforce/activity/PPE snapshots,
computes risk scores, writes risk_snapshot rows, generates risk_events,
fires notifications + auto-tasks, then pushes SSE.
"""
from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional

logger = logging.getLogger(__name__)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _minutes_since(ts: Optional[datetime]) -> Optional[float]:
    if not ts:
        return None
    try:
        return (datetime.now(timezone.utc) - ts).total_seconds() / 60.0
    except Exception:
        return None


def _source_scale(age_min: Optional[float], fresh_min: float, stale_min: float) -> float:
    if age_min is None:
        return 0.0
    if age_min <= fresh_min:
        return 1.0
    if age_min >= stale_min:
        return 0.3
    span = max(1e-6, (stale_min - fresh_min))
    t = (age_min - fresh_min) / span
    return 1.0 - 0.5 * max(0.0, min(1.0, t))


def _get_recent_wf_snapshots(db, camera_id: int, minutes: int, limit: int = 60):
    try:
        from ...models.workforce_snapshot import WorkforceSnapshot
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        return (
            db.query(WorkforceSnapshot)
            .filter(
                WorkforceSnapshot.camera_id == camera_id,
                WorkforceSnapshot.recorded_at >= cutoff,
            )
            .order_by(WorkforceSnapshot.recorded_at.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        return []


def _get_recent_act_snapshots(db, camera_id: int, minutes: int, limit: int = 60):
    try:
        from ...models.activity_snapshot import ActivitySnapshot
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=minutes)
        return (
            db.query(ActivitySnapshot)
            .filter(
                ActivitySnapshot.camera_id == camera_id,
                ActivitySnapshot.recorded_at >= cutoff,
            )
            .order_by(ActivitySnapshot.recorded_at.desc())
            .limit(limit)
            .all()
        )
    except Exception:
        return []


def _aggregate_wf(snaps: list):
    if not snaps:
        return None
    worker_counts = [s.worker_count for s in snaps if s.worker_count is not None]
    idle_counts = [s.idle_count for s in snaps if s.idle_count is not None]
    util_scores = [s.utilization_score for s in snaps if s.utilization_score is not None]
    def _avg(vals):
        return (sum(vals) / len(vals)) if vals else None
    return SimpleNamespace(
        recorded_at=snaps[0].recorded_at,
        worker_count=int(round(_avg(worker_counts) or 0)),
        idle_count=int(round(_avg(idle_counts) or 0)),
        utilization_score=float(_avg(util_scores) or 0.0),
    )


def _aggregate_act(snaps: list):
    if not snaps:
        return None
    act_scores = [s.activity_score for s in snaps if s.activity_score is not None]
    motion_scores = [s.motion_intensity_score for s in snaps if s.motion_intensity_score is not None]
    idle_durs = [s.idle_duration_seconds for s in snaps if s.idle_duration_seconds is not None]
    def _avg(vals):
        return (sum(vals) / len(vals)) if vals else None
    return SimpleNamespace(
        recorded_at=snaps[0].recorded_at,
        activity_score=float(_avg(act_scores) or 0.0),
        motion_intensity_score=float(_avg(motion_scores) or 0.0),
        idle_duration_seconds=float(max(idle_durs) if idle_durs else 0.0) or None,
    )


def _get_latest_wf_snapshot(db, camera_id: int):
    try:
        from ...models.workforce_snapshot import WorkforceSnapshot
        return (
            db.query(WorkforceSnapshot)
            .filter(WorkforceSnapshot.camera_id == camera_id)
            .order_by(WorkforceSnapshot.recorded_at.desc())
            .first()
        )
    except Exception:
        return None


def _get_latest_act_snapshot(db, camera_id: int):
    try:
        from ...models.activity_snapshot import ActivitySnapshot
        return (
            db.query(ActivitySnapshot)
            .filter(ActivitySnapshot.camera_id == camera_id)
            .order_by(ActivitySnapshot.recorded_at.desc())
            .first()
        )
    except Exception:
        return None


def _count_open_ppe_incidents(db, camera_id: int, start_date=None) -> tuple[int, int]:
    """Returns (total_open, critical_open) for open PPE incidents from project start."""
    try:
        from ...models.ppe_incident import PpeIncident
        q = db.query(PpeIncident).filter(
            PpeIncident.camera_id == camera_id,
            PpeIncident.status == "open",
        )
        if start_date:
            cutoff = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
            q = q.filter(PpeIncident.started_at >= cutoff)
        open_incidents = q.all()
        critical = [i for i in open_incidents if i.incident_type == "both_missing"]
        return len(open_incidents), len(critical)
    except Exception:
        return 0, 0


def _count_open_workforce_alerts(db, camera_id: int, start_date=None) -> int:
    """Returns count of open WorkforceAlerts from project start."""
    try:
        from ...models.workforce_alert import WorkforceAlert
        q = db.query(WorkforceAlert).filter(
            WorkforceAlert.camera_id == camera_id,
            WorkforceAlert.status == "open",
        )
        if start_date:
            cutoff = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
            q = q.filter(WorkforceAlert.triggered_at >= cutoff)
        return q.count()
    except Exception:
        return 0


def _count_open_activity_alerts(db, camera_id: int, start_date=None) -> int:
    """Returns count of open ActivityAlerts from project start."""
    try:
        from ...models.activity_alert import ActivityAlert
        q = db.query(ActivityAlert).filter(
            ActivityAlert.camera_id == camera_id,
            ActivityAlert.status == "open",
        )
        if start_date:
            cutoff = datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc)
            q = q.filter(ActivityAlert.triggered_at >= cutoff)
        return q.count()
    except Exception:
        return 0


def _get_zone_settings(db, camera_id: int):
    try:
        from ...models.workforce_zone_settings import WorkforceZoneSettings
        return (
            db.query(WorkforceZoneSettings)
            .filter(WorkforceZoneSettings.camera_id == camera_id)
            .first()
        )
    except Exception:
        return None


def _get_last_n_risk_snapshots(db, camera_id: int, n: int):
    try:
        from ...models.risk_snapshot import RiskSnapshot
        return (
            db.query(RiskSnapshot)
            .filter(RiskSnapshot.camera_id == camera_id)
            .order_by(RiskSnapshot.recorded_at.desc())
            .limit(n)
            .all()
        )
    except Exception:
        return []


def _should_generate_event(snap, prev_snap) -> bool:
    if prev_snap is None:
        return snap.risk_level in ("high", "critical")
    if snap.risk_level != prev_snap.risk_level:
        return True
    if snap.compound_risk_flag and not prev_snap.compound_risk_flag:
        return True
    if snap.prediction_risk and (not prev_snap.prediction_risk or prev_snap.prediction_risk < 75) and snap.prediction_risk >= 75:
        return True
    return False


def _determine_event_type(snap, prev_snap) -> str:
    if snap.compound_risk_flag and (prev_snap is None or not prev_snap.compound_risk_flag):
        return "compound_risk"
    if snap.prediction_risk and snap.prediction_risk >= 75:
        return "prediction_alert"
    if prev_snap and snap.overall_risk < prev_snap.overall_risk and snap.risk_level in ("low", "moderate"):
        return "risk_resolved"
    if snap.weather_condition and snap.weather_rain and snap.weather_rain > 0 and (prev_snap is None or not prev_snap.weather_rain):
        return "weather_impact"
    return "risk_escalated"


def _build_event_message(snap, event_type: str) -> str:
    zone = snap.zone_name or "Unknown Zone"
    score = snap.overall_risk
    if event_type == "compound_risk":
        return (
            f"⚡ Compound risk in Zone {zone} — Delay {snap.delay_risk:.0f}, "
            f"Safety {snap.safety_risk:.0f}, Productivity {snap.productivity_risk:.0f} "
            f"simultaneously elevated. Overall: {score:.0f}/100"
        )
    if event_type == "prediction_alert":
        return (
            f"Zone {zone} predicted to reach CRITICAL ({snap.prediction_risk:.0f}/100) "
            f"within ~{snap.prediction_window_minutes} minutes"
        )
    if event_type == "risk_resolved":
        return f"Zone {zone} risk has decreased to {snap.risk_level.upper()} ({score:.0f}/100)"
    if event_type == "weather_impact":
        return (
            f"Zone {zone} safety risk elevated due to weather: "
            f"{snap.weather_condition} ({snap.weather_rain:.1f}mm rain)"
        )
    # risk_escalated
    level = snap.risk_level.upper()
    return (
        f"Zone {zone} entering {level} risk ({score:.0f}/100) — "
        f"Delay: {snap.delay_risk:.0f}, Safety: {snap.safety_risk:.0f}, "
        f"Productivity: {snap.productivity_risk:.0f}"
    )


# ── Active cameras ─────────────────────────────────────────────────────────────

def _get_active_cameras(db, project_id: int):
    """Return list of camera-like objects (with camera_id, zone_id, zone_name, name) for project."""
    try:
        from ...models.project_camera import ProjectCamera
        from ...models.camera import Camera
        from ...models.zone import Zone
        rows = (
            db.query(ProjectCamera, Camera, Zone)
            .join(Camera, Camera.id == ProjectCamera.camera_id)
            .outerjoin(Zone, Zone.id == ProjectCamera.zone_id)
            .filter(ProjectCamera.project_id == project_id)
            .all()
        )
        result = []
        for pc, cam, zone in rows:
            result.append(_CameraProxy(
                id=cam.id,
                name=cam.name,
                zone_id=pc.zone_id,
                zone_name=zone.name if zone else cam.name,
            ))
        return result
    except Exception as exc:
        logger.warning(f"[risk_processor] _get_active_cameras failed: {exc}")
        return []


class _CameraProxy:
    __slots__ = ("id", "name", "zone_id", "zone_name")

    def __init__(self, id, name, zone_id, zone_name):
        self.id        = id
        self.name      = name
        self.zone_id   = zone_id
        self.zone_name = zone_name


# ── Main entry ────────────────────────────────────────────────────────────────

def process_project(project_id: int, db_session_factory) -> dict:
    """
    Run one risk analysis cycle for a project.
    Returns summary dict: {total_zones, critical_zones, high_risk_zones, events_generated}.
    """
    from ...services import weather_service
    from ...services import risk_dashboard_broker
    from ...models.risk_snapshot import RiskSnapshot
    from ...models.risk_event import RiskEvent
    from . import risk_rules
    from .risk_notification import notify_risk_event
    from .risk_auto_task import evaluate_risk_tasks

    summary = {"total_zones": 0, "critical_zones": 0, "high_risk_zones": 0, "events_generated": 0}

    db = db_session_factory()
    try:
        from ...models.project import Project
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return summary

        weather = weather_service.get_weather(project.location or "")

        cameras = _get_active_cameras(db, project_id)
        if not cameras:
            return summary

        zone_payloads = []

        for cam in cameras:
            wf_recent      = _get_recent_wf_snapshots(db, cam.id, minutes=30, limit=60)
            act_recent     = _get_recent_act_snapshots(db, cam.id, minutes=30, limit=60)
            wf_snap        = _aggregate_wf(wf_recent) or _get_latest_wf_snapshot(db, cam.id)
            act_snap       = _aggregate_act(act_recent) or _get_latest_act_snapshot(db, cam.id)
            open_ppe, crit_ppe = _count_open_ppe_incidents(db, cam.id, start_date=project.start_date)
            open_wf_alerts     = _count_open_workforce_alerts(db, cam.id, start_date=project.start_date)
            open_act_alerts    = _count_open_activity_alerts(db, cam.id, start_date=project.start_date)
            zone_settings = _get_zone_settings(db, cam.id)
            last5         = _get_last_n_risk_snapshots(db, cam.id, 5)
            last20        = _get_last_n_risk_snapshots(db, cam.id, 20)

            delay_risk, delay_factors       = risk_rules.compute_delay_risk(wf_snap, act_snap, weather, zone_settings, open_wf_alerts)
            safety_risk, safety_factors     = risk_rules.compute_safety_risk(open_ppe, crit_ppe, weather)
            productivity_risk, prod_factors = risk_rules.compute_productivity_risk(wf_snap, act_snap, open_act_alerts)

            wf_age = _minutes_since(getattr(wf_snap, "recorded_at", None))
            act_age = _minutes_since(getattr(act_snap, "recorded_at", None))
            wf_scale = _source_scale(wf_age, fresh_min=2.5, stale_min=12.0)
            act_scale = _source_scale(act_age, fresh_min=1.5, stale_min=8.0)
            confidence = round(100.0 * (0.5 * wf_scale + 0.5 * act_scale), 1)

            wf_age_str = f"{wf_age:.1f}" if wf_age is not None else "—"
            act_age_str = f"{act_age:.1f}" if act_age is not None else "—"
            meta = [{
                "factor": "Data freshness",
                "contribution": 0,
                "points": 0.0,
                "source": "meta",
                "bucket": "meta",
                "detail": f"confidence={confidence} wf_age_min={wf_age_str} act_age_min={act_age_str}",
            }]

            all_factors = meta + delay_factors + safety_factors + prod_factors

            for f in all_factors:
                src = f.get("source")
                scale = 1.0
                if src == "workforce":
                    scale = wf_scale
                elif src == "activity":
                    scale = act_scale
                pts = float(f.get("points", f.get("contribution", 0)) or 0.0)
                adj = pts * scale
                f["points"] = adj
                if src in ("workforce", "activity"):
                    f["contribution"] = int(round(adj))

            weather_pts = sum(float(f.get("points", 0) or 0) for f in all_factors if f.get("source") == "weather" and f.get("bucket") in ("delay", "safety"))
            if weather_pts > 20.0:
                w_scale = 20.0 / weather_pts
                for f in all_factors:
                    if f.get("source") != "weather":
                        continue
                    if f.get("bucket") not in ("delay", "safety"):
                        continue
                    pts = float(f.get("points", 0) or 0)
                    adj = pts * w_scale
                    f["points"] = adj
                    f["contribution"] = int(round(adj))
                all_factors.append({
                    "factor": "Weather impact normalized",
                    "contribution": 0,
                    "points": 0.0,
                    "source": "meta",
                    "bucket": "meta",
                    "detail": "Weather contributions capped to avoid double-counting across delay & safety",
                })

            delay_risk = sum(float(f.get("points", 0) or 0) for f in all_factors if f.get("bucket") == "delay")
            safety_risk = sum(float(f.get("points", 0) or 0) for f in all_factors if f.get("bucket") == "safety")
            productivity_risk = sum(float(f.get("points", 0) or 0) for f in all_factors if f.get("bucket") == "productivity")

            delay_risk = risk_rules._clamp(delay_risk)
            safety_risk = risk_rules._clamp(safety_risk)
            productivity_risk = risk_rules._clamp(productivity_risk)

            # Sort by contribution descending so most impactful show first
            all_factors.sort(key=lambda f: f.get("contribution", 0), reverse=True)

            raw_overall, compound_flag = risk_rules.compute_overall(delay_risk, safety_risk, productivity_risk)
            prev_overalls = [float(s.overall_risk or 0.0) for s in (last5[:3] if last5 else [])]
            prev_avg = (sum(prev_overalls) / len(prev_overalls)) if prev_overalls else raw_overall
            overall = risk_rules._clamp(0.65 * raw_overall + 0.35 * prev_avg)

            risk_level             = risk_rules._classify(overall)
            trend, momentum        = risk_rules.compute_trend(overall, last5)
            pred_risk, pred_window = risk_rules.compute_prediction(overall, last20)

            zone_name = cam.zone_name or f"Camera {cam.id}"

            recs = risk_rules.generate_recommendations(
                zone_name=zone_name,
                delay_risk=delay_risk,
                safety_risk=safety_risk,
                productivity_risk=productivity_risk,
                compound_flag=compound_flag,
                prediction_risk=pred_risk,
                act_snap=act_snap,
                weather=weather,
            )

            snap = RiskSnapshot(
                project_id          = project_id,
                camera_id           = cam.id,
                zone_id             = cam.zone_id,
                zone_name           = zone_name,
                delay_risk          = round(delay_risk, 2),
                safety_risk         = round(safety_risk, 2),
                productivity_risk   = round(productivity_risk, 2),
                overall_risk        = round(overall, 2),
                risk_level          = risk_level,
                trend               = trend,
                momentum            = round(momentum, 2),
                factors_json        = json.dumps(all_factors),
                prediction_risk     = round(pred_risk, 2) if pred_risk else None,
                prediction_window_minutes = pred_window,
                compound_risk_flag  = compound_flag,
                weather_condition   = weather.get("condition") if weather else None,
                weather_temp        = weather.get("temp_c") if weather else None,
                weather_wind        = weather.get("wind_mps") if weather else None,
                weather_rain        = weather.get("rain_1h") if weather else None,
            )
            db.add(snap)
            zone_payloads.append((snap, cam, last5, recs))

            summary["total_zones"] += 1
            if risk_level == "critical":
                summary["critical_zones"] += 1
            if risk_level in ("high", "critical"):
                summary["high_risk_zones"] += 1

        db.flush()

        for snap, cam, last5, recs in zone_payloads:
            prev_snap = last5[0] if last5 else None
            if _should_generate_event(snap, prev_snap):
                event_type = _determine_event_type(snap, prev_snap)
                message    = _build_event_message(snap, event_type)

                event = RiskEvent(
                    project_id          = project_id,
                    camera_id           = cam.id,
                    zone_id             = snap.zone_id,
                    zone_name           = snap.zone_name,
                    event_type          = event_type,
                    severity            = snap.risk_level,
                    message             = message,
                    risk_score          = snap.overall_risk,
                    previous_risk_score = prev_snap.overall_risk if prev_snap else 0.0,
                )
                db.add(event)
                db.flush()

                notify_risk_event(db, project_id, event, camera_name=cam.name)
                evaluate_risk_tasks(db, project_id, event, snap, camera_name=cam.name)
                summary["events_generated"] += 1

        db.commit()

        # Build and push SSE payload
        sse_payload = _build_sse_payload(project_id, zone_payloads, weather)
        risk_dashboard_broker.push(project_id, sse_payload)

        logger.debug(
            f"[risk_processor] project={project_id} zones={summary['total_zones']} "
            f"critical={summary['critical_zones']} events={summary['events_generated']}"
        )

    except Exception as exc:
        logger.error(f"[risk_processor] process_project({project_id}) failed: {exc}", exc_info=True)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()

    return summary


def _build_sse_payload(project_id: int, zone_payloads: list, weather: Optional[dict]) -> dict:
    now_iso = datetime.now(timezone.utc).isoformat()
    zones = []
    for snap, cam, last5, recs in zone_payloads:
        zones.append({
            "camera_id":                cam.id,
            "zone_id":                  snap.zone_id,
            "zone_name":                snap.zone_name,
            "overall_risk":             snap.overall_risk,
            "delay_risk":               snap.delay_risk,
            "safety_risk":              snap.safety_risk,
            "productivity_risk":        snap.productivity_risk,
            "risk_level":               snap.risk_level,
            "trend":                    snap.trend,
            "momentum":                 snap.momentum,
            "compound_risk_flag":       snap.compound_risk_flag,
            "factors":                  json.loads(snap.factors_json or "[]"),
            "prediction_risk":          snap.prediction_risk,
            "prediction_window_minutes": snap.prediction_window_minutes,
            "recommendations":          recs,
            "recorded_at":              now_iso,
        })

    def _p95(vals: list[float]) -> float:
        if not vals:
            return 0.0
        vs = sorted(vals)
        if len(vs) <= 2:
            return float(vs[-1])
        idx = int(math.ceil(0.95 * (len(vs) - 1)))
        return float(vs[idx])

    overall_risks = [float(z["overall_risk"] or 0.0) for z in zones]
    overall_max = max(overall_risks) if overall_risks else 0.0
    overall_avg = (sum(overall_risks) / len(overall_risks)) if overall_risks else 0.0
    overall_p95 = _p95(overall_risks)

    return {
        "type":           "risk_stats_update",
        "project_id":     project_id,
        "timestamp":      now_iso,
        "overall_risk":   overall_p95,
        "overall_risk_max": overall_max,
        "overall_risk_avg": overall_avg,
        "overall_risk_p95": overall_p95,
        "zones":          zones,
        "weather":        weather,
    }


def process_all_active_projects(db_session_factory) -> dict:
    """Called by the scheduler — iterates all ACTIVE projects."""
    from ...models.project import Project, ProjectStatus
    db = db_session_factory()
    try:
        projects = (
            db.query(Project)
            .filter(Project.status == ProjectStatus.ACTIVE)
            .all()
        )
        project_ids = [p.id for p in projects]
    except Exception as exc:
        logger.error(f"[risk_processor] Failed to load active projects: {exc}")
        project_ids = []
    finally:
        db.close()

    total_summary = {"total_zones": 0, "critical_zones": 0, "high_risk_zones": 0, "events_generated": 0}
    for pid in project_ids:
        result = process_project(pid, db_session_factory)
        for k in total_summary:
            total_summary[k] += result.get(k, 0)

    return total_summary
