"""
Business Rule Engine for the Smart Query Assistant.

Provides domain-specific construction site rules (shift timings, thresholds,
status codes) that are retrieved by keyword matching and injected into the
LLM prompt alongside the schema.

Without this, the LLM guesses at meanings like "night shift" or "idle".
With this, it knows exactly: night_shift = 8PM-6AM, idle = no movement >15min.

Usage:
    from .business_rules import get_relevant_rules
    rules_text = get_relevant_rules(question)   # '' if no match
    # Inject rules_text into SQL generation prompt
"""
from __future__ import annotations

# ── Rule bank ─────────────────────────────────────────────────────────────────
# Each entry: keywords (matched against lowercased question) + text (injected into prompt).

_RULES: list[dict] = [

    {
        "keywords": [
            "night", "night shift", "evening", "overnight", "after hours",
            "shift", "day shift", "morning shift", "afternoon shift",
        ],
        "text": """SHIFT DEFINITIONS:
  night_shift  = 8:00 PM (20:00) to 6:00 AM (06:00) next day
  day_shift    = 6:00 AM (06:00) to 8:00 PM (20:00)
  morning_shift = 6:00 AM to 2:00 PM
  afternoon_shift = 2:00 PM to 10:00 PM

  SQL for night shift filter:
    WHERE EXTRACT(HOUR FROM recorded_at) >= 20
       OR EXTRACT(HOUR FROM recorded_at) < 6

  SQL for day shift filter:
    WHERE EXTRACT(HOUR FROM recorded_at) >= 6
      AND EXTRACT(HOUR FROM recorded_at) < 20""",
    },

    {
        "keywords": [
            "idle", "idling", "inactive", "inactivity", "standing still",
            "not moving", "stationary", "idle worker", "idle equipment",
            "idle time", "idle duration", "idle count", "idle_count",
        ],
        "text": """IDLE / INACTIVITY DEFINITIONS:
  idle_worker    = worker with no detected movement for > 15 minutes
  idle_equipment = equipment with no operational activity for > 15 minutes

  In workforce_snapshots:
    idle_count = workers standing still for > 30 seconds (snapshot-level)
    idle_ratio = idle_count / worker_count (fraction, 0-1)

  In activity_snapshots:
    idle_minutes_today = cumulative minutes zone was in IDLE state today
    idle_duration_seconds = current continuous idle streak in seconds
    longest_idle_seconds = longest idle period recorded this session

  In equipment_snapshots:
    idle_count = equipment units present but not moving/operating
    idle_ratio = idle equipment / total equipment (fraction)

  SQL for zones with high idle ratio:
    WHERE (idle_count::float / NULLIF(worker_count, 0)) > 0.5""",
    },

    {
        "keywords": [
            "ppe", "helmet", "vest", "hard hat", "safety gear", "safety equipment",
            "violation", "compliance", "non-compliant", "compliance rate",
            "no helmet", "no vest", "missing ppe", "ppe incident",
            "ppe violation", "safety violation",
        ],
        "text": """PPE / SAFETY DEFINITIONS:
  violation     = worker detected without required PPE (helmet and/or vest)
  has_helmet    = FALSE → worker missing helmet → violation
  has_vest      = FALSE → worker missing safety vest → violation

  incident_type values:
    'no_helmet'    = missing helmet only
    'no_vest'      = missing vest only
    'both_missing' = neither helmet nor vest detected

  status values in ppe_incidents:
    'open'           = violation unaddressed, still active
    'acknowledged'   = seen by supervisor
    'resolved'       = corrective action taken
    'false_positive' = AI detection error (ignore in compliance counts)

  severity:
    'low'    = brief or borderline PPE absence
    'medium' = sustained violation (>5 minutes)
    'high'   = repeated or prolonged violation requiring escalation

  Compliance rate (% workers compliant):
    compliance_rate = 100 - (COUNT(violations) / total_worker_detections * 100)
    Use workforce_snapshots.worker_count for total worker detections.

  Ongoing violations: WHERE ended_at IS NULL AND status = 'open'""",
    },

    {
        "keywords": [
            "risk", "risk score", "risk level", "danger", "hazard", "threat",
            "overall risk", "safety risk", "delay risk", "productivity risk",
            "compound risk", "critical zone", "high risk",
        ],
        "text": """RISK SCORE DEFINITIONS:
  overall_risk in risk_snapshots is a 0-100 composite score:
    0  - 25   = LOW      (green zone, normal operations)
    25 - 50   = MODERATE (yellow zone, monitor closely)
    50 - 75   = HIGH     (orange zone, requires immediate attention)
    75 - 100  = CRITICAL (red zone, operations may need to stop)

  risk_level column:
    'low' | 'moderate' | 'high' | 'critical'

  Component scores (all 0-100):
    safety_risk      = PPE violations + equipment conflicts
    productivity_risk = idle workers + low zone activity
    delay_risk       = schedule delays + understaffing

  compound_risk_flag = TRUE means multiple risk signals coincide
    (more dangerous than the score alone suggests)

  IMPORTANT: use 'overall_risk' NOT 'risk_score' in risk_snapshots
    (risk_score does not exist as a column there)

  trend column:
    'rising'     = risk is getting worse
    'stable'     = risk is stable
    'decreasing' = risk is improving""",
    },

    {
        "keywords": [
            "utilization", "utilisation", "capacity", "efficiency", "productivity",
            "underutilized", "overloaded", "balanced", "zone status",
        ],
        "text": """UTILIZATION DEFINITIONS:
  utilization_score in workforce_snapshots and equipment_snapshots:
    0.0 = all idle (0%)
    1.0 = all active (100%)
    Multiply by 100 to express as percentage.

  Bands:
    < 0.50  = underutilized zone (below 50%)
    0.50-0.80 = normal utilization (50-80%)
    > 0.80  = high utilization (possible bottleneck)

  zone_status in workforce_snapshots:
    'BALANCED'    = worker count within required_workers to max_workers range
    'OVERCROWDED' = above max_workers threshold
    'UNDERSTAFFED'= below required_workers threshold

  zone_status in equipment_snapshots:
    'BALANCED'     = equipment count within expected range
    'UNDERUTILIZED'= too many idle machines for the zone
    'OVERLOADED'   = more equipment than zone can safely handle""",
    },

    {
        "keywords": [
            "camera", "camera health", "camera status", "offline camera", "stream",
            "camera offline", "camera down", "camera error", "health check",
            "camera quality", "latency", "fps", "frame rate", "camera working",
        ],
        "text": """CAMERA HEALTH DEFINITIONS:
  registry_status in cameras:
    'draft'        = registered but connection not tested yet
    'verifying'    = connection test currently in progress
    'verified'     = successfully connected and tested
    'verify_failed'= connection test failed (RTSP credentials likely wrong)
    'archived'     = decommissioned, no longer in use

  worker_status in cameras (ML inference state):
    'idle'    = camera registered but AI inference not running
    'running' = camera actively doing AI inference (PPE, workforce, equipment)
    'error'   = ML inference crashed or lost stream

  A camera is "healthy" when:
    registry_status = 'verified' AND worker_status = 'running'

  A camera is "problematic" when:
    worker_status = 'error' OR registry_status IN ('verify_failed', 'archived')

  health_status in camera_health_logs:
    'healthy'     = online and streaming normally
    'degraded'    = online but slow / dropping frames
    'offline'     = camera not reachable at all
    'maintenance' = manually taken offline for servicing

  latency_ms > 300 ms = degraded performance""",
    },

    {
        "keywords": [
            "worker", "workforce", "workers", "headcount", "occupancy",
            "staff", "staffing", "people", "person", "worker count",
            "active workers", "total workers", "dwell time",
        ],
        "text": """WORKFORCE METRIC DEFINITIONS:
  In workforce_snapshots (taken every ~60 seconds):
    worker_count  = TOTAL workers detected in camera frame at this moment
    active_count  = workers classified as MOVING / performing tasks
    idle_count    = workers standing still for > 30 seconds
    avg_dwell_seconds = average time workers have been in zone without leaving

  Peak construction hours (when worker count is typically highest):
    Morning peak: 7:00 AM - 9:00 AM
    Afternoon peak: 1:00 PM - 3:00 PM

  Use zone_name column for GROUP BY zone (faster than joining zones table)
  Use recorded_at for time-based filtering""",
    },

    {
        "keywords": [
            "equipment", "machine", "machinery", "excavator", "crane", "truck",
            "bulldozer", "forklift", "vehicle", "heavy equipment",
            "equipment type", "equipment utilization", "equipment idle",
            "equipment active", "cross zone", "overuse",
        ],
        "text": """EQUIPMENT DEFINITIONS:
  equipment_type values (in equipment_alerts and equipment_snapshots):
    'excavator' | 'crane' | 'truck' | 'bulldozer' | 'forklift' | 'other'

  Equipment states in equipment_snapshots:
    active_count = equipment units currently moving / in use
    idle_count   = equipment units present but stationary / not operating
    total_count  = all equipment units detected in zone

  utilization_score = active_count / total_count (0.0-1.0, multiply × 100 for %)
  avg_active_duration = average seconds each active machine has been running

  Equipment alert types:
    'idle_waste'         = equipment sitting idle wasting operational time
    'active_no_workers'  = equipment running with no workers nearby (safety risk)
    'ghost_equipment'    = equipment detected in wrong / restricted zone
    'overuse'            = equipment active beyond safe operating hours
    'cross_zone_conflict'= equipment moved into a forbidden zone

  overuse_threshold_hours in equipment_zone_settings = hours before overuse alert""",
    },

    {
        "keywords": [
            "activity", "productivity", "activity score", "zone activity",
            "zone idle", "low activity", "productive", "motion", "moving workers",
        ],
        "text": """ACTIVITY / PRODUCTIVITY DEFINITIONS:
  activity_score in activity_snapshots (0-100 scale):
    0   = completely idle zone
    100 = fully productive zone (all workers moving)
    < 40  = low productivity — consider alert
    40-75 = moderate productivity
    >= 75 = high productivity

  zone_state:
    'ACTIVE'        = majority of workers moving and productive
    'IDLE'          = majority stationary, little work happening
    'LOW_ACTIVITY'  = some movement but below expected productivity level
    'ALERTED'       = an alert has already been fired for this zone

  active_minutes_today = cumulative minutes zone was in ACTIVE state today
  idle_minutes_today   = cumulative minutes zone was in IDLE state today""",
    },

]


# ── Public API ────────────────────────────────────────────────────────────────

def get_relevant_rules(question: str) -> str:
    """
    Keyword-match the question against rule categories.
    Returns a formatted block of matching rules for injection into the LLM prompt.
    Returns '' if no rules match.
    """
    q_lower = question.lower()
    matched: list[str] = []
    seen: set[int] = set()

    for i, rule in enumerate(_RULES):
        if i in seen:
            continue
        if any(kw in q_lower for kw in rule["keywords"]):
            matched.append(rule["text"].strip())
            seen.add(i)

    if not matched:
        return ""

    return "DOMAIN BUSINESS RULES:\n\n" + "\n\n".join(matched)
