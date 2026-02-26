from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, Boolean
from sqlalchemy.sql import func
from ..core.db import Base


class ReportStatus:
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"
    EMAILED = "emailed"
    EMAIL_FAILED = "email_failed"


class ReportTrigger:
    SCHEDULED = "scheduled"
    MANUAL = "manual"


class ProjectReport(Base):
    __tablename__ = "project_reports"

    id                   = Column(Integer, primary_key=True, index=True)
    project_id           = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    report_type          = Column(String(50), nullable=False, default="ppe")
    # Human-readable period label e.g. "2025-W14", "2025-03-15", "2025-03"
    period_label         = Column(String(50), nullable=True)
    period_start         = Column(DateTime(timezone=True), nullable=False)
    period_end           = Column(DateTime(timezone=True), nullable=False)
    # daily | weekly | monthly
    frequency            = Column(String(20), nullable=False, default="weekly")
    # pending | generating | ready | failed | emailed | email_failed
    status               = Column(String(30), nullable=False, default=ReportStatus.PENDING, index=True)
    file_path            = Column(Text, nullable=True)   # legacy / unused for scheduled reports
    cloudinary_url       = Column(Text, nullable=True)   # secure Cloudinary URL for viewing/download
    cloudinary_public_id = Column(Text, nullable=True)   # used for deletion
    error_message        = Column(Text, nullable=True)
    recipient_count      = Column(Integer, default=0)
    # scheduled | manual
    triggered_by         = Column(String(20), nullable=False, default=ReportTrigger.SCHEDULED)
    triggered_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at           = Column(DateTime(timezone=True), server_default=func.now())
    generated_at         = Column(DateTime(timezone=True), nullable=True)
    emailed_at           = Column(DateTime(timezone=True), nullable=True)


class ReportRecipient(Base):
    """
    Permanent record of every user who was emailed for a given report.
    Saved at send-time so the audit trail is accurate even if the user
    later leaves the project or changes role.
    """
    __tablename__ = "report_recipients"

    id           = Column(Integer, primary_key=True, index=True)
    report_id    = Column(Integer, ForeignKey("project_reports.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id      = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    email        = Column(String(255), nullable=False)
    full_name    = Column(String(255), nullable=True)
    role         = Column(String(50), nullable=True)   # project_manager | site_supervisor | safety_officer
    delivered    = Column(Boolean, default=True)       # False if this specific email failed
    delivered_at = Column(DateTime(timezone=True), nullable=True)
