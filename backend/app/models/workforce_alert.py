"""
WorkforceAlert — persisted record of workforce threshold breach alerts.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, ForeignKey
from ..core.db import Base


class WorkforceAlert(Base):
    __tablename__ = "workforce_alerts"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id       = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id         = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name       = Column(String(255), nullable=True)

    alert_type      = Column(String(50), nullable=False)   # understaffed | idle_ratio_high | sudden_drop | overload
    severity        = Column(String(20), nullable=False, default="medium")  # low | medium | high
    message         = Column(Text, nullable=True)

    triggered_at    = Column(DateTime(timezone=True), nullable=False,
                             default=lambda: datetime.now(timezone.utc), index=True)
    acknowledged    = Column(Boolean, nullable=False, default=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    snapshot_url    = Column(Text, nullable=True)
    status          = Column(String(20), nullable=False, default="open")
    worker_id       = Column(Integer, nullable=True)   # logical_id of the trigger worker (idle_ratio_high / sudden_drop)
