"""
Enterprise Text-to-SQL pipeline for the Smart Query Assistant.

Standard mode flow (all new steps marked ← NEW):
  [1] Conversation Context Retrieval    ← NEW
  [2] Query Rewriting                   ← NEW
  [3] Business Rule Retrieval           ← NEW
  [4] Hybrid Schema Retrieval (BM25+FAISS)
  [5] Few-Shot SQL Retrieval (LlamaIndex) ← NEW
  [6] SQL Generation (enriched prompt)  ← ENHANCED
  [7] SQL Validation (unchanged)
  [8] SQL Execution (unchanged)
  [9] Pandas Analysis (unchanged)
  [10] Chart Generation (unchanged)
  [11] Insight Generation (unchanged)
  [12] Cache + History Save

Deep analysis mode flow:
  Query Rewrite + Business Rules (once for the overall question)
  → LLM decomposes into 2-3 sub-questions
  → Each sub-question runs steps 4-8 in parallel
  → Combine rows → cross-correlate → unified narrative
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import time

from . import ollama_client as ollama
from . import query_cache as cache
from . import schema_memory
from .chart_generator import generate_chart
from .data_analyzer import compute_confidence, summarize, to_dataframe
from .intent_classifier import classify_intent, format_intent_context
from .query_templates import match_query_template
from .schema_context import get_role_schema
from .sql_executor import execute_query
from .sql_validator import auto_correct_sql, validate_and_sanitize

logger = logging.getLogger(__name__)

# ── Optional new modules (graceful degradation if missing) ────────────────────

try:
    from .business_rules import get_relevant_rules as _get_rules
except ImportError:
    def _get_rules(q: str) -> str:
        return ""

try:
    from .few_shot_memory import format_few_shots, retrieve_examples
except ImportError:
    def retrieve_examples(q: str, top_k: int = 2) -> list:
        return []
    def format_few_shots(ex: list) -> str:
        return ""

try:
    from .conversation_memory import get_conversation_context as _get_conv_ctx
except ImportError:
    def _get_conv_ctx(db, user_id: int, conversation_id, max_turns: int = 4) -> str:
        return ""


# ── Fallback messages ─────────────────────────────────────────────────────────

_FALLBACKS: dict[str, str] = {
    "no_data": (
        "No data found for that query. The selected time range may have no records, "
        "or analytics may not be enabled for this project yet."
    ),
    "sql_invalid": (
        "I couldn't generate a valid query for that question. "
        "Try rephrasing it — for example, mention a specific zone, date range, or metric."
    ),
    "sql_error": (
        "The query ran into an error. Try a simpler or more specific question."
    ),
    "ollama_down": (
        "The AI engine is temporarily unavailable. Please try again in a moment."
    ),
    "timeout": (
        "That query took too long. Try specifying a shorter time range or a more specific zone."
    ),
    "generic": (
        "Something went wrong while processing your question. Please try again."
    ),
}

_PG_ERROR_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"column .+ does not exist", re.IGNORECASE),
     "The query referenced an invalid column. Try rephrasing your question."),
    (re.compile(r"relation .+ does not exist", re.IGNORECASE),
     "The query referenced an unknown table. Try rephrasing your question."),
    (re.compile(r"syntax error at or near", re.IGNORECASE),
     "The generated SQL had a syntax error. Try a simpler or more specific question."),
    (re.compile(r"operator does not exist", re.IGNORECASE),
     "A type mismatch occurred. Try specifying the value more explicitly."),
    (re.compile(r"division by zero", re.IGNORECASE),
     "Division by zero — the dataset may be empty for that time range."),
    (re.compile(r"(statement timeout|canceling statement)", re.IGNORECASE),
     "Query took too long. Try a shorter time range or more specific filters."),
    (re.compile(r"permission denied", re.IGNORECASE),
     "Access to that data is restricted for your role."),
    (re.compile(r"invalid input syntax", re.IGNORECASE),
     "A value in the query was in the wrong format. Try rephrasing your question."),
    (re.compile(r"out of range", re.IGNORECASE),
     "A numeric value in the query was out of the allowed range."),
]


def _sanitize_db_error(raw: str) -> str:
    for pattern, safe_msg in _PG_ERROR_PATTERNS:
        if pattern.search(raw):
            return safe_msg
    return "The query ran into a database error. Try rephrasing your question."


_CONVERSATIONAL_PATTERNS = (
    r"^(hi|hello|hey|thanks|thank you|help|what can you do|who are you|how are you)",
)

_DEEP_ANALYSIS_HINTS = (
    "why", "reason", "root cause", "correlat", "compare", "comparison",
    "versus", "vs", "relationship", "impact", "across", "combined",
    "overall", "summary", "trend and", "risk and", "ppe and", "workforce and",
    "activity and", "equipment and",
)

_FOLLOW_UP_HINTS = (
    "what about", "how about", "and ", "also", "same", "that", "those", "these",
    "yesterday", "today", "last week", "this week", "last month", "this month",
    "by zone", "by camera", "by day", "make it", "graph", "chart", "plot",
    "show more", "more details", "compare it", "only critical", "open ones",
    "specific types", "types of", "breakdown", "break down",
)

def _is_conversational(question: str) -> bool:
    q = question.strip().lower()
    for pat in _CONVERSATIONAL_PATTERNS:
        if re.match(pat, q):
            return True
    return False


def _choose_strategy(question: str, requested_mode: str) -> str:
    """
    Single enterprise strategy selector.
    Auto mode keeps direct questions fast, but routes diagnostic/comparative
    questions to deep analysis where multiple SQL passes can support a richer
    answer.
    """
    if requested_mode == "deep":
        return "deep"
    if requested_mode == "auto":
        q = question.lower()
        if any(hint in q for hint in _DEEP_ANALYSIS_HINTS):
            return "deep"
    return "standard"


def _resolve_follow_up_question(question: str, conversation_context: str) -> str:
    """
    Turn vague follow-ups into a complete analytical question using prior turns.
    This is deterministic on purpose: it avoids the old LLM rewrite path that
    sometimes invented pseudo-columns.
    """
    if not conversation_context:
        return question

    q = question.strip()
    q_lower = q.lower()
    if len(q.split()) > 10 and not any(hint in q_lower for hint in ("that", "it", "those", "these", "same")):
        return question
    if not any(hint in q_lower for hint in _FOLLOW_UP_HINTS):
        return question

    prior_resolved = re.findall(r"Resolved question:\s*(.+)", conversation_context)
    prior_questions = re.findall(r"\[Turn \d+\] User:\s*(.+)", conversation_context)
    prior_contexts = re.findall(r"Query context:\s*(\{.+?\})(?:\n|$)", conversation_context)
    if not prior_questions:
        return question

    previous = (prior_resolved[-1] if prior_resolved else prior_questions[-1]).strip()
    if not previous:
        return question

    context_line = f"\nPrevious query context metadata: {prior_contexts[-1][:500]}" if prior_contexts else ""
    return (
        f"{previous}\n"
        f"Follow-up modification from user: {q}\n"
        f"{context_line}\n"
        "Resolve the follow-up using the previous question's metric, entity, project scope, "
        "and filters unless the follow-up explicitly changes them."
    )


def _extract_query_context(sql: str | None, rows: list[dict] | None = None) -> dict:
    sql_text = sql or ""
    tables = sorted(set(re.findall(r"\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)", sql_text, re.IGNORECASE)))
    col_pairs = re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)", sql_text)
    columns = sorted({col for _, col in col_pairs})
    filters = []
    where_match = re.search(r"\bWHERE\s+([\s\S]+?)(?:\bGROUP\s+BY\b|\bORDER\s+BY\b|\bLIMIT\b|$)", sql_text, re.IGNORECASE)
    if where_match:
        filters.append(re.sub(r"\s+", " ", where_match.group(1)).strip()[:300])
    group_by = []
    group_match = re.search(r"\bGROUP\s+BY\s+([\s\S]+?)(?:\bORDER\s+BY\b|\bLIMIT\b|$)", sql_text, re.IGNORECASE)
    if group_match:
        group_by = [item.strip() for item in group_match.group(1).split(",") if item.strip()]
    sample_cols = list((rows or [{}])[0].keys())[:8] if rows else []
    return {
        "tables": tables[:8],
        "columns": columns[:16],
        "filters": filters,
        "group_by": group_by[:8],
        "sample_result_columns": sample_cols,
    }


def _conversational_response(question: str) -> dict:
    return _build_response(
        answer=(
            "Hi! I'm your Smart Query Assistant. Ask me anything about your construction site data — "
            "PPE violations, workforce utilization, camera health, zone activity, risk scores, and more. "
            "Your questions can be in any form; I'll find the data for you."
        ),
        insights=[{"text": "Try asking: 'How many PPE violations occurred today?'", "severity": "info", "icon": "💡"}],
    )


def _error_response(key: str, detail: str | None = None) -> dict:
    msg = _FALLBACKS.get(key, _FALLBACKS["generic"])
    if detail and key == "sql_invalid":
        msg = f"{msg} (Detail: {detail})"
    return _build_response(answer=msg, error_message=msg, confidence="LOW")


def _build_response(
    answer: str = "",
    insights: list[dict] | None = None,
    evidence: list[dict] | None = None,
    chart: dict | None = None,
    sql_used: str | None = None,
    duration_ms: int = 0,
    rows_returned: int = 0,
    confidence: str = "LOW",
    cached: bool = False,
    follow_up_suggestions: list[str] | None = None,
    error_message: str | None = None,
    mode: str = "standard",
    resolved_question: str | None = None,
    query_context: dict | None = None,
) -> dict:
    return {
        "answer": answer,
        "insights": insights or [],
        "evidence": evidence or [],
        "chart": chart,
        "sql_used": sql_used,
        "duration_ms": duration_ms,
        "rows_returned": rows_returned,
        "confidence": confidence,
        "cached": cached,
        "follow_up_suggestions": follow_up_suggestions or [],
        "error_message": error_message,
        "mode": mode,
        "resolved_question": resolved_question,
        "query_context": query_context or {},
    }


def _rows_to_evidence(rows: list[dict]) -> list[dict]:
    """Flatten DB rows into label/value evidence items for display."""
    evidence: list[dict] = []
    for row in rows:
        for key, val in row.items():
            evidence.append({
                "label": _humanize_key(str(key)),
                "value": str(val) if val is not None else "—",
            })
        if len(evidence) >= 40:
            break
    return evidence[:40]


def _humanize_key(key: str, question: str = "") -> str:
    raw = str(key or "").strip()
    lower = raw.lower()
    q = (question or "").lower()
    if lower in {"cnt", "count"}:
        if "ppe" in q or "helmet" in q or "vest" in q:
            return "PPE Violations"
        if "risk" in q:
            return "Risk Events"
        if "camera" in q:
            return "Cameras"
        if "worker" in q or "workforce" in q:
            return "Workers"
        if "equipment" in q:
            return "Equipment Events"
        return "Total"
    aliases = {
        "total": "Total",
        "total_count": "Total",
        "violation_count": "Violations",
        "incident_count": "Incidents",
        "event_count": "Events",
        "alert_count": "Alerts",
        "zone_name": "Zone",
        "camera_name": "Camera",
        "event_type": "Event Type",
        "violation_type": "Violation Type",
        "risk_score": "Risk Score",
        "overall_risk": "Overall Risk",
        "recorded_at": "Recorded At",
        "started_at": "Started At",
        "created_at": "Created At",
    }
    return aliases.get(lower, raw.replace("_", " ").title())


def _format_row_summary(row: dict, question: str, max_items: int = 4) -> str:
    visible = [
        (str(k), v)
        for k, v in row.items()
        if v is not None and not str(k).lower().endswith("_id")
    ]
    return ", ".join(
        f"{_humanize_key(k, question)}: {v}"
        for k, v in visible[:max_items]
    )


def _compact_rows_for_prompt(rows: list[dict], limit: int = 8, question: str = "") -> list[dict]:
    """Keep enough row detail for narrative answers without bloating the prompt."""
    compact: list[dict] = []
    for row in rows[:limit]:
        item: dict = {}
        for key, val in row.items():
            text = str(val) if val is not None else ""
            item[_humanize_key(str(key), question)] = text[:140]
        compact.append(item)
    return compact


def _summary_for_insights(summary: dict, rows: list[dict], question: str) -> dict:
    enriched = dict(summary)
    enriched["sample_rows"] = _compact_rows_for_prompt(rows, question=question)
    enriched["returned_rows"] = len(rows)
    enriched["answer_style"] = (
        "diagnostic_reasoned_analysis"
        if any(hint in question.lower() for hint in _DEEP_ANALYSIS_HINTS)
        else "direct_data_answer"
    )
    return enriched


def _deterministic_answer(question: str, summary: dict, rows: list[dict]) -> str:
    row_count = len(rows)
    columns = summary.get("columns") or list(rows[0].keys()) if rows else []
    if row_count == 1 and rows and len(rows[0]) == 1:
        key, value = next(iter(rows[0].items()))
        return (
            f"The result is **{value} {_humanize_key(str(key), question).lower()}**.\n\n"
            "**What the data shows:** This is a single aggregate result, so there is no category breakdown yet.\n\n"
            "**Recommended next step:** Ask for the same metric by date, zone, status, or type if you want a chart or comparison."
        )
    parts = [
        f"I found {row_count} matching record{'s' if row_count != 1 else ''} for your question.",
    ]
    if columns:
        labels = [_humanize_key(str(col), question) for col in columns[:6]]
        parts.append(f"**What the data shows:** The result includes {', '.join(labels)}.")

    sample = _compact_rows_for_prompt(rows, limit=3, question=question)
    if sample:
        highlights = []
        for item in sample:
            row_summary = _format_row_summary(item, question)
            if row_summary:
                highlights.append(row_summary)
        if highlights:
            parts.append("**Evidence:** " + " | ".join(highlights))

    parts.append(
        "**Recommended next step:** Ask for a trend, comparison, or specific date range if you want the assistant "
        "to explain causes or changes more deeply."
    )
    return "\n\n".join(parts)


def _needs_answer_expansion(answer: str) -> bool:
    stripped = (answer or "").strip()
    if not stripped:
        return True
    generic_bits = (
        "analysis complete",
        "review the evidence panel",
        "deep analysis across",
        "data retrieved successfully",
    )
    return len(stripped.split()) < 35 or any(bit in stripped.lower() for bit in generic_bits)


def _expand_answer(answer: str, question: str, summary: dict, rows: list[dict], chart: dict | None = None) -> str:
    base = (answer or "").strip()
    sections: list[str] = []
    if base and not any(bit in base.lower() for bit in ("deep analysis across", "analysis complete")):
        sections.append(base)
    else:
        sections.append(_deterministic_answer(question, summary, rows).split("\n\n")[0])

    sample = _compact_rows_for_prompt(rows, limit=4, question=question)
    if sample:
        bullets = []
        for item in sample:
            row_summary = _format_row_summary(item, question)
            if row_summary:
                bullets.append("- " + row_summary)
        if bullets:
            sections.append("**What the data shows:**\n" + "\n".join(bullets))

    if chart:
        sections.append("**Graph status:** I generated a chart from the returned metrics so the comparison is visible, not only listed as evidence.")
    elif any(word in question.lower() for word in ("graph", "chart", "plot", "visual")):
        sections.append(
            "**Graph status:** I could not draw a reliable chart from this result shape. "
            "A chart needs at least a category/date plus a number, or two comparable numeric metrics."
        )

    sections.append(
        "**Recommended next step:** For a clearer comparison, ask for a specific grouping such as by date, by zone, by incident status, or by violation type."
    )
    return "\n\n".join(sections)


def _count_total(rows: list[dict]) -> float | None:
    total = 0.0
    seen = False
    count_keys = {"cnt", "count", "total", "total_count", "violation_count", "incident_count", "event_count"}
    for row in rows:
        for key, value in row.items():
            if str(key).lower() in count_keys:
                try:
                    total += float(value or 0)
                    seen = True
                except (TypeError, ValueError):
                    pass
    return total if seen else None


def _sanitize_insights(question: str, rows: list[dict], insights: list[dict] | None) -> list[dict]:
    cleaned = list(insights or [])
    q = (question or "").lower()
    total = _count_total(rows)
    if total == 0 and any(word in q for word in ("ppe", "helmet", "vest", "violation", "incident")):
        return [{
            "text": "No matching safety violations were found for the selected filters.",
            "severity": "success",
            "icon": "✅",
        }]
    return cleaned


def _sanitize_answer_labels(answer: str, question: str) -> str:
    label = _humanize_key("cnt", question)
    cleaned = re.sub(r"\bCnt\s*:", f"{label}:", answer or "", flags=re.IGNORECASE)
    cleaned = re.sub(r"\bcnt\b", label.lower(), cleaned, flags=re.IGNORECASE)
    return cleaned


async def _analyze_successful_rows(
    *,
    question: str,
    rows: list[dict],
    sql_used: str,
    start: float,
    conv_ctx: str,
    mode: str,
    resolved_question: str,
    cache_key: tuple[str, int, str] | None = None,
) -> dict:
    df = to_dataframe(rows)
    summary = summarize(df)
    summary_for_prompt = _summary_for_insights(summary, rows, question)
    confidence = compute_confidence(rows, has_error=False)
    chart = generate_chart(df, mode, question)

    try:
        insight_result = await ollama.generate_insights(
            question, summary_for_prompt, conversation_context=conv_ctx or None
        )
    except Exception:
        insight_result = {
            "answer": _deterministic_answer(question, summary_for_prompt, rows),
            "insights": [{"text": "Data retrieved successfully.", "severity": "info", "icon": "📊"}],
            "follow_ups": [],
        }

    if not insight_result.get("answer"):
        insight_result["answer"] = _deterministic_answer(question, summary_for_prompt, rows)
    elif _needs_answer_expansion(insight_result.get("answer", "")):
        insight_result["answer"] = _expand_answer(
            insight_result.get("answer", ""),
            question,
            summary_for_prompt,
            rows,
            chart,
        )
    insight_result["answer"] = _sanitize_answer_labels(insight_result.get("answer", ""), question)
    insight_result["insights"] = _sanitize_insights(question, rows, insight_result.get("insights", []))

    response = _build_response(
        answer=insight_result.get("answer", ""),
        insights=insight_result.get("insights", []),
        evidence=_rows_to_evidence(rows),
        chart=chart,
        sql_used=sql_used,
        duration_ms=int((time.monotonic() - start) * 1000),
        rows_returned=len(rows),
        confidence=confidence,
        follow_up_suggestions=insight_result.get("follow_ups", []),
        mode=mode,
        resolved_question=resolved_question,
        query_context=_extract_query_context(sql_used, rows),
    )
    if cache_key:
        role, project_id, original_question = cache_key
        cache.set(role, project_id, original_question, response)
    return response


# ── Shared enrichment helper ──────────────────────────────────────────────────

async def _build_enrichment(
    question: str,
    db,
    user_id: int,
    conversation_id: str | None,
) -> tuple[str, str, str, str]:
    """
    Run all new upstream enrichment steps for a question.
    Returns (rewritten, rules, few_shots, conv_ctx).
    All steps are non-blocking — any failure returns '' and pipeline continues.
    """
    # [1] Conversation context (DB query — fast)
    try:
        conv_ctx = _get_conv_ctx(db, user_id, conversation_id) if conversation_id and db else ""
    except Exception:
        conv_ctx = ""

    # [2] Keep the user's wording as the retrieval/generation anchor.
    # LLM query rewriting can invent pseudo-columns such as "incident_date",
    # which is dangerous for text-to-SQL. Deterministic intent context below
    # gives the model guidance without changing the user's schema vocabulary.
    rewritten = _resolve_follow_up_question(question, conv_ctx)

    # [3] Intent + business rules (pure Python keyword match — <1ms)
    try:
        intent_context = format_intent_context(classify_intent(rewritten or question))
        business_rules = _get_rules(question)
        rules = "\n\n".join(part for part in (intent_context, business_rules) if part)
    except Exception:
        rules = ""

    # [4] Few-shot retrieval (LlamaIndex FAISS — ~10-30ms)
    try:
        few_shots = format_few_shots(retrieve_examples(rewritten, top_k=2))
    except Exception:
        few_shots = ""

    return rewritten, rules, few_shots, conv_ctx


# ── Sub-query executor (used by deep mode) ───────────────────────────────────

async def _run_single_sql(
    question: str,
    role: str,
    project_id: int | None,
    allowed_tables: list[str],
    schema_text: str,
    business_rules_str: str = "",
    few_shot_str: str = "",
    rewritten_intent: str = "",
    conv_ctx: str = "",
) -> tuple[str, list[dict], str | None]:
    """
    Run one SQL query for a sub-question.
    Returns (question, rows, sql_used). rows is empty list on failure.
    """
    try:
        sql_raw = await ollama.generate_sql(
            question=question,
            role=role,
            project_id=project_id,
            schema_text=schema_text,
            allowed_tables=allowed_tables,
            business_rules=business_rules_str or None,
            few_shot_examples=few_shot_str or None,
            rewritten_intent=rewritten_intent if rewritten_intent != question else None,
            conversation_context=conv_ctx or None,
        )
    except Exception:
        return question, [], None

    sql_corrected, corrections = auto_correct_sql(sql_raw)
    if corrections:
        logger.info(f"[pipeline:deep] SQL auto-corrected for '{question[:60]}': {corrections}")
    ok, sql, _ = validate_and_sanitize(sql_corrected, allowed_tables)
    if not ok:
        return question, [], None

    try:
        rows = await asyncio.wait_for(
            execute_query(sql, params={"project_id": project_id}),
            timeout=10.0,
        )
        return question, rows, sql
    except Exception:
        return question, [], None


# ── Main pipeline entry point ─────────────────────────────────────────────────

async def run(
    question: str,
    role: str,
    project_id: int | None,
    user_id: int,
    mode: str = "standard",
    force_refresh: bool = False,
    db=None,
    conversation_id: str | None = None,
) -> dict:
    start = time.monotonic()

    if _is_conversational(question):
        return _conversational_response(question)

    if not await ollama.health_check():
        return _error_response("ollama_down")

    strategy = _choose_strategy(question, mode)

    if strategy == "deep":
        return await _run_deep(question, role, project_id, user_id, start, db, conversation_id)
    return await _run_standard(question, role, project_id, user_id, force_refresh, start, db, conversation_id)


# ── Standard mode ─────────────────────────────────────────────────────────────

async def _run_standard(
    question: str,
    role: str,
    project_id: int | None,
    user_id: int,
    force_refresh: bool,
    start: float,
    db,
    conversation_id: str | None,
) -> dict:
    """
    Standard mode: enrichment → hybrid Schema RAG → SQL → validate → execute → insights.
    Fast (~4-10s with enrichment). Best for direct questions.
    """
    # Cache check (before any enrichment — cached responses skip all new steps)
    if not force_refresh:
        cached = cache.get(role, project_id, question)
        if cached:
            return {**cached, "cached": True}

    # ── Upstream enrichment ───────────────────────────────────────────────────
    rewritten, rules, few_shots, conv_ctx = await _build_enrichment(
        question, db, user_id, conversation_id
    )

    # ── Schema RAG (uses rewritten query for better table matching) ───────────
    allowed_tables, schema_text = get_role_schema(role, rewritten)

    template = match_query_template(rewritten or question, project_id, allowed_tables)
    if template:
        sql_corrected, corrections = auto_correct_sql(template.sql)
        if corrections:
            logger.info(f"[pipeline:template] SQL auto-corrected: {corrections}")
        ok, sanitized_sql, err = validate_and_sanitize(sql_corrected, allowed_tables)
        if ok:
            try:
                rows = await asyncio.wait_for(execute_query(db, sanitized_sql), timeout=15.0)
                return await _analyze_successful_rows(
                    question=question,
                    rows=rows,
                    sql_used=sanitized_sql,
                    start=start,
                    conv_ctx=conv_ctx,
                    mode="template",
                    resolved_question=rewritten,
                    cache_key=(role, project_id, question),
                )
            except Exception as exec_err:
                logger.warning(
                    f"[pipeline:template] Template {template.name} failed; falling back to LLM SQL: {exec_err}"
                )
        else:
            logger.warning(
                f"[pipeline:template] Template {template.name} invalid; falling back to LLM SQL: {err}"
            )

    # ── SQL generation with retry ─────────────────────────────────────────────
    sql_raw, sanitized_sql, rows = None, None, None
    last_error: str | None = None

    for attempt in range(2):
        try:
            sql_raw = await ollama.generate_sql(
                question=question,
                role=role,
                project_id=project_id,
                schema_text=schema_text,
                allowed_tables=allowed_tables,
                error_feedback=last_error if attempt > 0 else None,
                business_rules=rules or None,
                few_shot_examples=few_shots or None,
                rewritten_intent=rewritten if rewritten != question else None,
                conversation_context=conv_ctx or None,
            )
        except Exception as e:
            logger.error(f"[pipeline:standard] SQL generation failed (attempt {attempt+1}): {e}")
            return _error_response("ollama_down")

        sql_corrected, corrections = auto_correct_sql(sql_raw)
        if corrections:
            logger.info(f"[pipeline:standard] SQL auto-corrected (attempt {attempt+1}): {corrections}")

        ok, sanitized_sql, err = validate_and_sanitize(sql_corrected, allowed_tables)
        if not ok:
            last_error = err
            logger.warning(f"[pipeline:standard] SQL invalid (attempt {attempt+1}): {err}")
            if attempt == 0:
                continue
            return _error_response("sql_invalid", err)

        try:
            rows = await asyncio.wait_for(
                execute_query(sanitized_sql, params={"project_id": project_id}),
                timeout=10.0,
            )
            break
        except asyncio.TimeoutError:
            return _error_response("timeout")
        except Exception as e:
            exec_err = str(e)
            safe_err = _sanitize_db_error(exec_err)
            last_error = f"SQL execution error: {exec_err}"
            logger.error(f"[pipeline:standard] SQL execution error (attempt {attempt+1}): {exec_err}")
            if attempt == 0:
                continue
            return _build_response(
                answer=_FALLBACKS["sql_error"],
                error_message=safe_err,
                confidence="LOW",
            )

    if rows is None:
        return _error_response("sql_error")

    if not rows:
        duration = int((time.monotonic() - start) * 1000)
        return {**_error_response("no_data"), "sql_used": sanitized_sql, "duration_ms": duration, "mode": "standard"}

    # ── Analysis, chart, insights ─────────────────────────────────────────────
    df = to_dataframe(rows)
    summary = summarize(df)
    summary_for_prompt = _summary_for_insights(summary, rows, question)
    confidence = compute_confidence(rows, has_error=False)
    chart = generate_chart(df, "standard", question)

    try:
        insight_result = await ollama.generate_insights(
            question, summary_for_prompt, conversation_context=conv_ctx or None
        )
    except Exception:
        insight_result = {
            "answer": _deterministic_answer(question, summary_for_prompt, rows),
            "insights": [{"text": "Data retrieved successfully.", "severity": "info", "icon": "📊"}],
            "follow_ups": [],
        }

    if not insight_result.get("answer"):
        insight_result["answer"] = _deterministic_answer(question, summary_for_prompt, rows)
    elif _needs_answer_expansion(insight_result.get("answer", "")):
        insight_result["answer"] = _expand_answer(
            insight_result.get("answer", ""),
            question,
            summary_for_prompt,
            rows,
            chart,
        )
    insight_result["answer"] = _sanitize_answer_labels(insight_result.get("answer", ""), question)
    insight_result["insights"] = _sanitize_insights(question, rows, insight_result.get("insights", []))

    duration = int((time.monotonic() - start) * 1000)
    response = _build_response(
        answer=insight_result.get("answer", ""),
        insights=insight_result.get("insights", []),
        evidence=_rows_to_evidence(rows),
        chart=chart,
        sql_used=sanitized_sql,
        duration_ms=duration,
        rows_returned=len(rows),
        confidence=confidence,
        follow_up_suggestions=insight_result.get("follow_ups", []),
        mode="standard",
        resolved_question=rewritten,
        query_context=_extract_query_context(sanitized_sql, rows),
    )

    cache.set(role, project_id, question, response)
    schema_memory.remember_query(user_id, question, insight_result.get("answer", "")[:200])
    return response


# ── Deep analysis mode ────────────────────────────────────────────────────────

async def _run_deep(
    question: str,
    role: str,
    project_id: int | None,
    user_id: int,
    start: float,
    db,
    conversation_id: str | None,
) -> dict:
    """
    Deep analysis mode:
      1. Enrichment (rewrite + rules + few-shots + conv context)
      2. LLM decomposes into 2-3 targeted sub-questions
      3. Each sub-question runs Schema RAG → SQL → execute in parallel
      4. Combine rows → cross-correlated narrative insight
    """
    # ── Enrichment (shared across all sub-questions) ──────────────────────────
    rewritten, rules, few_shots, conv_ctx = await _build_enrichment(
        question, db, user_id, conversation_id
    )

    allowed_tables, _ = get_role_schema(role, rewritten)

    # ── Decompose into sub-questions ──────────────────────────────────────────
    decompose_prompt = (
        f"You are analyzing a construction site management question.\n"
        f"Break this question into exactly 2-3 specific sub-questions, each answerable with a single SQL query.\n\n"
        f"Original question: {question}\n"
        f"{'Analytical intent: ' + rewritten if rewritten != question else ''}\n\n"
        "Respond ONLY with valid JSON (no explanation):\n"
        '{"sub_questions": ["specific sub-question 1", "specific sub-question 2", "specific sub-question 3"]}'
    )

    try:
        raw = await ollama.chat([{"role": "user", "content": decompose_prompt}], temperature=0.1)
        match = re.search(r"\{[\s\S]*\}", raw)
        sub_questions: list[str] = json.loads(match.group()).get("sub_questions", []) if match else []
    except Exception:
        sub_questions = []

    if not sub_questions:
        sub_questions = [question]
    sub_questions = sub_questions[:3]

    # ── Run sub-questions in parallel ─────────────────────────────────────────
    async def _run_one(sq: str):
        _, sq_schema = get_role_schema(role, sq)
        return await _run_single_sql(
            sq, role, project_id, allowed_tables, sq_schema,
            business_rules_str=rules,
            few_shot_str=few_shots,
            rewritten_intent=sq,
            conv_ctx=conv_ctx,
        )

    results: list[tuple[str, list[dict], str | None]] = await asyncio.gather(
        *[_run_one(sq) for sq in sub_questions]
    )

    # ── Combine results ───────────────────────────────────────────────────────
    all_rows: list[dict] = []
    sqls_used: list[str] = []
    sub_summaries: list[str] = []

    for sq, rows, sql in results:
        all_rows.extend(rows[:150])
        if sql:
            sqls_used.append(sql)
        df_sq = to_dataframe(rows)
        s = summarize(df_sq)
        sub_summaries.append(
            f"Sub-question: {sq}\n  Rows returned: {len(rows)}\n  Summary: {json.dumps(s, default=str)[:300]}"
        )

    if not all_rows:
        return {**_error_response("no_data"), "mode": "deep"}

    df_all = to_dataframe(all_rows)
    combined_summary = summarize(df_all)
    combined_summary["sub_question_results"] = sub_summaries
    combined_summary["sample_rows"] = _compact_rows_for_prompt(all_rows, limit=10, question=question)
    confidence = compute_confidence(all_rows, has_error=False)
    chart = generate_chart(df_all, "deep_analysis", question)

    # ── Cross-correlated narrative ─────────────────────────────────────────────
    deep_prompt = (
        "You are a construction site analytics expert performing deep analysis.\n\n"
        f"The user asked: {question}\n"
        f"{'Analytical intent: ' + rewritten + chr(10) if rewritten != question else ''}"
        f"{'Prior context: ' + conv_ctx[:300] + chr(10) if conv_ctx else ''}\n"
        f"This was broken into {len(sub_questions)} sub-questions and executed in parallel:\n"
        f"{chr(10).join(sub_summaries)}\n\n"
        f"Combined data summary:\n{json.dumps(combined_summary, default=str)[:1800]}\n\n"
        "Generate a comprehensive cross-correlated analysis. Return ONLY valid JSON:\n"
        "{\n"
        '  "answer": "Detailed Markdown answer with direct answer, evidence, likely reason or limitation, and recommended next step",\n'
        '  "insights": [\n'
        '    {"text": "Cross-feature insight 1 with specific numbers", "severity": "info", "icon": "📊"},\n'
        '    {"text": "Trend or correlation found across sub-questions", "severity": "warning", "icon": "⚠️"},\n'
        '    {"text": "Actionable finding or positive trend", "severity": "success", "icon": "✅"}\n'
        "  ],\n"
        '  "follow_ups": ["Deeper follow-up question 1?", "Deeper follow-up question 2?"]\n'
        "}\n\n"
        "severity must be one of: success, warning, danger, info"
    )

    try:
        raw = await ollama.chat([{"role": "user", "content": deep_prompt}], temperature=0.25, num_predict=1800)
        match = re.search(r"\{[\s\S]*\}", raw)
        insight_result = json.loads(match.group()) if match else {}
    except Exception:
        insight_result = {}

    if not insight_result.get("answer"):
        insight_result = {
            "answer": _expand_answer("", question, combined_summary, all_rows, chart),
            "insights": [{"text": "Analysis complete. Review the evidence panel for details.", "severity": "info", "icon": "📊"}],
            "follow_ups": [],
        }
    elif _needs_answer_expansion(insight_result.get("answer", "")):
        insight_result["answer"] = _expand_answer(
            insight_result.get("answer", ""),
            question,
            combined_summary,
            all_rows,
            chart,
        )
    insight_result["answer"] = _sanitize_answer_labels(insight_result.get("answer", ""), question)
    insight_result["insights"] = _sanitize_insights(question, all_rows, insight_result.get("insights", []))

    duration = int((time.monotonic() - start) * 1000)
    sql_summary = f"-- Deep analysis: {len(sqls_used)} SQL queries executed in parallel\n" + "\n-- ".join(sqls_used[:3])

    response = _build_response(
        answer=insight_result.get("answer", ""),
        insights=insight_result.get("insights", []),
        evidence=_rows_to_evidence(all_rows),
        chart=chart,
        sql_used=sql_summary,
        duration_ms=duration,
        rows_returned=len(all_rows),
        confidence=confidence,
        follow_up_suggestions=insight_result.get("follow_ups", []),
        mode="deep",
        resolved_question=rewritten,
        query_context=_extract_query_context(sqls_used[0] if sqls_used else None, all_rows),
    )

    schema_memory.remember_query(user_id, question, insight_result.get("answer", "")[:200])
    return response
