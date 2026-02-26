from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class ActivityZoneSettingsUpdate(BaseModel):
    idle_threshold_seconds: Optional[int]   = Field(None, ge=30,  le=3600)
    alert_idle_minutes:     Optional[int]   = Field(None, ge=1,   le=120)
    low_activity_threshold: Optional[int]   = Field(None, ge=5,   le=90)
    movement_thresh_px:     Optional[float] = Field(None, ge=1.0, le=50.0)
    stationary_thresh_secs: Optional[int]   = Field(None, ge=5,   le=300)
    alert_sensitivity:              Optional[str]   = Field(None, pattern="^(low|medium|high|ultra_high)$")
    optical_flow_weight:            Optional[float] = Field(None, ge=0.0, le=1.0)
    zone_idle_confirm_cycles:       Optional[int]   = Field(None, ge=1, le=10)
    low_activity_sustained_minutes: Optional[int]   = Field(None, ge=1, le=120)


class ActivityZoneSettingsResponse(BaseModel):
    id:                     int
    project_id:             int
    camera_id:              Optional[int]
    idle_threshold_seconds: int
    alert_idle_minutes:     int
    low_activity_threshold: int
    movement_thresh_px:     float
    stationary_thresh_secs: int
    alert_sensitivity:              str
    optical_flow_weight:            float
    zone_idle_confirm_cycles:       int
    low_activity_sustained_minutes: int

    model_config = {"from_attributes": True}
