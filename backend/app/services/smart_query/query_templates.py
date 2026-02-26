"""
Deterministic SQL templates for common Smart Query questions.

These templates make high-value demo and dashboard questions reliable while
keeping the LLM path as fallback for unusual questions.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Callable


@dataclass(frozen=True)
class QueryTemplateMatch:
    name: str
    sql: str
    tables: tuple[str, ...]


def match_query_template(question: str, project_id: int, allowed_tables: list[str]) -> QueryTemplateMatch | None:
    if project_id is None:
        return None
    q = _normalize(question)
    allowed = set(allowed_tables or [])
    zone = _extract_zone(question)

    candidates: list[tuple[bool, QueryTemplateMatch]] = [
        (_has(q, "ppe", "helmet", "vest", "violation", "violations") and _has(q, "by zone", "zone wise", "zones"),
         _ppe_by_zone(q, project_id)),
        (_has(q, "ppe", "helmet", "vest", "violation", "violations") and _has(q, "type", "types", "helmet versus vest", "helmet vs vest"),
         _ppe_by_type(q, project_id, zone)),
        (_has(q, "ppe", "helmet", "vest", "violation", "violations") and _has(q, "trend", "graph", "chart", "daily", "by day"),
         _ppe_by_day(q, project_id, zone)),
        (_has(q, "ppe", "helmet", "vest", "violation", "violations"),
         _ppe_count(q, project_id, zone)),

        (_has(q, "risk") and _has(q, "type", "types", "breakdown", "specific"),
         _risk_events_by_type(q, project_id, zone)),
        (_has(q, "risk") and _has(q, "event", "events") and _has(q, "open", "critical", "high"),
         _risk_events(q, project_id, zone)),
        (_has(q, "risk") and _has(q, "zone", "zones", "highest", "top"),
         _risk_latest_by_zone(project_id)),

        (_has(q, "workforce", "worker", "workers", "utilization", "idle") and _has(q, "utilization", "active"),
         _workforce_utilization(q, project_id, zone)),
        (_has(q, "workforce", "worker", "workers", "idle") and _has(q, "by zone", "zone wise", "zones"),
         _workforce_idle_by_zone(q, project_id)),
        (_has(q, "workforce", "worker", "workers"),
         _workforce_latest(project_id, zone)),

        (_has(q, "activity", "productivity", "idle zone", "low activity") and _has(q, "alert", "alerts"),
         _activity_alerts(q, project_id, zone)),
        (_has(q, "activity", "productivity", "idle zone", "low activity"),
         _activity_latest(project_id, zone)),

        (_has(q, "equipment", "machine", "machinery", "crane", "excavator", "forklift") and _has(q, "alert", "alerts", "issue", "issues"),
         _equipment_alerts(q, project_id, zone)),
        (_has(q, "equipment", "machine", "machinery", "crane", "excavator", "forklift"),
         _equipment_latest(project_id, zone)),

        (_has(q, "camera", "cameras") and _has(q, "offline", "health", "status", "failed"),
         _camera_health(project_id)),

        (_has(q, "task", "tasks", "todo", "to do") and _has(q, "open", "pending", "incomplete", "not done"),
         _tasks(project_id, done=False)),
        (_has(q, "task", "tasks") and _has(q, "done", "completed", "complete"),
         _tasks(project_id, done=True)),
        (_has(q, "note", "notes"),
         _notes(project_id)),
    ]

    for matched, template in candidates:
        if matched and set(template.tables).issubset(allowed):
            return template
    return None


def _normalize(question: str) -> str:
    return re.sub(r"\s+", " ", (question or "").lower()).strip()


def _has(q: str, *terms: str) -> bool:
    return any(term in q for term in terms)


def _safe_literal(value: str) -> str:
    return value.replace("'", "''")[:120]


def _extract_zone(question: str) -> str | None:
    match = re.search(r"\bzone\s+([a-zA-Z0-9][a-zA-Z0-9 _-]{0,40})", question or "", re.IGNORECASE)
    if not match:
        return None
    zone = match.group(1).strip()
    zone = re.split(r"\b(today|yesterday|this|last|from|for|and|with|where|by|graph|chart)\b", zone, flags=re.IGNORECASE)[0].strip()
    return zone or None


def _period_filter(q: str, alias: str, column: str) -> str:
    col = f"{alias}.{column}"
    if "yesterday" in q:
        return f" AND DATE({col}) = CURRENT_DATE - INTERVAL '1 day'"
    if "today" in q:
        return f" AND DATE({col}) = CURRENT_DATE"
    if "this week" in q or "week" in q:
        return f" AND {col} >= date_trunc('week', NOW())"
    if "this month" in q or "month" in q:
        return f" AND {col} >= date_trunc('month', NOW())"
    if "last 7" in q:
        return f" AND {col} >= NOW() - INTERVAL '7 days'"
    if "last 30" in q:
        return f" AND {col} >= NOW() - INTERVAL '30 days'"
    return ""


def _zone_filter(zone: str | None, alias: str = "") -> str:
    if not zone:
        return ""
    prefix = f"{alias}." if alias else ""
    return f" AND LOWER({prefix}zone_name) LIKE LOWER('%{_safe_literal(zone)}%')"


def _template(name: str, sql: str, *tables: str) -> QueryTemplateMatch:
    return QueryTemplateMatch(name=name, sql=sql.strip(), tables=tuple(tables))


def _ppe_count(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    severity = " AND pi.severity = 'critical'" if "critical" in q else ""
    status = " AND pi.status = 'open'" if "open" in q else ""
    incident = ""
    if "helmet" in q and "vest" not in q:
        incident = " AND pi.incident_type IN ('no_helmet', 'both_missing')"
    elif "vest" in q and "helmet" not in q:
        incident = " AND pi.incident_type IN ('no_vest', 'both_missing')"
    sql = f"""
        SELECT COUNT(*) AS violation_count
        FROM ppe_incidents pi
        WHERE pi.project_id = {int(project_id)}
        {_period_filter(q, 'pi', 'started_at')}{_zone_filter(zone, 'pi')}{severity}{status}{incident}
        LIMIT 500
    """
    return _template("ppe_count", sql, "ppe_incidents")


def _ppe_by_zone(q: str, project_id: int) -> QueryTemplateMatch:
    sql = f"""
        SELECT COALESCE(pi.zone_name, 'Unassigned') AS zone_name, COUNT(*) AS violation_count
        FROM ppe_incidents pi
        WHERE pi.project_id = {int(project_id)}{_period_filter(q, 'pi', 'started_at')}
        GROUP BY COALESCE(pi.zone_name, 'Unassigned')
        ORDER BY violation_count DESC
        LIMIT 500
    """
    return _template("ppe_by_zone", sql, "ppe_incidents")


def _ppe_by_type(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT pi.incident_type AS violation_type, COUNT(*) AS violation_count
        FROM ppe_incidents pi
        WHERE pi.project_id = {int(project_id)}{_period_filter(q, 'pi', 'started_at')}{_zone_filter(zone, 'pi')}
        GROUP BY pi.incident_type
        ORDER BY violation_count DESC
        LIMIT 500
    """
    return _template("ppe_by_type", sql, "ppe_incidents")


