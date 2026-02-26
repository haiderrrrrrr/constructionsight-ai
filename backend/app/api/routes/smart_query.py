"""
Smart Query Assistant — API routes.

Endpoints:
  POST   /smart-query/ask                      → run query pipeline
  GET    /smart-query/history                  → user's past queries (flat list)
  DELETE /smart-query/history/{id}             → delete a history entry
  GET    /smart-query/conversations            → list user's conversation sessions
  GET    /smart-query/conversations/{cid}      → full thread for one conversation
  GET    /smart-query/suggestions              → role-based suggested questions
  GET    /smart-query/status                   → Ollama health + FAISS/registry status
  POST   /smart-query/schema/reload            → hot-reload schema registry (admin only)
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ...core.db import get_db, engine
from ...models.project_membership import MembershipStatus, ProjectMembership, ProjectRole
from ...models.user import PlatformRole, User
from ...schemas.smart_query import (
    ConversationSummary,
    QueryHistoryItem,
    QuerySuggestion,
    SmartQueryRequest,
    SmartQueryResponse,
    SmartQueryStatusResponse,
)
from ...services.smart_query import ollama_client as ollama
from ...services.smart_query import schema_memory
from ...services.smart_query.pipeline import run as run_pipeline
from ..deps import get_current_user, require_admin

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/smart-query", tags=["smart-query"])

# ── Role resolution ───────────────────────────────────────────────────────────

_ALLOWED_ROLES = {
    ProjectRole.PROJECT_MANAGER,
    ProjectRole.SITE_SUPERVISOR,
    ProjectRole.SAFETY_OFFICER,
    ProjectRole.DATA_ANALYST,
}

_ROLE_TO_SCHEMA_KEY: dict[str, str] = {
    ProjectRole.PROJECT_MANAGER.value: "project_manager",
    ProjectRole.SITE_SUPERVISOR.value: "site_supervisor",
    ProjectRole.SAFETY_OFFICER.value: "safety_officer",
    ProjectRole.DATA_ANALYST.value: "data_analyst",
}


def _resolve_role(user: User, db: Session, project_id: int | None) -> str:
    if user.platform_role == PlatformRole.ADMIN:
        return "admin"
    if project_id is None:
        raise HTTPException(status_code=400, detail="project_id is required for non-admin users.")
    membership = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.user_id == user.id,
            ProjectMembership.project_id == project_id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        .first()
    )
    if not membership:
        raise HTTPException(status_code=403, detail="You are not a member of this project.")
    if membership.project_role not in _ALLOWED_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Smart Query Assistant is available for Project Managers, Site Supervisors, Safety Officers, and Data Analysts.",
        )
    return _ROLE_TO_SCHEMA_KEY[membership.project_role.value]


def _save_history(
    db: Session,
    user_id: int,
    project_id: int | None,
    body: SmartQueryRequest,
    result: dict,
) -> int | None:
    try:
        row = db.execute(
            text("""
                INSERT INTO smart_query_history
                  (user_id, project_id, question, answer, sql_used, chart_json,
                   evidence_json, insights_json, duration_ms, cached, mode,
                   conversation_id, resolved_question, query_context_json, created_at)
                VALUES
                  (:user_id, :project_id, :question, :answer, :sql_used, :chart_json,
                   :evidence_json, :insights_json, :duration_ms, :cached, :mode,
                   :conversation_id, :resolved_question, :query_context_json, NOW())
                RETURNING id
            """),
            {
                "user_id": user_id,
                "project_id": project_id,
                "question": body.question,
                "answer": result.get("answer"),
                "sql_used": result.get("sql_used"),
                "chart_json": json.dumps(result.get("chart")) if result.get("chart") else None,
                "evidence_json": json.dumps(result.get("evidence")),
                "insights_json": json.dumps(result.get("insights")),
                "duration_ms": result.get("duration_ms"),
                "cached": result.get("cached", False),
                "mode": result.get("mode", body.mode),
                "conversation_id": body.conversation_id,
                "resolved_question": result.get("resolved_question"),
                "query_context_json": json.dumps(result.get("query_context") or {}),
            },
        )
        db.commit()
        return row.scalar()
    except Exception as e:
        logger.warning(f"[smart_query] Failed to save history: {e}")
        try:
            db.rollback()
        except Exception:
            pass
        return None


def _json_or_empty(value, fallback):
    if not value:
        return fallback
    try:
        parsed = json.loads(value)
        return parsed if parsed is not None else fallback
    except Exception:
        return fallback


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/ask", response_model=SmartQueryResponse)
async def ask(
    body: SmartQueryRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = _resolve_role(user, db, body.project_id)

    result = await run_pipeline(
        question=body.question,
        role=role,
        project_id=body.project_id,
        user_id=user.id,
        mode=body.mode,
        force_refresh=body.force_refresh,
        db=db,
        conversation_id=body.conversation_id,
    )

    history_id = _save_history(db, user.id, body.project_id, body, result)

    if result.get("rows_returned", 0) > 0 and not result.get("error_message"):
        schema_memory.remember_query(user.id, body.question, result.get("answer", "")[:200])

    insights_raw = result.get("insights", [])
    insights = [item if isinstance(item, dict) else {"text": str(item), "severity": "info", "icon": "ℹ️"} for item in insights_raw]
    evidence = [item for item in result.get("evidence", []) if isinstance(item, dict)]

    return SmartQueryResponse(
        answer=result.get("answer", ""),
        insights=insights,
        evidence=evidence,
        follow_up_suggestions=result.get("follow_up_suggestions", []),
        chart=result.get("chart"),
        sql_used=result.get("sql_used"),
        duration_ms=result.get("duration_ms", 0),
        rows_returned=result.get("rows_returned", 0),
        confidence=result.get("confidence", "LOW"),
        cached=result.get("cached", False),
        history_id=history_id,
        error_message=result.get("error_message"),
        mode=result.get("mode", body.mode),
    )


@router.get("/history", response_model=list[QueryHistoryItem])
def get_history(
    limit: int = 30,
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filters = "WHERE user_id = :user_id"
    params: dict = {"user_id": user.id, "limit": min(limit, 100)}
    if project_id is not None:
        filters += " AND project_id = :project_id"
        params["project_id"] = project_id

    try:
        rows = db.execute(
            text(f"""
                SELECT id, question, answer, project_id, mode,
                       duration_ms, cached, created_at, conversation_id
                FROM smart_query_history
                {filters}
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            params,
        ).fetchall()
    except SQLAlchemyError as e:
        logger.warning(f"[smart_query] Failed to load history: {e}")
        return []

    return [
        QueryHistoryItem(
            id=r.id,
            question=r.question,
            answer=r.answer,
            project_id=r.project_id,
            mode=r.mode or "standard",
            duration_ms=r.duration_ms,
            rows_returned=None,
            cached=r.cached or False,
            created_at=r.created_at,
            conversation_id=getattr(r, "conversation_id", None),
        )
        for r in rows
    ]


