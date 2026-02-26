"""
Async Ollama client — communicates with local Ollama server (http://localhost:11434).
Model: deepseek-coder:6.7b (configurable via OLLAMA_MODEL env var).

New in this version:
  - rewrite_query()     — transforms vague questions to precise analytical intent
  - generate_sql()      — now accepts business_rules, few_shot_examples,
                          rewritten_intent, and conversation_context for richer prompts;
                          returns structured JSON {reasoning, plan, sql}
  - Tool-aware prompting — SQL prompt lists available data sources
  - Structured output   — SQL generation now returns JSON instead of free-text CoT
"""
import json
import os
import re
from datetime import date

import httpx

OLLAMA_BASE = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "deepseek-coder:6.7b")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
SMART_QUERY_LLM_PROVIDER = os.getenv("SMART_QUERY_LLM_PROVIDER", "ollama").lower()
ACTIVE_MODEL = GEMINI_MODEL if GEMINI_API_KEY and SMART_QUERY_LLM_PROVIDER == "gemini" else OLLAMA_MODEL
_TIMEOUT = httpx.Timeout(120.0, connect=5.0)


# ── Core chat ─────────────────────────────────────────────────────────────────

async def health_check() -> bool:
    if GEMINI_API_KEY and SMART_QUERY_LLM_PROVIDER == "gemini":
        return True
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            return r.status_code == 200
    except Exception:
        return False


async def chat(messages: list[dict], temperature: float = 0.1, num_predict: int = 1024) -> str:
    """
    Single-shot chat completion.
    messages: [{"role": "system"|"user"|"assistant", "content": str}]
    Returns the assistant reply as a string.
    """
    if GEMINI_API_KEY and SMART_QUERY_LLM_PROVIDER == "gemini":
        try:
            return await _gemini_chat(messages, temperature=temperature, num_predict=num_predict)
        except Exception:
            # Keep demos resilient: Gemini first, local Ollama fallback.
            pass

    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": num_predict},
    }
    if "qwen3" in OLLAMA_MODEL.lower():
        payload["think"] = False
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()
        raw = data["message"]["content"].strip()
        # Strip any residual <think>...</think> blocks qwen3 may still emit
        raw = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.IGNORECASE).strip()
        return raw


async def _gemini_chat(messages: list[dict], temperature: float = 0.1, num_predict: int = 1024) -> str:
    system_parts: list[str] = []
    contents: list[dict] = []

    for msg in messages:
        role = msg.get("role", "user")
        content = str(msg.get("content", ""))
        if role == "system":
            system_parts.append(content)
            continue
        contents.append({
            "role": "model" if role == "assistant" else "user",
            "parts": [{"text": content}],
        })

    if not contents:
        contents = [{"role": "user", "parts": [{"text": ""}]}]

    payload: dict = {
        "contents": contents,
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": num_predict,
        },
    }
    if system_parts:
        payload["systemInstruction"] = {"parts": [{"text": "\n\n".join(system_parts)}]}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(url, params={"key": GEMINI_API_KEY}, json=payload)
        r.raise_for_status()
        data = r.json()

    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    raw = "".join(str(part.get("text", "")) for part in parts).strip()
    raw = re.sub(r"<think>[\s\S]*?</think>", "", raw, flags=re.IGNORECASE).strip()
    return raw


# ── Query rewriting ───────────────────────────────────────────────────────────

async def rewrite_query(question: str) -> str:
    """
    Transform a vague user question into a precise analytical query intent.
    Examples:
      "most used machine recently"
        → "Find equipment with highest total active runtime in last 7 days"
      "any issues with cameras?"
        → "Find cameras where worker_status = 'error' or registry_status = 'verify_failed'"

    Returns the original question unchanged on any failure (Ollama down, empty
    result, exception) so the pipeline always continues safely.

    Temperature: 0.1 (low — we want deterministic, precise rewrites)
    max_tokens: 120 (one sentence, no padding)
    """
    system = (
        "You are a query intent analyser for a construction site management system.\n\n"
        "Transform the user's natural language question into a precise analytical query intent.\n\n"
        "Rules:\n"
        "- Replace vague terms with precise analytical concepts\n"
        "  ('most used' → 'highest total active runtime')\n"
        "  ('any issues' → 'errors or failed status')\n"
        "  ('idle' → 'idle_count > 0 or no movement for > 15 minutes')\n"
        "- If no time range is specified, default to 'last 7 days'\n"
        "- Name the specific metric or aggregation being requested\n"
        "- Return exactly one sentence\n"
        "- If the question is already precise, return it unchanged\n\n"
        "Return ONLY the rewritten query — no explanation, no prefix, nothing else."
    )
    try:
        payload = {
            "model": OLLAMA_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": question},
            ],
            "stream": False,
            "options": {"temperature": 0.1, "num_predict": 120},
        }
        if "qwen3" in OLLAMA_MODEL.lower():
            payload["think"] = False
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            r = await client.post(f"{OLLAMA_BASE}/api/chat", json=payload)
            r.raise_for_status()
            data = r.json()
            result = data["message"]["content"].strip()
            result = re.sub(r"<think>[\s\S]*?</think>", "", result, flags=re.IGNORECASE).strip()
            return result if result else question
    except Exception:
        return question


