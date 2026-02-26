"""
EquipmentAlert — persisted record of equipment misuse / threshold breach alerts.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from ..core.db import Base


class EquipmentAlert(Base):
    __tablename__ = "equipment_alerts"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id       = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id         = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name       = Column(String(255), nullable=True)

    alert_type      = Column(String(50), nullable=False)
    # idle_waste | active_no_workers | ghost_equipment | overuse | cross_zone_conflict
    severity        = Column(String(20), nullable=False, default="medium")  # low | medium | high
    message         = Column(Text, nullable=True)

    equipment_type  = Column(String(100), nullable=True)   # e.g. "crane", "excavator"
    track_id        = Column(Integer, nullable=True)        # ByteTrack track_id of the trigger machine

    triggered_at    = Column(DateTime(timezone=True), nullable=False,
                             default=lambda: datetime.now(timezone.utc), index=True)
    acknowledged    = Column(Boolean, nullable=False, default=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    snapshot_url    = Column(Text, nullable=True)
    status          = Column(String(20), nullable=False, default="open")
