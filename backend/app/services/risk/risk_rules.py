"""
Risk Rules Engine — pure functions, no DB access.
Computes delay, safety, and productivity risk scores from snapshot data.
"""
from __future__ import annotations

import math
from typing import Optional


# ── Helpers ──────────────────────────────────────────────────────────────────

def _clamp(val: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, val))


def _classify(overall: float) -> str:
    if overall >= 75:
        return "critical"
    if overall >= 50:
        return "high"
    if overall >= 25:
        return "moderate"
    return "low"


# ── Delay Risk ────────────────────────────────────────────────────────────────

def compute_delay_risk(
    wf_snap,
    act_snap,
    weather: Optional[dict],
    zone_settings,
    open_wf_alerts: int = 0,
) -> tuple[float, list[dict]]:
    score = 0.0
    factors: list[dict] = []

    # Idle duration (non-linear — scales with minutes idle)
    if act_snap and act_snap.idle_duration_seconds:
        idle_min = act_snap.idle_duration_seconds / 60
        if idle_min > 10:
            pts = _clamp(idle_min * 2, 0, 30)
            score += pts
            factors.append({
                "factor": f"Zone idle {int(idle_min)}m",
                "contribution": round(pts),
                "points": pts,
                "source": "activity",
                "bucket": "delay",
                "detail": f"{int(idle_min)} minutes of inactivity detected",
            })

    # Understaffing gap
    if wf_snap and zone_settings and hasattr(zone_settings, "required_workers"):
        gap = (zone_settings.required_workers or 0) - (wf_snap.worker_count or 0)
        if gap > 0:
            pts = _clamp(gap * 8, 0, 25)
            score += pts
            factors.append({
                "factor": f"Understaffed by {gap} worker{'s' if gap != 1 else ''}",
                "contribution": round(pts),
                "points": pts,
                "source": "workforce",
                "bucket": "delay",
                "detail": f"Required {zone_settings.required_workers}, present {wf_snap.worker_count}",
            })

    # Low activity score
    if act_snap and (act_snap.activity_score or 0) < 30:
        pts = 20.0
        score += pts
        factors.append({
            "factor": "Low activity score",
            "contribution": round(pts),
            "points": pts,
            "source": "activity",
            "bucket": "delay",
            "detail": f"Activity score {act_snap.activity_score}/100",
        })

    # Rain (delays outdoor work)
    if weather:
        rain = weather.get("rain_1h") or 0.0
        if rain > 0:
            pts = _clamp(rain * 8, 0, 15)
            score += pts
            factors.append({
                "factor": f"Rain {rain:.1f}mm/h",
                "contribution": round(pts),
                "points": pts,
                "source": "weather",
                "bucket": "delay",
                "detail": "Rainfall slows outdoor construction activities",
            })
        # High wind
        wind = weather.get("wind_mps") or 0.0
        if wind > 10:
            pts = 8.0
            score += pts
            factors.append({
                "factor": f"High wind {wind:.1f} m/s",
                "contribution": round(pts),
                "points": pts,
                "source": "weather",
                "bucket": "delay",
                "detail": "High winds create crane/scaffolding delays",
            })
        # Snow delays outdoor work and creates surface hazards
        snow = weather.get("snow_1h") or 0.0
        if snow > 0:
            pts = _clamp(snow * 8, 0, 15)
            score += pts
            factors.append({
                "factor": f"Snow {snow:.1f}mm/h",
                "contribution": round(pts),
                "points": pts,
                "source": "weather",
                "bucket": "delay",
                "detail": "Snowfall delays outdoor construction and creates surface hazards",
            })

    if open_wf_alerts > 0:
        pts = _clamp(open_wf_alerts * 4, 0, 20)
        score += pts
        factors.append({
            "factor": f"{open_wf_alerts} open workforce alert{'s' if open_wf_alerts != 1 else ''}",
            "contribution": round(pts),
            "points": pts,
            "source": "workforce",
            "bucket": "delay",
            "detail": "Accumulated open workforce alerts from project start",
        })

    return _clamp(score), factors


