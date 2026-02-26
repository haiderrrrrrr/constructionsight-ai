"""
RiskSchedulerConfig — singleton (id=1) config for the risk analysis scheduler.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Boolean, DateTime
from ..core.db import Base


class RiskSchedulerConfig(Base):
    __tablename__ = "risk_scheduler_config"

    id               = Column(Integer, primary_key=True, default=1)
    enabled          = Column(Boolean, nullable=False, default=True)
    interval_seconds = Column(Integer, nullable=False, default=30)   # 15–600
    updated_at       = Column(DateTime(timezone=True),
                              default=lambda: datetime.now(timezone.utc),
                              onupdate=lambda: datetime.now(timezone.utc))
