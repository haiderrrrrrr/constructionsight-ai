from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Boolean, Text, ForeignKey, DateTime
from ..core.db import Base


class ProjectTask(Base):
    __tablename__ = "project_tasks"

    id                = Column(Integer, primary_key=True, index=True)
    project_id        = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    title             = Column(String(500), nullable=False)
    description       = Column(Text, nullable=True)
    is_done           = Column(Boolean, default=False, nullable=False)
    created_by        = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at        = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    done_at           = Column(DateTime(timezone=True), nullable=True)
    # PPE auto-generation fields
    auto_generated    = Column(Boolean, default=False, nullable=False)
    source_incident_id = Column(Integer, ForeignKey("ppe_incidents.id"), nullable=True)
    assigned_role     = Column(String(50), nullable=True)
