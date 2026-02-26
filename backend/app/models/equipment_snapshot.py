"""
EquipmentSnapshot — periodic + transition-triggered equipment usage metrics snapshot.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, String, Text, DateTime, ForeignKey
from ..core.db import Base


class EquipmentSnapshot(Base):
    __tablename__ = "equipment_snapshots"

    id                  = Column(Integer, primary_key=True, index=True)
    project_id          = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id           = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id             = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name           = Column(String(255), nullable=True)

    recorded_at         = Column(DateTime(timezone=True), nullable=False,
                                 default=lambda: datetime.now(timezone.utc), index=True)
    trigger             = Column(String(20), default="interval")   # 'interval' | 'transition'

    active_count        = Column(Integer, nullable=False, default=0)
    idle_count          = Column(Integer, nullable=False, default=0)
    total_count         = Column(Integer, nullable=False, default=0)
    utilization_score   = Column(Float, nullable=False, default=0.0)
    idle_ratio          = Column(Float, nullable=False, default=0.0)
    avg_active_duration = Column(Float, nullable=True)              # seconds avg active duration per equipment
    zone_status         = Column(String(20), nullable=False, default="BALANCED")  # BALANCED | UNDERUTILIZED | OVERLOADED
    cross_zone_conflicts= Column(Integer, nullable=False, default=0)
    misuse_flags_json   = Column(Text, nullable=True)              # JSON list of misuse flag dicts
    sparkline_json      = Column(Text, nullable=True)              # JSON list of last-20 active counts
