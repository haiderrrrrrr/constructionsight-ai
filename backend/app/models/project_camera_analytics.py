from sqlalchemy import Column, Integer, Boolean, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class ProjectCameraAnalytics(Base):
    __tablename__ = "project_camera_analytics"

    id                       = Column(Integer, primary_key=True, index=True)
    project_camera_id        = Column(Integer, ForeignKey("project_cameras.id"), nullable=False, unique=True)
    ppe_enabled              = Column(Boolean, nullable=False, default=False)
    ppe_enabled_at           = Column(DateTime(timezone=True), nullable=True)
    workforce_enabled        = Column(Boolean, nullable=False, default=False)
    workforce_enabled_at     = Column(DateTime(timezone=True), nullable=True)
    activity_enabled         = Column(Boolean, nullable=False, default=False)
    equipment_enabled        = Column(Boolean, nullable=False, default=False)
    inference_events_enabled = Column(Boolean, nullable=False, default=True)
    updated_at               = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