def _ppe_by_day(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT DATE(pi.started_at) AS day, COUNT(*) AS violation_count
        FROM ppe_incidents pi
        WHERE pi.project_id = {int(project_id)}{_period_filter(q, 'pi', 'started_at')}{_zone_filter(zone, 'pi')}
        GROUP BY DATE(pi.started_at)
        ORDER BY day ASC
        LIMIT 500
    """
    return _template("ppe_by_day", sql, "ppe_incidents")


def _risk_events_by_type(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    severity = " AND re.severity IN ('high', 'critical')" if _has(q, "high", "critical") else ""
    sql = f"""
        SELECT re.event_type, COUNT(*) AS event_count
        FROM risk_events re
        WHERE re.project_id = {int(project_id)}{_period_filter(q, 're', 'triggered_at')}{_zone_filter(zone, 're')}{severity}
        GROUP BY re.event_type
        ORDER BY event_count DESC
        LIMIT 500
    """
    return _template("risk_events_by_type", sql, "risk_events")


def _risk_events(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    severity = " AND re.severity IN ('high', 'critical')" if _has(q, "high", "critical") else ""
    status = " AND re.status = 'open'" if "open" in q else ""
    sql = f"""
        SELECT re.zone_name, re.event_type, re.severity, re.status, re.risk_score, re.triggered_at
        FROM risk_events re
        WHERE re.project_id = {int(project_id)}{_period_filter(q, 're', 'triggered_at')}{_zone_filter(zone, 're')}{severity}{status}
        ORDER BY re.triggered_at DESC
        LIMIT 500
    """
    return _template("risk_events", sql, "risk_events")


def _risk_latest_by_zone(project_id: int) -> QueryTemplateMatch:
    sql = f"""
        SELECT DISTINCT ON (rs.zone_name)
            rs.zone_name, rs.overall_risk, rs.risk_level, rs.trend, rs.recorded_at
        FROM risk_snapshots rs
        WHERE rs.project_id = {int(project_id)}
        ORDER BY rs.zone_name, rs.recorded_at DESC
        LIMIT 500
    """
    return _template("risk_latest_by_zone", sql, "risk_snapshots")


def _workforce_utilization(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT COALESCE(ws.zone_name, 'Unassigned') AS zone_name,
               ROUND(AVG(ws.utilization_score)::numeric, 1) AS utilization_score,
               ROUND(AVG(ws.worker_count)::numeric, 1) AS average_workers,
               ROUND(AVG(ws.active_count)::numeric, 1) AS average_active_workers
        FROM workforce_snapshots ws
        WHERE ws.project_id = {int(project_id)}{_period_filter(q, 'ws', 'recorded_at')}{_zone_filter(zone, 'ws')}
        GROUP BY COALESCE(ws.zone_name, 'Unassigned')
        ORDER BY utilization_score DESC
        LIMIT 500
    """
    return _template("workforce_utilization", sql, "workforce_snapshots")


def _workforce_idle_by_zone(q: str, project_id: int) -> QueryTemplateMatch:
    sql = f"""
        SELECT COALESCE(ws.zone_name, 'Unassigned') AS zone_name,
               ROUND(AVG(ws.idle_count)::numeric, 1) AS average_idle_workers,
               MAX(ws.idle_count) AS peak_idle_workers
        FROM workforce_snapshots ws
        WHERE ws.project_id = {int(project_id)}{_period_filter(q, 'ws', 'recorded_at')}
        GROUP BY COALESCE(ws.zone_name, 'Unassigned')
        ORDER BY average_idle_workers DESC
        LIMIT 500
    """
    return _template("workforce_idle_by_zone", sql, "workforce_snapshots")


def _workforce_latest(project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT ws.zone_name, ws.worker_count, ws.active_count, ws.idle_count, ws.utilization_score, ws.zone_status, ws.recorded_at
        FROM workforce_snapshots ws
        WHERE ws.project_id = {int(project_id)}{_zone_filter(zone, 'ws')}
        ORDER BY ws.recorded_at DESC
        LIMIT 20
    """
    return _template("workforce_latest", sql, "workforce_snapshots")


def _activity_latest(project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT ac.zone_name, ac.zone_state, ac.activity_score, ac.moving_count, ac.idle_count,
               ac.active_minutes_today, ac.idle_minutes_today, ac.recorded_at
        FROM activity_snapshots ac
        WHERE ac.project_id = {int(project_id)}{_zone_filter(zone, 'ac')}
        ORDER BY ac.recorded_at DESC
        LIMIT 20
    """
    return _template("activity_latest", sql, "activity_snapshots")


def _activity_alerts(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT aa.alert_type, aa.severity, aa.status, COUNT(*) AS alert_count
        FROM activity_alerts aa
        WHERE aa.project_id = {int(project_id)}{_period_filter(q, 'aa', 'triggered_at')}{_zone_filter(zone, 'aa')}
        GROUP BY aa.alert_type, aa.severity, aa.status
        ORDER BY alert_count DESC
        LIMIT 500
    """
    return _template("activity_alerts", sql, "activity_alerts")


def _equipment_latest(project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT es.zone_name, es.active_count, es.idle_count, es.total_count,
               es.utilization_score, es.zone_status, es.cross_zone_conflicts, es.recorded_at
        FROM equipment_snapshots es
        WHERE es.project_id = {int(project_id)}{_zone_filter(zone, 'es')}
        ORDER BY es.recorded_at DESC
        LIMIT 20
    """
    return _template("equipment_latest", sql, "equipment_snapshots")


def _equipment_alerts(q: str, project_id: int, zone: str | None) -> QueryTemplateMatch:
    sql = f"""
        SELECT ea.alert_type, ea.equipment_type, ea.severity, ea.status, COUNT(*) AS alert_count
        FROM equipment_alerts ea
        WHERE ea.project_id = {int(project_id)}{_period_filter(q, 'ea', 'triggered_at')}{_zone_filter(zone, 'ea')}
        GROUP BY ea.alert_type, ea.equipment_type, ea.severity, ea.status
        ORDER BY alert_count DESC
        LIMIT 500
    """
    return _template("equipment_alerts", sql, "equipment_alerts")


def _camera_health(project_id: int) -> QueryTemplateMatch:
    sql = f"""
        SELECT c.name AS camera_name,
               COALESCE(ch.health_status::text, c.registry_status::text) AS health_status,
               ch.checked_at,
               ch.message
        FROM cameras c
        JOIN sites s ON s.id = c.site_id
        JOIN projects p ON p.site_id = s.id
        LEFT JOIN LATERAL (
            SELECT chl.health_status, chl.checked_at, chl.message
            FROM camera_health_logs chl
            WHERE chl.camera_id = c.id
            ORDER BY chl.checked_at DESC
            LIMIT 1
        ) ch ON TRUE
        WHERE p.id = {int(project_id)}
        ORDER BY ch.checked_at DESC NULLS LAST, c.name ASC
        LIMIT 500
    """
    return _template("camera_health", sql, "cameras", "sites", "projects", "camera_health_logs")


def _tasks(project_id: int, done: bool) -> QueryTemplateMatch:
    sql = f"""
        SELECT pt.title, pt.description, pt.is_done, pt.created_at, pt.done_at
        FROM project_tasks pt
        WHERE pt.project_id = {int(project_id)} AND pt.is_done = {'TRUE' if done else 'FALSE'}
        ORDER BY pt.created_at DESC
        LIMIT 500
    """
    return _template("tasks", sql, "project_tasks")


def _notes(project_id: int) -> QueryTemplateMatch:
    sql = f"""
        SELECT n.category, COUNT(*) AS note_count
        FROM notes n
        WHERE n.project_id = {int(project_id)}
        GROUP BY n.category
        ORDER BY note_count DESC
        LIMIT 500
    """
    return _template("notes", sql, "notes")
