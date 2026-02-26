from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class WorkforceZoneSettingsUpdate(BaseModel):
    required_workers:     Optional[int] = Field(None, ge=1, le=200)
    max_workers:          Optional[int] = Field(None, ge=1, le=500)
    idle_alert_threshold: Optional[int] = Field(None, ge=0, le=100)
    alert_sensitivity:    Optional[str] = Field(None, pattern="^(low|medium|high|ultra_high)$")


class WorkforceZoneSettingsResponse(BaseModel):
    id:                           int
    project_id:                   int
    camera_id:                    Optional[int]
    required_workers:             int
    max_workers:                  int
    idle_alert_threshold:         int
    alert_sensitivity:            str
    understaffed_confirm_samples: int
    overload_confirm_seconds:     int

    model_config = {"from_attributes": True}