@router.delete("/history/{history_id}", status_code=204)
def delete_history_entry(
    history_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = db.execute(
        text("DELETE FROM smart_query_history WHERE id = :id AND user_id = :user_id"),
        {"id": history_id, "user_id": user.id},
    )
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="History entry not found.")


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(
    conversation_id: str,
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    filters = "conversation_id = :cid AND user_id = :uid"
    params: dict = {"cid": conversation_id, "uid": user.id}
    if project_id is not None:
        filters += " AND project_id = :project_id"
        params["project_id"] = project_id

    result = db.execute(text(f"DELETE FROM smart_query_history WHERE {filters}"), params)
    db.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Conversation not found.")


@router.get("/conversations", response_model=list[ConversationSummary])
def get_conversations(
    limit: int = 20,
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List user's distinct conversation sessions, most recent first."""
    filters = "WHERE user_id = :user_id AND conversation_id IS NOT NULL"
    params: dict = {"user_id": user.id, "limit": min(limit, 50)}
    if project_id is not None:
        filters += " AND project_id = :project_id"
        params["project_id"] = project_id

    rows = db.execute(
        text(f"""
            SELECT
                conversation_id,
                MIN(question)    AS first_question,
                MAX(created_at)  AS last_asked,
                COUNT(*)         AS turn_count,
                MAX(project_id)  AS project_id
            FROM smart_query_history
            {filters}
            GROUP BY conversation_id
            ORDER BY last_asked DESC
            LIMIT :limit
        """),
        params,
    ).fetchall()

    return [
        ConversationSummary(
            conversation_id=r.conversation_id,
            first_question=r.first_question or "",
            last_asked=r.last_asked,
            turn_count=r.turn_count,
            project_id=r.project_id,
        )
        for r in rows
    ]


@router.get("/conversations/{conversation_id}", response_model=list[QueryHistoryItem])
def get_conversation_thread(
    conversation_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return all turns in a conversation, oldest first (chronological order)."""
    rows = db.execute(
        text("""
            SELECT id, question, answer, project_id, mode, sql_used,
                   chart_json, evidence_json, insights_json,
                   duration_ms, cached, created_at, conversation_id
            FROM smart_query_history
            WHERE user_id = :uid AND conversation_id = :cid
            ORDER BY created_at ASC
        """),
        {"uid": user.id, "cid": conversation_id},
    ).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Conversation not found.")

    return [
        QueryHistoryItem(
            id=r.id,
            question=r.question,
            answer=r.answer,
            project_id=r.project_id,
            mode=r.mode or "standard",
            duration_ms=r.duration_ms,
            rows_returned=None,
            cached=r.cached or False,
            created_at=r.created_at,
            conversation_id=r.conversation_id,
            insights=_json_or_empty(getattr(r, "insights_json", None), []),
            evidence=_json_or_empty(getattr(r, "evidence_json", None), []),
            chart=_json_or_empty(getattr(r, "chart_json", None), None),
            sql_used=getattr(r, "sql_used", None),
        )
        for r in rows
    ]


@router.post("/schema/reload")
def reload_schema(admin: User = Depends(require_admin)):
    """
    Hot-reload the schema registry from live DB without server restart.
    Admin only. Also rebuilds the FAISS+BM25 schema search index.
    """
    try:
        from ...services.smart_query.schema_registry import registry
        registry.reload(engine)
        schema_memory.build_schema_index()
        n = len(registry.get_all_table_names())
        logger.info(f"[smart_query] Schema registry reloaded by admin {admin.id}: {n} tables")
        return {"status": "reloaded", "tables": n}
    except Exception as e:
        logger.error(f"[smart_query] Schema reload failed: {e}")
        raise HTTPException(status_code=500, detail=f"Schema reload failed: {e}")


@router.get("/suggestions", response_model=list[QuerySuggestion])
def get_suggestions(
    project_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = _resolve_role(user, db, project_id) if project_id or user.platform_role != PlatformRole.ADMIN else "admin"
    return _SUGGESTIONS.get(role, _SUGGESTIONS["project_manager"])


@router.get("/status", response_model=SmartQueryStatusResponse)
async def get_status(user: User = Depends(get_current_user)):
    online = await ollama.health_check()
    faiss_ready = schema_memory._schema_index is not None
    try:
        from ...services.smart_query.schema_registry import registry
        registry_tables = len(registry.get_all_table_names())
    except Exception:
        registry_tables = 0
    return SmartQueryStatusResponse(
        ollama_online=online,
        model=ollama.ACTIVE_MODEL,
        faiss_ready=faiss_ready,
        registry_tables=registry_tables,
    )


# ── Suggestion bank ───────────────────────────────────────────────────────────

_SUGGESTIONS: dict[str, list[QuerySuggestion]] = {
    "admin": [
        QuerySuggestion(category="Projects", label="Active projects", question="How many active projects are currently running?", icon="📋"),
        QuerySuggestion(category="Safety", label="Top PPE violations", question="Which camera has the most PPE violations this month?", icon="⚠"),
        QuerySuggestion(category="Workforce", label="Utilization trend", question="Show workforce utilization trends across all sites in the last 7 days", icon="📊"),
        QuerySuggestion(category="Users", label="Recent signups", question="List users who joined in the last 30 days", icon="👥"),
        QuerySuggestion(category="Cameras", label="Camera health", question="How many cameras are currently offline or degraded?", icon="📷"),
        QuerySuggestion(category="Risk", label="Critical risks", question="Show all critical risk events across all projects this week", icon="🚨"),
    ],
    "project_manager": [
        QuerySuggestion(category="Workforce", label="Zone utilization", question="What is the current workforce utilization in each zone?", icon="📊"),
        QuerySuggestion(category="Safety", label="Open incidents", question="How many open PPE incidents are unresolved?", icon="⚠"),
        QuerySuggestion(category="Tasks", label="Task completion", question="What is the task completion rate for this project?", icon="✅"),
        QuerySuggestion(category="Risk", label="Risk summary", question="Show the top risk events for this project", icon="🚨"),
        QuerySuggestion(category="Cameras", label="Camera status", question="What is the current camera health status for this project?", icon="📷"),
        QuerySuggestion(category="Workforce", label="Idle workers", question="Which zones have the highest idle worker count today?", icon="💤"),
    ],
    "data_analyst": [
        QuerySuggestion(category="Analytics", label="Activity trends", question="Plot activity score trends for each zone over the last 14 days", icon="📈"),
        QuerySuggestion(category="Analytics", label="Idle detection", question="Identify zones with idle_count above average", icon="📉"),
        QuerySuggestion(category="Analytics", label="Weekly comparison", question="Compare workforce snapshots: this week vs last week", icon="🔄"),
        QuerySuggestion(category="Analytics", label="PPE correlation", question="Show correlation between PPE violations and zone congestion", icon="🔍"),
        QuerySuggestion(category="Analytics", label="Utilization heatmap", question="Which zones had the lowest utilization score this month?", icon="🗺"),
        QuerySuggestion(category="Risk", label="Risk trends", question="Show risk score trends over the last 30 days", icon="📊"),
    ],
    "site_supervisor": [
        QuerySuggestion(category="Workforce", label="Zone alerts", question="Which zones had workforce alerts in the last 48 hours?", icon="⚠"),
        QuerySuggestion(category="Cameras", label="Camera health", question="What is the current camera health status?", icon="📷"),
        QuerySuggestion(category="Workforce", label="Worker count", question="Show average worker count per zone today", icon="👷"),
        QuerySuggestion(category="Activity", label="Idle zones", question="Which zones are currently showing IDLE state?", icon="💤"),
        QuerySuggestion(category="Workforce", label="Congestion", question="Are any zones flagged as congested right now?", icon="🚦"),
    ],
    "safety_officer": [
        QuerySuggestion(category="PPE", label="Helmet violations", question="How many no-helmet incidents occurred this week?", icon="⛑"),
        QuerySuggestion(category="Risk", label="Highest risk zone", question="Which zone has the highest risk score?", icon="🚨"),
        QuerySuggestion(category="PPE", label="Unresolved incidents", question="List all unresolved high-severity PPE incidents", icon="⚠"),
        QuerySuggestion(category="PPE", label="Compliance trend", question="Show PPE compliance rate trend this month", icon="📈"),
        QuerySuggestion(category="Risk", label="Risk events", question="Show all critical and high severity risk events this week", icon="🔴"),
    ],
}
