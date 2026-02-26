"""
Pydantic schemas for the Equipment Usage Analytics API.
"""
from __future__ import annotations
from typing import Any, Dict, List, Optional
from datetime import datetime
from pydantic import BaseModel


# ── Summary ────────────────────────────────────────────────────────────────────

class EquipmentSummaryResponse(BaseModel):
    total_equipment_today: int = 0
    peak_equipment_count:  int = 0
    avg_utilization:       float = 0.0
    avg_active_duration:   float = 0.0
    avg_idle_ratio:        float = 0.0
    misuse_events:         int = 0
    open_alerts:           int = 0
    open_alerts_total:     int = 0
    acknowledged_alerts:   int = 0
    resolved_alerts:       int = 0


# ── Cameras list (per-camera live metrics) ─────────────────────────────────────

class EquipmentCameraRow(BaseModel):
    camera_id:            int
    camera_name:          str
    zone_id:              Optional[int] = None
    zone_name:            Optional[str] = None
    active_count:         int = 0
    idle_count:           int = 0
    total_count:          int = 0
    latest_active_count:  int = 0
    latest_utilization:   float = 0.0
    latest_zone_status:   str = "BALANCED"
    avg_active_duration:  float = 0.0
    cross_zone_conflicts: int = 0
    misuse_flags:         List[Dict[str, Any]] = []
    sparkline:            List[int] = []


# ── Trend ──────────────────────────────────────────────────────────────────────

class EquipmentTrendPoint(BaseModel):
    recorded_at:          str
    avg_equipment:        float = 0.0
    avg_utilization:      float = 0.0
    avg_idle_ratio:       float = 0.0
    avg_active_duration:  float = 0.0


class EquipmentTrendResponse(BaseModel):
    points: List[EquipmentTrendPoint] = []


# ── Alerts ─────────────────────────────────────────────────────────────────────

class EquipmentAlertRow(BaseModel):
    id:              int
    project_id:      int
    camera_id:       Optional[int] = None
    camera_name:     Optional[str] = None
    zone_id:         Optional[int] = None
    zone_name:       Optional[str] = None
    alert_type:      str
    severity:        str = "medium"
    message:         Optional[str] = None
    equipment_type:  Optional[str] = None
    track_id:        Optional[int] = None
    triggered_at:    Optional[str] = None
    status:          str = "open"
    snapshot_url:    Optional[str] = None

    model_config = {"from_attributes": True}


class EquipmentAlertsPage(BaseModel):
    items: List[EquipmentAlertRow] = []
    total: int = 0
    page:  int = 1


class EquipmentAlertStatusPatch(BaseModel):
    status: str  # open | acknowledged | resolved


# ── Zone Settings ──────────────────────────────────────────────────────────────

class EquipmentZoneSettingsUpdate(BaseModel):
    expected_equipment_count:    Optional[int]   = None
    max_equipment_count:         Optional[int]   = None
    idle_alert_threshold_minutes: Optional[int]  = None
    overuse_threshold_hours:     Optional[float] = None
    min_workers_alongside:       Optional[int]   = None
    alert_sensitivity:           Optional[str]   = None
    confirm_frames:              Optional[int]   = None


class EquipmentZoneSettingsResponse(BaseModel):
    id:                           Optional[int]   = None
    project_id:                   Optional[int]   = None
    camera_id:                    Optional[int]   = None
    expected_equipment_count:    int   = 2
    max_equipment_count:         int   = 10
    idle_alert_threshold_minutes: int  = 30
    overuse_threshold_hours:     float = 8.0
    min_workers_alongside:       int   = 2
    alert_sensitivity:           str   = "medium"
    confirm_frames:              int   = 8

    model_config = {"from_attributes": True}
