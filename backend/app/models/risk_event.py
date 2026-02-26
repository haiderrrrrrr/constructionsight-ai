"""
RiskEvent — persisted record of risk threshold breaches and escalations.
Used to trigger notifications and auto-tasks; not surfaced as a table in the dashboard.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, Boolean, String, Text, DateTime, ForeignKey
from ..core.db import Base


class RiskEvent(Base):
    __tablename__ = "risk_events"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id       = Column(Integer, ForeignKey("cameras.id"), nullable=True)
    zone_id         = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name       = Column(String(255), nullable=True)

    # risk_escalated | risk_resolved | compound_risk | prediction_alert | weather_impact
    event_type      = Column(String(50), nullable=False)
    severity        = Column(String(20), nullable=False, default="medium")  # low|medium|high|critical
    message         = Column(Text, nullable=True)

    risk_score          = Column(Float, nullable=True)
    previous_risk_score = Column(Float, nullable=True)

    triggered_at    = Column(DateTime(timezone=True), nullable=False,
                             default=lambda: datetime.now(timezone.utc), index=True)
    acknowledged    = Column(Boolean, nullable=False, default=False)
    acknowledged_at = Column(DateTime(timezone=True), nullable=True)
    acknowledged_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status          = Column(String(20), nullable=False, default="open")  # open|acknowledged|resolved
