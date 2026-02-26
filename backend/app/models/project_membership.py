from enum import Enum
from sqlalchemy import Column, Integer, String, Enum as PgEnum, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.db import Base


class ProjectRole(str, Enum):
    PROJECT_MANAGER = "project_manager"
    SITE_SUPERVISOR = "site_supervisor"
    SAFETY_OFFICER = "safety_officer"
    DATA_ANALYST = "data_analyst"
    STAKEHOLDER = "stakeholder"


class MembershipStatus(str, Enum):
    ACTIVE = "active"
    REMOVED = "removed"


class ProjectMembership(Base):
    __tablename__ = "project_memberships"
    __table_args__ = (
        UniqueConstraint("user_id", "project_id", "project_role", name="uq_membership_user_project_role"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    project_role = Column(PgEnum(ProjectRole, values_callable=lambda x: [e.value for e in x], create_type=False), nullable=False)
    status = Column(PgEnum(MembershipStatus, values_callable=lambda x: [e.value for e in x], create_type=False), nullable=False, default=MembershipStatus.ACTIVE)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    joined_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id], backref="project_memberships")
    inviter = relationship("User", foreign_keys=[invited_by])
    project = relationship("Project", foreign_keys=[project_id], back_populates="memberships")
