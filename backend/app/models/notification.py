from sqlalchemy import Column, Integer, String, Boolean, Text, ForeignKey, DateTime
from sqlalchemy.sql import func
from ..core.db import Base


class Notification(Base):
    __tablename__ = "notifications"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type       = Column(String(100), nullable=False)
    title      = Column(String(300), nullable=False)
    message    = Column(Text, nullable=False)
    camera_id  = Column(Integer, ForeignKey("cameras.id"), nullable=True)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    task_id    = Column(Integer, ForeignKey("project_tasks.id"), nullable=True)
    category   = Column(String(50),  nullable=True)   # 'ppe','camera','project','task','account'
    priority   = Column(String(20),  nullable=True)   # 'critical','high','medium','low'
    action_url = Column(String(500), nullable=True)
    is_read    = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