# ── SQL generation ────────────────────────────────────────────────────────────

async def generate_sql(
    question: str,
    role: str,
    project_id: int | None,
    schema_text: str,
    allowed_tables: list[str],
    error_feedback: str | None = None,
    business_rules: str | None = None,
    few_shot_examples: str | None = None,
    rewritten_intent: str | None = None,
    conversation_context: str | None = None,
) -> str:
    """
    Generate a PostgreSQL SELECT query from a natural language question.

    New parameters:
      business_rules       — domain rules injected before STRICT RULES
      few_shot_examples    — proven Q→SQL patterns injected as examples
      rewritten_intent     — precise analytical intent (may differ from question)
      conversation_context — prior turns in the conversation for reference resolution

    Returns a raw SQL string. The prompt deliberately asks for SQL only because
    local code models often produce malformed JSON around otherwise-valid SQL.
    """
    today = date.today().isoformat()
    tables_list = ", ".join(allowed_tables)

    if project_id is not None and role != "admin":
        project_clause = (
            f"Always filter by project_id = {project_id} on any table that has a project_id column."
        )
    else:
        project_clause = "No project_id filter required (admin global scope)."

    # ── Optional injections (each guarded — None = skip) ──────────────────────

    conv_section = ""
    if conversation_context:
        conv_section = (
            f"\n{conversation_context}\n"
            "Use the above history to resolve references like 'What about last week?' "
            "or 'Show me more details about that zone.' If the current user message is a follow-up, "
            "treat the Analytical intent as the fully resolved question.\n"
        )

    intent_section = ""
    if rewritten_intent and rewritten_intent.strip() != question.strip():
        intent_section = f"\nAnalytical intent: {rewritten_intent}\n"

    rules_section = ""
    if business_rules:
        rules_section = f"\n{business_rules}\n"

    retry_section = ""
    if error_feedback:
        retry_section = (
            f"\nPREVIOUS ATTEMPT FAILED — DO NOT REPEAT THE SAME MISTAKE:\n"
            f"Error: {error_feedback}\n"
            "Fix the query using correct column names and table references from the schema above.\n"
        )

    few_shot_section = ""
    if few_shot_examples:
        few_shot_section = f"\n{few_shot_examples}\n"

    system = f"""You are a PostgreSQL SELECT query generator for a construction site management system.

AVAILABLE DATA SOURCES:
- PostgreSQL database (your primary source — query via SQL)
- Equipment operational logs and snapshots
- PPE/Safety incident records
- Camera health monitoring data
- Zone workforce and activity data
- Risk assessment and scoring records
{conv_section}
ALLOWED TABLES: {tables_list}

SCHEMA (tables most relevant to this question):
{schema_text}

Today's date: {today}
{project_clause}
{intent_section}{rules_section}{retry_section}
CRITICAL COLUMN NAMES — use EXACTLY these time columns, wrong names cause query failure:
- ppe_incidents              → started_at   (NEVER triggered_at — that column does not exist here)
- workforce_snapshots        → recorded_at
- activity_snapshots         → recorded_at
- equipment_snapshots        → recorded_at
- risk_snapshots             → recorded_at
- workforce_alerts           → triggered_at
- activity_alerts            → triggered_at
- equipment_alerts           → triggered_at
- risk_events                → triggered_at
Risk column rule:
- risk_snapshots uses overall_risk for snapshot scores.
- risk_events uses risk_score for event scores; NEVER use overall_risk on risk_events.
- If the user asks for "types of risk events", select risk_events.event_type and COUNT(*), grouped by event_type.
Generate ONE SELECT statement only. Do not write two queries or add text before the SQL.

STRICT RULES:
1. Generate ONLY a SELECT statement. Never INSERT, UPDATE, DELETE, DROP, ALTER, or TRUNCATE.
2. ONLY reference tables from the ALLOWED TABLES list. ONLY use column names shown in SCHEMA.
3. Always add LIMIT 500 at the end.
4. Qualify ALL column names with their table alias (e.g. pi.zone_name, NOT just zone_name).
5. GROUP BY RULE: If SELECT has COUNT/SUM/AVG alongside any non-aggregate column,
   include GROUP BY listing ALL non-aggregate SELECT columns.
   WRONG: SELECT zone_name, COUNT(*) FROM ppe_incidents WHERE ...
   RIGHT:  SELECT pi.zone_name, COUNT(*) AS cnt FROM ppe_incidents pi WHERE ... GROUP BY pi.zone_name
6. DATE RULES:
   "yesterday"    -> WHERE DATE(col) = CURRENT_DATE - INTERVAL '1 day'
   explicit date like "11 May 2026" -> WHERE DATE(col) = DATE '2026-05-11'
   "today"        → WHERE DATE(col) = CURRENT_DATE
   "this week"    → WHERE col >= date_trunc('week', NOW())
   "this month"   → WHERE col >= date_trunc('month', NOW())
   "last 7 days"  → WHERE col >= NOW() - INTERVAL '7 days'
   "last 30 days" → WHERE col >= NOW() - INTERVAL '30 days'
7. Every JOIN must have an ON clause. No implicit cross-joins.
8. Assign a short alias to every table. Use that alias consistently.
9. If you cannot answer with the given schema, return this exact SQL:
   SELECT 'Insufficient schema context for this question' AS message
{few_shot_section}
OUTPUT CONTRACT: return raw SQL only. Do not return JSON, markdown, or explanation.
The first word of your response must be SELECT.
Do not include reasoning text.
Do not include a plan.
Do not include comments or placeholders.
  "sql": "the final SELECT query — raw SQL only, no backticks"
"""

    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]
    raw = await chat(messages, temperature=0.05)
    return _extract_sql(raw)


