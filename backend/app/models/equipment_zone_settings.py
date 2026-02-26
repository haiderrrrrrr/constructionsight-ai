from sqlalchemy import Column, Integer, String, Float, Text, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class EquipmentZoneSettings(Base):
    __tablename__ = "equipment_zone_settings"

    id                       = Column(Integer, primary_key=True, index=True)
    project_id               = Column(Integer, nullable=False, index=True)
    camera_id                = Column(Integer, nullable=True, index=True)  # NULL = project-level default

    # Equipment count thresholds
    expected_equipment_count = Column(Integer, nullable=False, default=2)
    max_equipment_count      = Column(Integer, nullable=False, default=10)

    # Alert tuning
    idle_alert_threshold_minutes = Column(Integer, nullable=False, default=30)   # minutes idle before alert
    overuse_threshold_hours      = Column(Float, nullable=False, default=8.0)    # hours active before overuse alert
    min_workers_alongside        = Column(Integer, nullable=False, default=2)    # workers required when equipment active
    alert_sensitivity            = Column(String(10), nullable=False, default="medium")  # low/medium/high

    # Detection confirm timing
    confirm_frames               = Column(Integer, nullable=False, default=8)    # frames before leaving ENTERING state

    # Demo mode — stores original settings as JSON for restore on deactivation
    pre_demo_snapshot            = Column(Text, nullable=True)

    updated_at                   = Column(DateTime(timezone=True), server_default=func.now(),
                                          onupdate=func.now())
