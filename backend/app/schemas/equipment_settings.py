from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field


class EquipmentZoneSettingsUpdate(BaseModel):
    expected_equipment_count:     Optional[int]   = Field(None, ge=1, le=200)
    max_equipment_count:          Optional[int]   = Field(None, ge=1, le=500)
    idle_alert_threshold_minutes: Optional[int]   = Field(None, ge=0, le=1440)
    overuse_threshold_hours:      Optional[float] = Field(None, ge=0.5, le=24.0)
    min_workers_alongside:        Optional[int]   = Field(None, ge=0, le=100)
    alert_sensitivity:            Optional[str]   = Field(None, pattern="^(low|medium|high|ultra_high)$")
    confirm_frames:               Optional[int]   = Field(None, ge=1, le=60)


class EquipmentZoneSettingsResponse(BaseModel):
    id:                           int
    project_id:                   int
    camera_id:                    Optional[int]
    expected_equipment_count:     int
    max_equipment_count:          int
    idle_alert_threshold_minutes: int
    overuse_threshold_hours:      float
    min_workers_alongside:        int
    alert_sensitivity:            str
    confirm_frames:               int

    model_config = {"from_attributes": True}
