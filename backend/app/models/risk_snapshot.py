"""
RiskSnapshot — computed risk scores per zone per scheduler cycle.
Stores outputs only; raw inputs live in workforce_snapshots, activity_snapshots, ppe_incidents.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Float, Boolean, String, Text, DateTime, ForeignKey
from ..core.db import Base


class RiskSnapshot(Base):
    __tablename__ = "risk_snapshots"

    id              = Column(Integer, primary_key=True, index=True)
    project_id      = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id       = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id         = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name       = Column(String(255), nullable=True)

    recorded_at     = Column(DateTime(timezone=True), nullable=False,
                             default=lambda: datetime.now(timezone.utc), index=True)

    # Computed risk scores (0-100)
    delay_risk        = Column(Float, nullable=False, default=0.0)
    safety_risk       = Column(Float, nullable=False, default=0.0)
    productivity_risk = Column(Float, nullable=False, default=0.0)
    overall_risk      = Column(Float, nullable=False, default=0.0)

    # Classification
    risk_level  = Column(String(20), nullable=False, default="low")   # low|moderate|high|critical
    trend       = Column(String(20), nullable=False, default="stable") # rising|stable|decreasing
    momentum    = Column(Float, nullable=False, default=0.0)           # positive = worsening

    # Explanation JSON: [{factor, contribution, source, detail}]
    factors_json = Column(Text, nullable=True)

    # Prediction
    prediction_risk             = Column(Float, nullable=True)
    prediction_window_minutes   = Column(Integer, nullable=True)
    compound_risk_flag          = Column(Boolean, nullable=False, default=False)

    # Weather snapshot at compute time
    weather_condition = Column(String(50), nullable=True)
    weather_temp      = Column(Float, nullable=True)
    weather_wind      = Column(Float, nullable=True)
    weather_rain      = Column(Float, nullable=True)