def _extract_sql(response: str) -> str:
    """
    Extract the SQL string from a structured JSON response.

    Fallback chain:
      1. Parse as JSON → extract "sql" key
      2. Regex-extract JSON block → extract "sql" key
      3. Fall back to old THINK→PLAN→SQL text extraction
      4. Return full response as-is (validator will reject if invalid)
    """
    response = re.sub(r"<think>[\s\S]*?</think>", "", response, flags=re.IGNORECASE).strip()

    if re.match(r"^\s*SELECT\b", response, flags=re.IGNORECASE):
        return _clean_sql(response)

    # 1. Direct JSON parse
    try:
        data = json.loads(response)
        if isinstance(data, dict) and data.get("sql"):
            return _clean_sql(str(data["sql"]))
    except (json.JSONDecodeError, ValueError):
        pass

    # 2. Regex-extract JSON block
    match = re.search(r"\{[\s\S]*\}", response)
    if match:
        try:
            data = json.loads(match.group())
            if isinstance(data, dict) and data.get("sql"):
                return _clean_sql(str(data["sql"]))
        except (json.JSONDecodeError, ValueError):
            pass

    # 3. Legacy THINK→PLAN→SQL chain-of-thought extraction
    sql_match = re.search(r"SQL:\s*\n([\s\S]+?)(?:\n\n|\Z)", response, re.IGNORECASE)
    if sql_match:
        return _clean_sql(sql_match.group(1).strip())

    # 3.5. Direct "sql" key value extraction — handles malformed JSON where
    # json.loads fails (unescaped quotes, newlines in strings, etc.) but the
    # "sql": "SELECT..." pattern is still intact.
    sql_key_match = re.search(
        r'"sql"\s*:\s*"(SELECT[\s\S]+?)"(?:\s*[,\}]|$)',
        response,
        re.IGNORECASE,
    )
    if sql_key_match:
        extracted = sql_key_match.group(1).replace('\\"', '"').replace("\\n", "\n")
        return _clean_sql(extracted)

    # 4. Last-resort: find any SELECT statement in the response.
    # The terminator includes `"` so we stop at the closing JSON quote and don't
    # capture trailing `"}` which would make the SQL invalid.
    select_match = re.search(
        r'(SELECT\b[\s\S]+?)(?:;|"\s*[,\}]|\n\s*(?:reasoning|plan|```|\}|\Z)|\Z)',
        response,
        re.IGNORECASE,
    )
    if select_match:
        return _clean_sql(select_match.group(1).strip())

    # 5. Last safe fallback: keep the pipeline SELECT-only even when the model
    # answers conversationally instead of generating SQL.
    return "SELECT 'Insufficient schema context for this question' AS message"


