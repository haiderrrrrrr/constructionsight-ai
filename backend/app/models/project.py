from enum import Enum
from sqlalchemy import Column, Integer, String, Date, Enum as PgEnum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.db import Base


class ProjectStatus(str, Enum):
    DRAFT = "draft"
    SETUP_IN_PROGRESS = "setup_in_progress"
    ACTIVE = "active"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(200), nullable=False)
    description = Column(String(2000), nullable=True)
    location = Column(String(300), nullable=False)
    client_name = Column(String(200), nullable=True)
    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)
    status = Column(
        PgEnum(ProjectStatus, values_callable=lambda x: [e.value for e in x], create_type=False),
        nullable=False,
        default=ProjectStatus.DRAFT,
    )
    logo_url = Column(String(500), nullable=True)
    logo_public_id = Column(String(300), nullable=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])
    site = relationship("Site", foreign_keys=[site_id])
    memberships = relationship("ProjectMembership", back_populates="project")
    invitations = relationship("ProjectInvitation", back_populates="project")

    @property
    def site_name(self):
        return self.site.name if self.site else None
