"""
Insight generator — calls Ollama to produce:
- A natural language answer
- Tagged insight bullets (severity + icon)
- Evidence key-value pairs
- Context-aware follow-up suggestions
"""
from __future__ import annotations

import json
import logging
import re

from . import ollama_client as ollama

logger = logging.getLogger(__name__)


def _extract_json(text: str) -> str | None:
    """Extract the outermost JSON object from text, ignoring surrounding prose."""
    start = text.find('{')
    if start == -1:
        return None
    depth = 0
    for i, ch in enumerate(text[start:], start):
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        if depth == 0:
            return text[start:i + 1]
    return None

_INSIGHT_PROMPT = """You are a construction site analytics expert producing enterprise-grade analysis.

User question: {question}

Query returned {n_rows} rows. Data summary:
{summary}

Past context (if any):
{past_context}

Respond ONLY with valid JSON matching this exact structure:
{{
  "answer": "2-3 sentences answering the question with specific numbers",
  "insights": [
    {{"text": "...", "severity": "warning"|"danger"|"success"|"info", "icon": "⚠"|"📉"|"✅"|"ℹ️"}}
  ],
  "evidence": [
    {{"label": "...", "value": "..."}}
  ],
  "follow_up_suggestions": ["...", "...", "..."]
}}

Rules:
- insights: exactly 3 items. Classify each as warning/danger/success/info.
  Use ⚠ for warning, 📉 for danger/drop, ✅ for success/good, ℹ️ for neutral info.
- evidence: 3-5 key facts extracted from the data with specific numbers.
- follow_up_suggestions: 3 natural follow-up questions based on this result.
- Be concise, professional, and data-driven. Reference specific numbers.
- Do NOT include markdown, code blocks, or explanations outside the JSON."""

_FALLBACK_RESPONSE = {
    "answer": "The query returned data but I could not generate a full analysis. Please review the evidence below.",
    "insights": [
        {"text": "Data retrieved successfully", "severity": "info", "icon": "ℹ️"},
        {"text": "Manual review recommended", "severity": "warning", "icon": "⚠"},
        {"text": "Check the evidence panel for details", "severity": "info", "icon": "ℹ️"},
    ],
    "evidence": [],
    "follow_up_suggestions": [
        "Show a breakdown by zone",
        "Compare this with last week",
        "Which area needs the most attention?",
    ],
}


async def generate_insights(
    question: str,
    rows: list[dict],
    summary: dict,
    past_context: list[dict] | None = None,
) -> dict:
    """
    Returns dict with: answer, insights (list), evidence (list), follow_up_suggestions (list).
    """
    n_rows = summary.get("total_rows", len(rows))
    summary_str = _format_summary(summary, rows[:5])
    past_str = _format_past(past_context or [])

    prompt = _INSIGHT_PROMPT.format(
        question=question,
        n_rows=n_rows,
        summary=summary_str,
        past_context=past_str,
    )

    try:
        raw = await ollama.chat(
            [{"role": "user", "content": prompt}],
            temperature=0.2,
        )
        json_str = _extract_json(raw)
        if not json_str:
            return _FALLBACK_RESPONSE
        result = json.loads(json_str)
        # Normalize
        result.setdefault("answer", _FALLBACK_RESPONSE["answer"])
        result.setdefault("insights", _FALLBACK_RESPONSE["insights"])
        result.setdefault("evidence", [])
        result.setdefault("follow_up_suggestions", _FALLBACK_RESPONSE["follow_up_suggestions"])
        return result
    except Exception as e:
        logger.warning(f"[insight_generator] LLM call failed: {e}")
        return _FALLBACK_RESPONSE


def _format_summary(summary: dict, sample_rows: list[dict]) -> str:
    lines = [f"Total rows: {summary.get('total_rows', 0)}"]

    dr = summary.get("date_range")
    if dr:
        lines.append(f"Date range: {dr.get('from', '?')} to {dr.get('to', '?')}")

    ns = summary.get("numeric_stats", {})
    for col, stats in list(ns.items())[:4]:
        lines.append(f"{col}: min={stats['min']}, max={stats['max']}, avg={stats['mean']}")

    tv = summary.get("top_values", {})
    for col, vals in list(tv.items())[:2]:
        top = ", ".join(f"{k}={v}" for k, v in list(vals.items())[:3])
        lines.append(f"{col} distribution: {top}")

    if sample_rows:
        lines.append(f"Sample row: {sample_rows[0]}")

    return "\n".join(lines)


def _format_past(past: list[dict]) -> str:
    if not past:
        return "None"
    return "\n".join(f"- Q: {p['question']} → {p['summary']}" for p in past)
