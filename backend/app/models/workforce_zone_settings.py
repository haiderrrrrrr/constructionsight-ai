from sqlalchemy import Column, Integer, String, Text, Time, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class WorkforceZoneSettings(Base):
    __tablename__ = "workforce_zone_settings"

    id                    = Column(Integer, primary_key=True, index=True)
    project_id            = Column(Integer, nullable=False, index=True)
    # NULL = project-level default; non-NULL = per-camera override
    camera_id             = Column(Integer, nullable=True, index=True)

    # Staffing thresholds
    required_workers      = Column(Integer, nullable=False, default=2)
    max_workers           = Column(Integer, nullable=False, default=15)

    # Alert tuning
    idle_alert_threshold  = Column(Integer, nullable=False, default=60)   # percent (0-100)
    alert_sensitivity     = Column(String(10), nullable=False, default="medium")  # low/medium/high

    # Alert confirm timing — how long/many samples before firing
    understaffed_confirm_samples = Column(Integer, nullable=False, default=30)  # metric cycles (~30s each)
    overload_confirm_seconds     = Column(Integer, nullable=False, default=180) # seconds congestion must persist

    # Operating hours (NULL = always alert)
    operating_hours_start = Column(Time, nullable=True)
    operating_hours_end   = Column(Time, nullable=True)

    # Detection tuning
    confirm_frames        = Column(Integer, nullable=False, default=8)
    idle_time_seconds     = Column(Integer, nullable=False, default=30)

    # Demo mode — stores original settings as JSON so they can be restored on deactivation
    pre_demo_snapshot     = Column(Text, nullable=True)

    updated_at            = Column(DateTime(timezone=True), server_default=func.now(),
                                   onupdate=func.now())
