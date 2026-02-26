"""
Project-specific ML Configuration — per-project detection settings.

Each project can have its own PPE detection thresholds and alert behavior.
Defaults to global MLConfig if not explicitly set.
"""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, Boolean, ForeignKey, DateTime
from ..core.db import Base


class ProjectMLConfig(Base):
    """Per-project ML configuration for PPE detection."""
    __tablename__ = "project_ml_config"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True, unique=True)

    # ── State machine (alert behavior) ──────────────────────────────────────
    alert_cooldown_frames = Column(Integer, default=90)       # Frames between alerts per person
    violation_frames = Column(Integer, default=8)             # Frames to confirm violation
    confirm_frames = Column(Integer, default=5)               # Frames to confirm compliance
    lost_frames = Column(Integer, default=30)                 # Frames to lose a person (ByteTrack)
    incident_dedup_seconds = Column(Integer, default=30)      # Suppress duplicate alerts window

    # ── Detection thresholds ───────────────────────────────────────────────
    stage1_conf = Column(Float, default=0.30)                 # Person detection confidence
    stage2_conf = Column(Float, default=0.30)                 # PPE detection confidence

    # ── ReID (Re-Identification) ───────────────────────────────────────────
    reid_enabled = Column(Boolean, default=True)              # Enable cross-camera person tracking

    # ── Metadata ───────────────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc))
    updated_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)  # Who last updated
