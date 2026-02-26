"""
Few-Shot SQL Memory for the Smart Query Assistant.

A curated bank of Q→SQL example pairs covering all major query types for
construction site analytics. Uses LlamaIndex with a HuggingFace embedding model
and FAISS to retrieve the most semantically relevant examples for each question.

The retrieved examples are injected into the SQL generation prompt so the LLM
can follow proven patterns instead of improvising.

Usage:
    build_few_shot_index()                     # call once on startup
    examples = retrieve_examples(question, 2)  # get top-2 similar examples
    text = format_few_shots(examples)          # format for prompt injection
"""
from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# ── Curated example bank ──────────────────────────────────────────────────────
# Each entry: question (used for retrieval) + sql (injected into prompt)

_EXAMPLES: list[dict[str, str]] = [

    {
        "question": "How many PPE violations occurred today?",
        "sql": (
            "SELECT COUNT(*) AS total_violations\n"
            "FROM ppe_incidents pi\n"
            "WHERE pi.project_id = :project_id\n"
            "  AND DATE(pi.started_at) = CURRENT_DATE\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "PPE violations by zone this week",
        "sql": (
            "SELECT pi.zone_name, COUNT(*) AS violation_count\n"
            "FROM ppe_incidents pi\n"
            "WHERE pi.project_id = :project_id\n"
            "  AND pi.started_at >= date_trunc('week', NOW())\n"
            "GROUP BY pi.zone_name\n"
            "ORDER BY violation_count DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Workers without helmets in the last 24 hours",
        "sql": (
            "SELECT pi.zone_name, COUNT(*) AS no_helmet_count\n"
            "FROM ppe_incidents pi\n"
            "WHERE pi.project_id = :project_id\n"
            "  AND pi.has_helmet = FALSE\n"
            "  AND pi.started_at >= NOW() - INTERVAL '24 hours'\n"
            "GROUP BY pi.zone_name\n"
            "ORDER BY no_helmet_count DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Night shift worker headcount per zone",
        "sql": (
            "SELECT ws.zone_name,\n"
            "       AVG(ws.worker_count) AS avg_workers,\n"
            "       MAX(ws.worker_count) AS peak_workers\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND (\n"
            "    EXTRACT(HOUR FROM ws.recorded_at) >= 20\n"
            "    OR EXTRACT(HOUR FROM ws.recorded_at) < 6\n"
            "  )\n"
            "  AND ws.recorded_at >= NOW() - INTERVAL '7 days'\n"
            "GROUP BY ws.zone_name\n"
            "ORDER BY avg_workers DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Workforce utilization by zone this week",
        "sql": (
            "SELECT ws.zone_name,\n"
            "       ROUND(AVG(ws.utilization_score) * 100, 1) AS avg_utilization_pct,\n"
            "       AVG(ws.worker_count) AS avg_worker_count\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND ws.recorded_at >= date_trunc('week', NOW())\n"
            "GROUP BY ws.zone_name\n"
            "ORDER BY avg_utilization_pct DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Idle workers per zone today",
        "sql": (
            "SELECT ws.zone_name,\n"
            "       AVG(ws.idle_count) AS avg_idle,\n"
            "       MAX(ws.idle_count) AS peak_idle\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND DATE(ws.recorded_at) = CURRENT_DATE\n"
            "GROUP BY ws.zone_name\n"
            "ORDER BY avg_idle DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Equipment with highest active runtime in last 7 days",
        "sql": (
            "SELECT es.zone_name,\n"
            "       AVG(es.avg_active_duration) AS avg_active_seconds,\n"
            "       AVG(es.utilization_score) * 100 AS avg_utilization_pct\n"
            "FROM equipment_snapshots es\n"
            "WHERE es.project_id = :project_id\n"
            "  AND es.recorded_at >= NOW() - INTERVAL '7 days'\n"
            "GROUP BY es.zone_name\n"
            "ORDER BY avg_active_seconds DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Equipment idle longer than expected in each zone",
        "sql": (
            "SELECT es.zone_name,\n"
            "       AVG(es.idle_count) AS avg_idle_equipment,\n"
            "       AVG(es.idle_ratio) * 100 AS avg_idle_pct\n"
            "FROM equipment_snapshots es\n"
            "WHERE es.project_id = :project_id\n"
            "  AND es.recorded_at >= NOW() - INTERVAL '7 days'\n"
            "  AND es.idle_count > 0\n"
            "GROUP BY es.zone_name\n"
            "ORDER BY avg_idle_pct DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Cameras that are offline or have errors",
        "sql": (
            "SELECT c.name, c.registry_status, c.worker_status, c.worker_error\n"
            "FROM cameras c\n"
            "JOIN project_cameras pc ON c.id = pc.camera_id\n"
            "WHERE pc.project_id = :project_id\n"
            "  AND (\n"
            "    c.worker_status = 'error'\n"
            "    OR c.registry_status IN ('verify_failed', 'archived')\n"
            "  )\n"
            "ORDER BY c.name\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Camera health score below 50 (critical cameras)",
        "sql": (
            "SELECT c.name,\n"
            "       chl.health_status,\n"
            "       chl.latency_ms,\n"
            "       chl.checked_at\n"
            "FROM camera_health_logs chl\n"
            "JOIN cameras c ON c.id = chl.camera_id\n"
            "JOIN project_cameras pc ON c.id = pc.camera_id\n"
            "WHERE pc.project_id = :project_id\n"
            "  AND chl.health_status IN ('degraded', 'offline')\n"
            "  AND chl.checked_at = (\n"
            "    SELECT MAX(checked_at) FROM camera_health_logs\n"
            "    WHERE camera_id = chl.camera_id\n"
            "  )\n"
            "ORDER BY chl.latency_ms DESC NULLS LAST\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Zones with high risk score right now",
        "sql": (
            "SELECT rs.zone_name, rs.overall_risk, rs.risk_level, rs.trend,\n"
            "       rs.safety_risk, rs.productivity_risk\n"
            "FROM risk_snapshots rs\n"
            "WHERE rs.project_id = :project_id\n"
            "  AND rs.risk_level IN ('high', 'critical')\n"
            "  AND rs.recorded_at = (\n"
            "    SELECT MAX(recorded_at) FROM risk_snapshots\n"
            "    WHERE project_id = rs.project_id AND zone_name = rs.zone_name\n"
            "  )\n"
            "ORDER BY rs.overall_risk DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Risk events by severity in the last 30 days",
        "sql": (
            "SELECT re.severity, COUNT(*) AS event_count\n"
            "FROM risk_events re\n"
            "WHERE re.project_id = :project_id\n"
            "  AND re.triggered_at >= NOW() - INTERVAL '30 days'\n"
            "GROUP BY re.severity\n"
            "ORDER BY CASE re.severity\n"
            "  WHEN 'critical' THEN 1 WHEN 'high' THEN 2\n"
            "  WHEN 'medium' THEN 3 ELSE 4 END\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Activity alerts count by type and severity",
        "sql": (
            "SELECT aa.alert_type, aa.severity, COUNT(*) AS alert_count\n"
            "FROM activity_alerts aa\n"
            "WHERE aa.project_id = :project_id\n"
            "  AND aa.triggered_at >= NOW() - INTERVAL '7 days'\n"
            "GROUP BY aa.alert_type, aa.severity\n"
            "ORDER BY alert_count DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Project-wide PPE compliance rate this month",
        "sql": (
            "SELECT\n"
            "  DATE_TRUNC('day', pi.started_at) AS day,\n"
            "  COUNT(*) AS violations,\n"
            "  SUM(ws.worker_count) AS total_workers\n"
            "FROM ppe_incidents pi\n"
            "JOIN workforce_snapshots ws\n"
            "  ON ws.project_id = pi.project_id\n"
            "  AND DATE(ws.recorded_at) = DATE(pi.started_at)\n"
            "WHERE pi.project_id = :project_id\n"
            "  AND pi.started_at >= date_trunc('month', NOW())\n"
            "GROUP BY DATE_TRUNC('day', pi.started_at)\n"
            "ORDER BY day ASC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Top zones by total violations in last 30 days",
        "sql": (
            "SELECT pi.zone_name, COUNT(*) AS total_violations\n"
            "FROM ppe_incidents pi\n"
            "WHERE pi.project_id = :project_id\n"
            "  AND pi.started_at >= NOW() - INTERVAL '30 days'\n"
            "GROUP BY pi.zone_name\n"
            "ORDER BY total_violations DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Workforce utilization trend by day over last week",
        "sql": (
            "SELECT\n"
            "  DATE(ws.recorded_at) AS day,\n"
            "  ROUND(AVG(ws.utilization_score) * 100, 1) AS avg_utilization_pct,\n"
            "  SUM(ws.worker_count) AS total_worker_detections\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND ws.recorded_at >= NOW() - INTERVAL '7 days'\n"
            "GROUP BY DATE(ws.recorded_at)\n"
            "ORDER BY day ASC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Average worker dwell time by zone this month",
        "sql": (
            "SELECT ws.zone_name,\n"
            "       ROUND(AVG(ws.avg_dwell_seconds) / 60.0, 1) AS avg_dwell_minutes\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND ws.recorded_at >= date_trunc('month', NOW())\n"
            "GROUP BY ws.zone_name\n"
            "ORDER BY avg_dwell_minutes DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Equipment count by type across all zones",
        "sql": (
            "SELECT ea.equipment_type, COUNT(*) AS alert_count\n"
            "FROM equipment_alerts ea\n"
            "WHERE ea.project_id = :project_id\n"
            "  AND ea.triggered_at >= NOW() - INTERVAL '30 days'\n"
            "GROUP BY ea.equipment_type\n"
            "ORDER BY alert_count DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Zones with most activity alerts this week",
        "sql": (
            "SELECT aa.zone_name, COUNT(*) AS alert_count,\n"
            "       COUNT(*) FILTER (WHERE aa.severity = 'high') AS high_severity\n"
            "FROM activity_alerts aa\n"
            "WHERE aa.project_id = :project_id\n"
            "  AND aa.triggered_at >= date_trunc('week', NOW())\n"
            "GROUP BY aa.zone_name\n"
            "ORDER BY alert_count DESC\n"
            "LIMIT 500"
        ),
    },
    {
        "question": "Overcrowded zones today",
        "sql": (
            "SELECT ws.zone_name,\n"
            "       MAX(ws.worker_count) AS peak_count,\n"
            "       COUNT(*) AS overcrowded_snapshots\n"
            "FROM workforce_snapshots ws\n"
            "WHERE ws.project_id = :project_id\n"
            "  AND ws.zone_status = 'OVERCROWDED'\n"
            "  AND DATE(ws.recorded_at) = CURRENT_DATE\n"
            "GROUP BY ws.zone_name\n"
            "ORDER BY peak_count DESC\n"
            "LIMIT 500"
        ),
    },
]


# ── LlamaIndex index ──────────────────────────────────────────────────────────

_index = None       # LlamaIndex VectorStoreIndex
_examples = _EXAMPLES    # reference to _EXAMPLES (for id -> dict lookup)


def _tokens(text: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9_\s]", " ", text.lower()).split())


def _lexical_retrieve(question: str, top_k: int) -> list[dict]:
    """Dependency-free fallback so few-shot prompting never fully disappears."""
    q_tokens = _tokens(question)
    if not q_tokens:
        return _EXAMPLES[:top_k]

    scored: list[tuple[float, dict]] = []
    for ex in _EXAMPLES:
        ex_tokens = _tokens(ex["question"])
        overlap = len(q_tokens & ex_tokens)
        union = max(len(q_tokens | ex_tokens), 1)
        score = overlap / union
        if any(tok in ex["question"].lower() for tok in q_tokens):
            score += 0.05
        scored.append((score, ex))

    scored.sort(key=lambda item: item[0], reverse=True)
    return [ex for score, ex in scored[:top_k] if score > 0] or _EXAMPLES[:top_k]


def build_few_shot_index() -> None:
    """
    Build a LlamaIndex VectorStoreIndex over the example questions.
    Call once on startup (non-blocking if LlamaIndex is not installed).
    """
    global _index, _examples
    try:
        from llama_index.core import Document, VectorStoreIndex, Settings
        from llama_index.embeddings.huggingface import HuggingFaceEmbedding

        embed_model = HuggingFaceEmbedding(model_name="all-MiniLM-L6-v2")
        Settings.embed_model = embed_model
        Settings.llm = None   # no LLM needed for retrieval-only use

        docs = [
            Document(
                text=ex["question"],
                doc_id=str(i),
            )
            for i, ex in enumerate(_EXAMPLES)
        ]
        _index = VectorStoreIndex.from_documents(docs, show_progress=False)
        _examples = _EXAMPLES
        logger.info(f"[few_shot_memory] LlamaIndex index built: {len(_EXAMPLES)} Q→SQL examples")
    except ImportError as e:
        logger.warning(
            f"[few_shot_memory] LlamaIndex not available ({e}); using lexical few-shot fallback. "
            "Install with: pip install llama-index-core llama-index-embeddings-huggingface"
        )
    except Exception as e:
        logger.warning(f"[few_shot_memory] Index build failed: {e}")


def retrieve_examples(question: str, top_k: int = 2) -> list[dict]:
    """
    Return up to top_k Q→SQL pairs most semantically similar to question.
    Falls back to a dependency-free lexical scorer if the vector index is not available.
    """
    if _index is None or _examples is None:
        return _lexical_retrieve(question, top_k)
    try:
        retriever = _index.as_retriever(similarity_top_k=top_k)
        nodes = retriever.retrieve(question)
        results: list[dict] = []
        for node in nodes:
            doc_id = node.node.node_id
            try:
                idx = int(doc_id)
                if 0 <= idx < len(_examples):
                    results.append(_examples[idx])
            except (ValueError, IndexError):
                pass
        return results
    except Exception as e:
        logger.warning(f"[few_shot_memory] Retrieval failed: {e}")
        return _lexical_retrieve(question, top_k)


def format_few_shots(examples: list[dict]) -> str:
    """Format retrieved Q→SQL pairs as a prompt-ready text block."""
    if not examples:
        return ""
    lines = ["PROVEN SQL EXAMPLES (follow these patterns):"]
    for i, ex in enumerate(examples, 1):
        lines.append(f"\n-- Example {i}:")
        lines.append(f"-- Question: {ex['question']}")
        lines.append(ex["sql"])
    return "\n".join(lines)
