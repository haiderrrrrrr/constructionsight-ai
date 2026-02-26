"""
Role-based schema context for the Smart Query Assistant.

Table column lists + types are now read LIVE from PostgreSQL via schema_registry.py.
This file only holds:
  1. ROLE_TABLES   — per-role table whitelists (what each role can query)
  2. get_role_schema() / get_allowed_tables() — the public API used by pipeline.py

Business meanings / annotations live in business_annotations.py.
The SchemaRegistry singleton (schema_registry.registry) handles merging.
"""
from __future__ import annotations

# ── Per-role table whitelists ─────────────────────────────────────────────────

ROLE_TABLES: dict[str, list[str]] = {
    "admin": [
        "users", "projects", "project_memberships", "project_invitations",
        "sites", "cameras", "camera_credentials", "camera_verifications",
        "camera_health_logs", "project_cameras", "zones", "camera_zone_polygons",
        "ppe_incidents", "workforce_snapshots", "activity_snapshots",
        "workforce_alerts", "activity_alerts", "equipment_alerts",
        "equipment_snapshots", "workforce_zone_settings", "activity_zone_settings",
        "equipment_zone_settings", "project_camera_analytics", "project_ml_config",
        "project_tasks", "notes", "notifications", "project_settings", "risk_events",
        "risk_snapshots", "auth_events", "scheduler_config", "refresh_tokens",
    ],
    "project_manager": [
        "projects", "project_memberships", "project_invitations", "cameras",
        "zones", "project_cameras", "ppe_incidents", "workforce_snapshots",
        "activity_snapshots", "workforce_alerts", "activity_alerts",
        "equipment_alerts", "equipment_snapshots", "project_tasks", "notes",
        "notifications", "project_settings", "risk_events", "risk_snapshots",
    ],
    "data_analyst": [
        "projects", "project_memberships", "cameras", "zones", "project_cameras",
        "ppe_incidents", "workforce_snapshots", "activity_snapshots",
        "workforce_alerts", "activity_alerts", "equipment_alerts",
        "equipment_snapshots", "workforce_zone_settings", "activity_zone_settings",
        "equipment_zone_settings", "project_camera_analytics", "project_ml_config",
        "project_tasks", "notifications", "risk_events", "risk_snapshots",
        "camera_health_logs", "camera_verifications",
    ],
    "site_supervisor": [
        "cameras", "zones", "project_cameras", "camera_health_logs",
        "camera_verifications", "workforce_snapshots", "activity_snapshots",
        "workforce_alerts", "activity_alerts", "equipment_snapshots",
        "workforce_zone_settings", "activity_zone_settings",
        "equipment_zone_settings", "project_tasks",
    ],
    "safety_officer": [
        "ppe_incidents", "risk_events", "risk_snapshots", "workforce_snapshots",
        "activity_snapshots", "zones", "cameras", "notifications",
        "project_tasks",
    ],
}


# ── Public API ────────────────────────────────────────────────────────────────

def get_allowed_tables(role: str) -> list[str]:
    return ROLE_TABLES.get(role, ROLE_TABLES["safety_officer"])


def get_role_schema(role: str, question: str) -> tuple[list[str], str]:
    """
    Returns (allowed_table_names, schema_text_for_prompt).

    Uses hybrid BM25+FAISS retrieval from schema_memory to pick the most
    relevant tables for this question, then fetches their schema text from
    the live schema registry (real columns + business annotations merged).
    """
    from . import schema_memory
    from .schema_registry import registry

    allowed = get_allowed_tables(role)
    allowed_set = set(allowed)

    # Retrieve relevant tables via hybrid BM25+FAISS (falls back to FAISS-only)
    relevant = schema_memory.retrieve_relevant_tables(question, top_k=7)
    relevant_filtered = [t for t in relevant if t in allowed_set]
    if not relevant_filtered:
        relevant_filtered = allowed[:8]

    # Build schema text from live registry (real DB columns + annotations)
    if registry.is_ready():
        schema_text = registry.get_schema_texts(relevant_filtered)
        # Append FK relationship context for the selected tables
        rel_text = registry.get_relationship_text(relevant_filtered)
        if rel_text:
            schema_text += f"\n\nKEY RELATIONSHIPS:\n{rel_text}"
    else:
        # Registry not ready yet — fall back to empty (pipeline handles gracefully)
        schema_text = ""
        import logging
        logging.getLogger(__name__).warning("[schema_context] SchemaRegistry not ready; schema_text will be empty")

    return allowed, schema_text


def get_schema_for_role(role: str, relevant_tables: list[str] | None = None) -> str:
    """
    Build schema context string for the given role using the live registry.
    If relevant_tables is provided, only include those tables.
    Otherwise include all allowed tables for the role (up to 10).
    """
    from .schema_registry import registry

    allowed = set(get_allowed_tables(role))
    if relevant_tables:
        tables = [t for t in relevant_tables if t in allowed]
    else:
        tables = list(allowed)[:10]

    return registry.get_schema_texts(tables)