# ── Safety Risk ───────────────────────────────────────────────────────────────

def compute_safety_risk(
    open_ppe_count: int,
    critical_ppe_count: int,
    weather: Optional[dict],
) -> tuple[float, list[dict]]:
    score = 0.0
    factors: list[dict] = []

    if open_ppe_count > 0:
        pts = _clamp(open_ppe_count * 5, 0, 50)
        score += pts
        factors.append({
            "factor": f"{open_ppe_count} open PPE violation{'s' if open_ppe_count != 1 else ''}",
            "contribution": round(pts),
            "points": pts,
            "source": "ppe",
            "bucket": "safety",
            "detail": "Unresolved PPE incidents from project start",
        })

    if critical_ppe_count >= 2:
        pts = 30.0
        score += pts
        factors.append({
            "factor": f"{critical_ppe_count} critical violations",
            "contribution": round(pts),
            "points": pts,
            "source": "ppe",
            "bucket": "safety",
            "detail": "Multiple critical PPE breaches (both helmet and vest missing)",
        })

    if weather:
        rain = weather.get("rain_1h") or 0.0
        vis  = weather.get("visibility_m")
        if rain > 0 or (vis is not None and vis < 3000):
            pts = 10.0
            score += pts
            reason = "rain" if rain > 0 else f"low visibility ({vis}m)"
            factors.append({
                "factor": f"Hazardous conditions — {reason}",
                "contribution": round(pts),
                "points": pts,
                "source": "weather",
                "bucket": "safety",
                "detail": "Wet or low-visibility conditions increase slip/fall risk",
            })
        # Extreme temperature — direct worker safety risk
        temp = weather.get("temp_c")
        if temp is not None:
            if temp >= 38:
                pts = 15.0
                score += pts
                factors.append({
                    "factor": f"Heat stress {temp:.0f}°C",
                    "contribution": round(pts),
                    "points": pts,
                    "source": "weather",
                    "bucket": "safety",
                    "detail": "Extreme heat elevates heat exhaustion and fatigue risk",
                })
            elif temp <= 0:
                pts = 10.0
                score += pts
                factors.append({
                    "factor": f"Cold stress {temp:.0f}°C",
                    "contribution": round(pts),
                    "points": pts,
                    "source": "weather",
                    "bucket": "safety",
                    "detail": "Freezing temperature raises slip, frostbite, and equipment failure risk",
                })

    return _clamp(score), factors


# ── Productivity Risk ─────────────────────────────────────────────────────────

def compute_productivity_risk(
    wf_snap,
    act_snap,
    open_act_alerts: int = 0,
) -> tuple[float, list[dict]]:
    score = 0.0
    factors: list[dict] = []

    if wf_snap and (wf_snap.utilization_score or 0) < 40:
        pts = 30.0
        score += pts
        factors.append({
            "factor": f"Low utilization {wf_snap.utilization_score:.0f}%",
            "contribution": round(pts),
            "points": pts,
            "source": "workforce",
            "bucket": "productivity",
            "detail": f"Workforce utilization {wf_snap.utilization_score:.0f}% — below 40% threshold",
        })

    if act_snap and (act_snap.motion_intensity_score or 0) < 25:
        pts = 25.0
        score += pts
        factors.append({
            "factor": "Low motion intensity",
            "contribution": round(pts),
            "points": pts,
            "source": "activity",
            "bucket": "productivity",
            "detail": f"Motion intensity score {act_snap.motion_intensity_score:.0f}/100",
        })

    if wf_snap and (wf_snap.worker_count or 0) > 0:
        idle_ratio = (wf_snap.idle_count or 0) / wf_snap.worker_count
        if idle_ratio > 0.5:
            pts = 20.0
            score += pts
            factors.append({
                "factor": f"{wf_snap.idle_count} idle workers",
                "contribution": round(pts),
                "points": pts,
                "source": "workforce",
                "bucket": "productivity",
                "detail": f"{idle_ratio*100:.0f}% of workforce is idle",
            })

    if open_act_alerts > 0:
        pts = _clamp(open_act_alerts * 4, 0, 20)
        score += pts
        factors.append({
            "factor": f"{open_act_alerts} open activity alert{'s' if open_act_alerts != 1 else ''}",
            "contribution": round(pts),
            "points": pts,
            "source": "activity",
            "bucket": "productivity",
            "detail": "Accumulated open activity alerts from project start",
        })

    return _clamp(score), factors


