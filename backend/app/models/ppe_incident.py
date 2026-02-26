from sqlalchemy import Boolean, Column, Integer, String, Float, Text, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class PpeIncident(Base):
    __tablename__ = "ppe_incidents"

    id               = Column(Integer, primary_key=True, index=True)
    project_id       = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    camera_id        = Column(Integer, ForeignKey("cameras.id"), nullable=True, index=True)
    zone_id          = Column(Integer, ForeignKey("zones.id"), nullable=True)
    zone_name        = Column(String(255), nullable=True)
    track_id         = Column(Integer, nullable=True)
    global_person_id = Column(Integer, nullable=True)
    # Explicit PPE status at time of violation (True = worn, False = missing)
    has_helmet       = Column(Boolean, nullable=True)
    has_vest         = Column(Boolean, nullable=True)
    # 'no_helmet' | 'no_vest' | 'both_missing'
    incident_type    = Column(String(50), nullable=False)
    started_at       = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ended_at         = Column(DateTime(timezone=True), nullable=True)
    # 'low' | 'medium' | 'high'
    severity         = Column(String(20), nullable=False, default="medium")
    # 'open' | 'acknowledged' | 'resolved'
    status           = Column(String(20), nullable=False, default="open")
    snapshot_url     = Column(Text, nullable=True)
    video_clip_url   = Column(Text, nullable=True)
    frame_confidence = Column(Float, nullable=True)
    created_at       = Column(DateTime(timezone=True), server_default=func.now())
