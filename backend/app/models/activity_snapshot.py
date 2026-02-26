"""
ActivitySnapshot — periodic + transition-triggered activity metrics snapshot.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, Boolean, String, Text, DateTime, ForeignKey
from ..core.db import Base


class ActivitySnapshot(Base):
    __tablename__ = "activity_snapshots"

    id                      = Column(Integer, primary_key=True, index=True)
    project_id              = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id               = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id                 = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name               = Column(String(255), nullable=True)

    recorded_at             = Column(DateTime(timezone=True), nullable=False,
                                     default=lambda: datetime.now(timezone.utc), index=True)
    trigger                 = Column(String(20), default="interval")   # 'interval' | 'transition'

    # Zone-level state
    zone_state              = Column(String(20), nullable=False, default="ACTIVE")  # ACTIVE|LOW_ACTIVITY|IDLE|ALERTED

    # Worker motion counts
    moving_count            = Column(Integer, nullable=False, default=0)
    stationary_count        = Column(Integer, nullable=False, default=0)
    idle_count              = Column(Integer, nullable=False, default=0)
    total_count             = Column(Integer, nullable=False, default=0)

    # Scores
    motion_intensity_score  = Column(Float, nullable=False, default=0.0)   # 0-100
    activity_score          = Column(Integer, nullable=False, default=0)   # 0-100

    # Rolling minute counters (today)
    active_minutes_today    = Column(Integer, nullable=False, default=0)
    idle_minutes_today      = Column(Integer, nullable=False, default=0)
    low_activity_minutes_today = Column(Integer, nullable=False, default=0)

    # Idle tracking
    idle_duration_seconds   = Column(Float, nullable=True)   # current idle streak duration
    longest_idle_seconds    = Column(Float, nullable=True)   # session longest idle period

    # Sparkline + optional optical flow
    sparkline_json          = Column(Text, nullable=True)    # JSON string of last-20 activity scores
    optical_flow_score      = Column(Float, nullable=True)   # raw flow magnitude (secondary signal)
