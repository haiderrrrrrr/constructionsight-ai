from sqlalchemy import Column, Integer, String, Float, Time, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class ActivityZoneSettings(Base):
    __tablename__ = "activity_zone_settings"

    id                          = Column(Integer, primary_key=True, index=True)
    project_id                  = Column(Integer, nullable=False, index=True)
    # NULL = project-level default; non-NULL = per-camera override
    camera_id                   = Column(Integer, nullable=True, index=True)

    # Zone state thresholds
    idle_threshold_seconds      = Column(Integer, nullable=False, default=300)   # secs no motion → IDLE
    alert_idle_minutes          = Column(Integer, nullable=False, default=15)    # mins IDLE before alert fires
    low_activity_threshold      = Column(Integer, nullable=False, default=30)    # % moving workers for ACTIVE (else LOW)

    # Worker motion detection
    movement_thresh_px          = Column(Float, nullable=False, default=6.0)     # pixel/frame avg displacement = MOVING
    stationary_thresh_secs      = Column(Integer, nullable=False, default=20)    # secs low displacement → STATIONARY

    # Alert tuning
    alert_sensitivity           = Column(String(10), nullable=False, default="medium")  # low/medium/high/ultra_high
    zone_idle_confirm_cycles        = Column(Integer, nullable=False, default=3)   # cycles (~30s each) IDLE before alert fires
    low_activity_sustained_minutes  = Column(Integer, nullable=False, default=30)  # mins LOW_ACTIVITY before alert fires

    # Optical flow (secondary signal)
    optical_flow_weight         = Column(Float, nullable=False, default=0.2)     # 0.0-1.0 blend weight

    # Operating hours (NULL = always alert)
    operating_hours_start       = Column(Time, nullable=True)
    operating_hours_end         = Column(Time, nullable=True)

    updated_at                  = Column(DateTime(timezone=True), server_default=func.now(),
                                         onupdate=func.now())
