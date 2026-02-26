"""
WorkforceSnapshot — periodic + transition-triggered workforce metrics snapshot.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, Boolean, String, Text, DateTime, ForeignKey
from ..core.db import Base


class WorkforceSnapshot(Base):
    __tablename__ = "workforce_snapshots"

    id                = Column(Integer, primary_key=True, index=True)
    project_id        = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id         = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id           = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name         = Column(String(255), nullable=True)

    recorded_at       = Column(DateTime(timezone=True), nullable=False,
                               default=lambda: datetime.now(timezone.utc), index=True)
    trigger           = Column(String(20), default="interval")    # 'interval' | 'transition'

    worker_count      = Column(Integer, nullable=False, default=0)
    active_count      = Column(Integer, nullable=False, default=0)
    idle_count        = Column(Integer, nullable=False, default=0)
    utilization_score = Column(Float, nullable=False, default=0.0)
    zone_status       = Column(String(20), nullable=False, default="BALANCED")
    congestion_flag   = Column(Boolean, nullable=False, default=False)
    avg_dwell_seconds = Column(Float, nullable=True)
    sparkline_json    = Column(Text, nullable=True)   # JSON string of last-20 worker counts
