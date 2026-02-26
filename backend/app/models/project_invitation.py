from enum import Enum
from sqlalchemy import Column, Integer, String, Enum as PgEnum, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..core.db import Base
from .project_membership import ProjectRole


class InvitationStatus(str, Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class ProjectInvitation(Base):
    __tablename__ = "project_invitations"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    invited_name = Column(String(255), nullable=True)  # display name for non-registered invitees
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    role = Column(
        PgEnum(ProjectRole, values_callable=lambda x: [e.value for e in x], create_type=False),
        nullable=False,
    )
    token = Column(String(128), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    accepted_at = Column(DateTime(timezone=True), nullable=True)
    invited_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(
        PgEnum(InvitationStatus, values_callable=lambda x: [e.value for e in x], create_type=False),
        nullable=False,
        default=InvitationStatus.PENDING,
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    project = relationship("Project", foreign_keys=[project_id], back_populates="invitations")
    inviter = relationship("User", foreign_keys=[invited_by])
