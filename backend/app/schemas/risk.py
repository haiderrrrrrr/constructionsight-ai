"""Pydantic schemas for Risk Analytics endpoints."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class RiskSchedulerConfigUpdate(BaseModel):
    enabled:          Optional[bool] = None
    interval_seconds: Optional[int]  = Field(None, ge=15, le=600)


class RiskSchedulerStatusOut(BaseModel):
    enabled:          bool
    interval_seconds: int
    last_run_at:      Optional[datetime]
    next_run_at:      Optional[datetime]
    last_summary:     Optional[Dict[str, Any]]
    is_running:       bool
    scheduler_active: bool = False


class RiskFactorOut(BaseModel):
    factor:       str
    contribution: int
    source:       str          # 'activity' | 'workforce' | 'ppe' | 'weather'
    detail:       Optional[str] = None


class RecommendationOut(BaseModel):
    severity: str
    text:     str
    zone:     str


class RiskZoneOut(BaseModel):
    camera_id:                int
    zone_id:                  Optional[int]
    zone_name:                str
    overall_risk:             float
    delay_risk:               float
    safety_risk:              float
    productivity_risk:        float
    risk_level:               str
    trend:                    str
    momentum:                 float
    compound_risk_flag:       bool
    factors:                  List[Dict[str, Any]]
    prediction_risk:          Optional[float]
    prediction_window_minutes: Optional[int]
    recommendations:          List[Dict[str, Any]]
    recorded_at:              Optional[datetime]


class WeatherOut(BaseModel):
    condition:    str
    description:  str
    icon_code:    str
    icon_emoji:   str
    temp_c:       Optional[float]
    feels_like_c: Optional[float]
    humidity:     Optional[float]
    wind_mps:     Optional[float]
    rain_1h:      Optional[float]
    visibility_m: Optional[float]
    clouds_pct:   Optional[float]
    city:         Optional[str]
    fetched_at:   Optional[float]


class RiskSummaryOut(BaseModel):
    overall_risk:     float
    risk_level:       str
    high_risk_count:  int
    critical_count:   int
    delay_probability: Optional[float]
    active_signals:   List[str]
    weather:          Optional[WeatherOut]
    zones:            List[RiskZoneOut]


class RiskTrendPointOut(BaseModel):
    recorded_at:       datetime
    overall_risk:      float
    delay_risk:        float
    safety_risk:       float
    productivity_risk: float
    zone_id:           Optional[int]
    zone_name:         Optional[str]


class RiskEventOut(BaseModel):
    id:                   int
    event_type:           str
    severity:             str
    message:              Optional[str]
    zone_name:            Optional[str]
    risk_score:           Optional[float]
    previous_risk_score:  Optional[float]
    triggered_at:         datetime
    status:               str
    acknowledged:         bool

    class Config:
        from_attributes = True