# ── Overall + Compound ────────────────────────────────────────────────────────

def compute_overall(delay: float, safety: float, productivity: float) -> tuple[float, bool]:
    overall = 0.4 * delay + 0.35 * safety + 0.25 * productivity
    compound = delay > 50 and safety > 40 and productivity > 40
    if compound:
        overall += 10  # compound penalty — multiple simultaneous failure modes
    return _clamp(overall), compound


# ── Trend & Momentum ─────────────────────────────────────────────────────────

def compute_trend(current: float, last5: list) -> tuple[str, float]:
    if not last5:
        return "stable", 0.0
    avg = sum(s.overall_risk for s in last5) / len(last5)
    delta = current - avg
    if delta > 8:
        trend = "rising"
    elif delta < -8:
        trend = "decreasing"
    else:
        trend = "stable"
    return trend, round(delta, 2)


# ── Prediction ────────────────────────────────────────────────────────────────

def compute_prediction(current: float, last20: list) -> tuple[Optional[float], Optional[int]]:
    if len(last20) < 10:
        return None, None
    rows = sorted(last20, key=lambda r: getattr(r, "recorded_at", None) or 0)
    xs: list[float] = []
    ys: list[float] = []
    base = getattr(rows[0], "recorded_at", None)
    if not base:
        return None, None
    for r in rows:
        ts = getattr(r, "recorded_at", None)
        if not ts:
            continue
        xs.append((ts - base).total_seconds() / 60.0)
        ys.append(float(getattr(r, "overall_risk", 0.0) or 0.0))
    if len(xs) < 8:
        return None, None
    mean_x = sum(xs) / len(xs)
    mean_y = sum(ys) / len(ys)
    denom = sum((x - mean_x) ** 2 for x in xs)
    if denom <= 0:
        return None, None
    slope = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys)) / denom
    if slope <= 0.6:
        return None, None
    pred = _clamp(current + slope * 15.0)
    if pred < 75:
        return None, None
    return pred, 15


# ── Recommendations (in-memory, not stored) ───────────────────────────────────

def generate_recommendations(
    zone_name: str,
    delay_risk: float,
    safety_risk: float,
    productivity_risk: float,
    compound_flag: bool,
    prediction_risk: Optional[float],
    act_snap,
    weather: Optional[dict],
) -> list[dict]:
    recs: list[dict] = []

    idle_sec = (act_snap.idle_duration_seconds or 0) if act_snap else 0
    if delay_risk > 60 and idle_sec > 1800:
        recs.append({
            "severity": "high",
            "text": f"Zone {zone_name} idle {int(idle_sec/60)}m — dispatch workers or reassign task",
            "zone": zone_name,
        })

    rain = (weather.get("rain_1h") or 0) if weather else 0
    if safety_risk > 50 and rain > 0:
        recs.append({
            "severity": "high",
            "text": f"Rain + open PPE violations in {zone_name} — enforce mandatory gear check before resuming",
            "zone": zone_name,
        })

    if compound_flag:
        recs.append({
            "severity": "critical",
            "text": f"⚡ Compound risk in {zone_name} — multiple failure modes active simultaneously. Immediate review required.",
            "zone": zone_name,
        })
    elif prediction_risk and prediction_risk >= 75:
        recs.append({
            "severity": "high",
            "text": f"Zone {zone_name} approaching CRITICAL within ~15 min — pre-emptive intervention recommended",
            "zone": zone_name,
        })

    if productivity_risk > 60 and not compound_flag:
        recs.append({
            "severity": "medium",
            "text": f"Low productivity in {zone_name} — review task assignment and workforce allocation",
            "zone": zone_name,
        })

    return recs
