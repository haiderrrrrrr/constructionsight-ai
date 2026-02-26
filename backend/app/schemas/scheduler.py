from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class SchedulerConfigUpdate(BaseModel):
    """Request body for updating scheduler configuration."""
    enabled: Optional[bool] = None
    interval_minutes: Optional[int] = Field(None, ge=1, le=60)


class SchedulerConfigOut(BaseModel):
    """Current scheduler configuration."""
    enabled: bool
    interval_minutes: int

    class Config:
        from_attributes = True


class SchedulerStatusOut(BaseModel):
    """Scheduler runtime status."""
    enabled: bool
    interval_minutes: int
    last_run_at: Optional[datetime] = None
    next_run_at: Optional[datetime] = None
    last_summary: Optional[dict] = None
    is_running: bool
    scheduler_active: bool
