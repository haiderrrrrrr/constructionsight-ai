from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Boolean, DateTime
from ..core.db import Base


class SchedulerConfig(Base):
    """Singleton table for camera health-check scheduler configuration.

    Only 1 row (id=1) should ever exist. Stores system-wide scheduler settings
    that persist across server restarts and can be hot-updated via API.
    """
    __tablename__ = "scheduler_config"

    id = Column(Integer, primary_key=True, default=1)
    enabled = Column(Boolean, default=True)
    interval_minutes = Column(Integer, default=5)
    updated_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))
