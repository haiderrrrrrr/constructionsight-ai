from app.services.smart_query.sql_validator import auto_correct_sql
from app.services.smart_query.pipeline import (
    _deterministic_answer,
    _extract_query_context,
    _sanitize_insights,
    _resolve_follow_up_question,
    _rows_to_evidence,
)
from app.services.smart_query.query_templates import match_query_template


def test_auto_correct_repairs_unknown_alias_to_matching_declared_alias():
    sql = (
        "SELECT pi.zone_name, COUNT(*) AS cnt "
        "FROM workforce_snapshots ws "
        "JOIN zones z ON ws.zone_id = z.id "
        "WHERE DATE(ws.recorded_at) = CURRENT_DATE AND ws.idle_count > 0 "
        "GROUP BY pi.zone_name ORDER BY cnt DESC LIMIT 5"
    )

    corrected, fixups = auto_correct_sql(sql)

    assert "ws.zone_name" in corrected
    assert "pi.zone_name" not in corrected
    assert any(fixup.startswith("alias_repair") for fixup in fixups)


def test_auto_correct_aggregates_grouped_snapshot_ratio():
    sql = (
        "SELECT ws.zone_name, (ws.active_count::FLOAT / ws.worker_count) * 100 AS utilization_score "
        "FROM workforce_snapshots ws "
        "WHERE DATE(ws.recorded_at) = CURRENT_DATE AND ws.project_id = 1 "
        "GROUP BY ws.zone_name, utilization_score LIMIT 500"
    )

    corrected, fixups = auto_correct_sql(sql)

    assert "ROUND(AVG((ws.active_count::FLOAT / ws.worker_count) * 100), 1) AS utilization_score" in corrected
    assert "GROUP BY ws.zone_name" in corrected
    assert "GROUP BY ws.zone_name, utilization_score" not in corrected
    assert "grouped_ratio_avg(utilization_score)" in fixups


def test_follow_up_question_resolves_against_previous_turn():
    context = (
        "CONVERSATION HISTORY (most recent last — use to resolve follow-up references):\n"
        "[Turn 1] User: What is the current workforce utilization in each zone?\n"
        "         Answer: Zone A has 80 percent utilization."
    )

    resolved = _resolve_follow_up_question("what about yesterday?", context)

    assert "What is the current workforce utilization in each zone?" in resolved
    assert "Follow-up modification from user: what about yesterday?" in resolved


def test_follow_up_question_uses_query_context_metadata_for_these_references():
    context = (
        "CONVERSATION HISTORY (most recent last - use to resolve follow-up references):\n"
        "[Turn 1] User: Show high-risk events today\n"
        "         Resolved question: Show high-risk events today\n"
        '         Query context: {"tables": ["risk_events"], "columns": ["event_type", "risk_score"], '
        '"filters": ["risk_score >= 70 AND DATE(created_at) = CURRENT_DATE"], "group_by": []}\n'
        "         Answer: There are 5 high-risk events today."
    )

    resolved = _resolve_follow_up_question("What are the specific types of these high-risk events?", context)

    assert "Show high-risk events today" in resolved
    assert "Follow-up modification from user: What are the specific types of these high-risk events?" in resolved
    assert "risk_events" in resolved
    assert "risk_score" in resolved


def test_extract_query_context_captures_tables_columns_filters_and_result_columns():
    sql = (
        "SELECT re.event_type, COUNT(*) AS total "
        "FROM risk_events re "
        "WHERE re.project_id = 1 AND re.risk_score >= 70 "
        "GROUP BY re.event_type ORDER BY total DESC LIMIT 500"
    )

    context = _extract_query_context(sql, [{"event_type": "safety", "total": 3}])

    assert context["tables"] == ["risk_events"]
    assert "event_type" in context["columns"]
    assert "risk_score" in context["columns"]
    assert "re.risk_score >= 70" in context["filters"][0]
    assert context["group_by"] == ["re.event_type"]
    assert context["sample_result_columns"] == ["event_type", "total"]


def test_count_alias_is_rendered_as_business_label_not_cnt():
    rows = [{"cnt": 0}]
    answer = _deterministic_answer("How many PPE violations happened in Zone A this week?", {}, rows)
    evidence = _rows_to_evidence(rows)
    insights = _sanitize_insights("How many PPE violations happened in Zone A this week?", rows, [
        {"text": "This indicates a low level of safety standards.", "severity": "warning", "icon": "⚠️"}
    ])

    assert "cnt" not in answer.lower()
    assert "ppe violations" in answer.lower()
    assert evidence == [{"label": "Total", "value": "0"}]
    assert insights[0]["severity"] == "success"
    assert "No matching safety violations" in insights[0]["text"]


def test_template_matches_common_ppe_question_with_correct_time_column():
    template = match_query_template(
        "How many PPE violations happened in Zone A this week?",
        project_id=1,
        allowed_tables=["ppe_incidents"],
    )

    assert template is not None
    assert template.name == "ppe_count"
    assert "pi.started_at" in template.sql
    assert "triggered_at" not in template.sql
    assert "violation_count" in template.sql
    assert "LOWER(pi.zone_name) LIKE" in template.sql


def test_template_matches_risk_event_type_follow_up():
    template = match_query_template(
        "What are the specific types of these high-risk events?",
        project_id=1,
        allowed_tables=["risk_events"],
    )

    assert template is not None
    assert template.name == "risk_events_by_type"
    assert "re.event_type" in template.sql
    assert "re.risk_score" not in template.sql
    assert "GROUP BY re.event_type" in template.sql


def test_auto_correct_maps_risk_event_overall_risk_to_risk_score():
    sql = (
        "SELECT re.event_type, re.overall_risk "
        "FROM risk_events re "
        "WHERE re.severity IN ('high', 'critical') LIMIT 500"
    )

    corrected, fixups = auto_correct_sql(sql)

    assert "re.risk_score" in corrected
    assert "re.overall_risk" not in corrected
    assert "column_remap(risk_events: overall_risk" in " ".join(fixups)