def _extract_sql_from_json(response: str) -> str:
    """Backward-compatible alias for older tests/imports."""
    return _extract_sql(response)


def _clean_sql(sql: str) -> str:
    """Strip markdown fences and trailing semicolons."""
    sql = sql.strip().rstrip(";")
    sql = re.sub(r"^```(?:sql|json)?\s*", "", sql, flags=re.IGNORECASE)
    sql = re.sub(r"\s*```$", "", sql).strip()
    sql = re.sub(r"--[^\n\r]*", "", sql)
    sql = sql.strip("\"'").strip()
    return sql


# ── Insight generation ────────────────────────────────────────────────────────

async def generate_insights(
    question: str,
    data_summary: dict,
    conversation_context: str | None = None,
) -> dict:
    """
    Generate natural language insights from a data summary.
    conversation_context is optionally included so insights can reference prior turns.
    Returns structured dict with answer, insights, follow_ups.
    """
    conv_note = ""
    if conversation_context:
        conv_note = (
            f"\nFor context, here are the prior turns in this conversation:\n"
            f"{conversation_context}\n"
        )

    system = (
        "You are a senior construction site analytics assistant. Given a data summary, write an executive-quality answer that is useful to a project manager.\n"
        + conv_note +
        "\nRules for the answer field:\n"
        "- Use Markdown inside the JSON string.\n"
        "- Start with a direct answer in the first sentence.\n"
        "- Then include compact sections such as **What the data shows**, **Likely reason / interpretation**, and **Recommended next step**.\n"
        "- Mention concrete numbers, labels, dates, zones, statuses, or cameras from the data.\n"
        "- If the user asks why, cause, impact, or correlation, explain what the data suggests and clearly state when the data is not enough to prove causality.\n"
        "- Do not mention SQL, database internals, or implementation details.\n\n"
        "Return ONLY valid JSON (no outer markdown, no explanation, no code blocks):\n"
        "{\n"
        '  "answer": "Detailed Markdown answer with evidence, interpretation, and next step",\n'
        '  "insights": [\n'
        '    {"text": "Key insight with a specific number or trend", "severity": "info", "icon": "📊"},\n'
        '    {"text": "Another insight, use warning if something is concerning", "severity": "warning", "icon": "⚠️"},\n'
        '    {"text": "Positive or neutral finding", "severity": "success", "icon": "✅"}\n'
        "  ],\n"
        '  "follow_ups": [\n'
        '    "Relevant follow-up question 1?",\n'
        '    "Relevant follow-up question 2?",\n'
        '    "Relevant follow-up question 3?"\n'
        "  ]\n"
        "}\n\n"
        "severity must be exactly one of: success, warning, danger, info"
    )

    user_content = (
        f"User asked: {question}\n\n"
        f"Data summary:\n{json.dumps(data_summary, indent=2, default=str)}"
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": user_content},
    ]
    raw = await chat(messages, temperature=0.25, num_predict=1800)

    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        match = re.search(r"\{[\s\S]*\}", raw)
        if match:
            try:
                return json.loads(match.group())
            except (json.JSONDecodeError, ValueError):
                pass

    return {
        "answer": raw[:500] if raw else "Analysis complete.",
        "insights": [{"text": "Data retrieved successfully.", "severity": "info", "icon": "📊"}],
        "follow_ups": [],
    }


# ── Streaming (for future use) ────────────────────────────────────────────────

async def stream_chat(messages: list[dict], temperature: float = 0.1):
    """Async generator yielding text chunks as they arrive from Ollama."""
    payload = {
        "model": OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
        "options": {"temperature": temperature, "num_predict": 1024},
    }
    if "qwen3" in OLLAMA_MODEL.lower():
        payload["think"] = False
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        async with client.stream("POST", f"{OLLAMA_BASE}/api/chat", json=payload) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                    delta = chunk.get("message", {}).get("content", "")
                    if delta:
                        yield delta
                    if chunk.get("done"):
                        break
                except json.JSONDecodeError:
                    continue
