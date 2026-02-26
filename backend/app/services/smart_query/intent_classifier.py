"""
Deterministic intent detection for Smart Query.

This is deliberately lightweight: it gives the LLM a stable business-oriented
plan before SQL generation without adding another model call.
"""
from __future__ import annotations

import re


_DOMAIN_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("ppe_safety", ("ppe", "helmet", "vest", "violation", "compliance", "safety")),
    ("workforce", ("worker", "workforce", "headcount", "staff", "utilization", "idle", "overcrowded")),
    ("activity", ("activity", "productivity", "motion", "active minutes", "idle minutes", "zone state")),
    ("equipment", ("equipment", "machine", "excavator", "crane", "truck", "forklift", "bulldozer")),
    ("camera_health", ("camera", "stream", "offline", "latency", "fps", "verification", "health")),
    ("risk", ("risk", "hazard", "danger", "critical", "overall risk", "safety risk")),
    ("project_admin", ("project", "member", "invitation", "task", "note", "notification")),
]

_INTENT_KEYWORDS: list[tuple[str, tuple[str, ...]]] = [
    ("count", ("how many", "count", "number of", "total")),
    ("ranking", ("top", "highest", "lowest", "most", "least", "best", "worst")),
    ("trend", ("trend", "over time", "by day", "by week", "this week", "this month", "last 7", "last 30")),
    ("comparison", ("compare", "vs", "versus", "between", "difference")),
    ("diagnosis", ("why", "reason", "root cause", "cause", "impact", "relationship", "correlat")),
    ("status_check", ("status", "current", "right now", "online", "offline", "healthy", "problem")),
    ("list", ("show", "list", "give me", "find", "which")),
]

_TIME_HINTS: list[tuple[str, str]] = [
    ("today", "CURRENT_DATE"),
    ("yesterday", "CURRENT_DATE - INTERVAL '1 day'"),
    ("this week", "date_trunc('week', NOW())"),
    ("this month", "date_trunc('month', NOW())"),
    ("last 24", "NOW() - INTERVAL '24 hours'"),
    ("last 7", "NOW() - INTERVAL '7 days'"),
    ("last week", "date_trunc('week', NOW()) - INTERVAL '7 days'"),
    ("last 30", "NOW() - INTERVAL '30 days'"),
    ("recent", "NOW() - INTERVAL '7 days'"),
]


def classify_intent(question: str) -> dict[str, object]:
    q = question.strip().lower()
    domains = [name for name, kws in _DOMAIN_KEYWORDS if any(kw in q for kw in kws)]
    intent = next((name for name, kws in _INTENT_KEYWORDS if any(kw in q for kw in kws)), "analysis")
    time_window = next((label for hint, label in _TIME_HINTS if hint in q), None)

    asks_for_chart = bool(re.search(r"\b(graph|chart|plot|visual|trend|by day|by week|by zone)\b", q))
    requires_deep = intent in {"comparison", "diagnosis"} or len(domains) >= 2

    return {
        "intent": intent,
        "domains": domains or ["general"],
        "time_window": time_window,
        "asks_for_chart": asks_for_chart,
        "requires_deep": requires_deep,
    }


def format_intent_context(intent: dict[str, object]) -> str:
    domains = ", ".join(str(x) for x in intent.get("domains", []))
    lines = [
        "QUERY INTENT CONTEXT:",
        f"  intent_type = {intent.get('intent')}",
        f"  business_domains = {domains}",
        f"  requires_deep_analysis = {bool(intent.get('requires_deep'))}",
        f"  user_requested_chart = {bool(intent.get('asks_for_chart'))}",
    ]
    if intent.get("time_window"):
        lines.append(f"  inferred_time_window = {intent.get('time_window')}")
    return "\n".join(lines)
