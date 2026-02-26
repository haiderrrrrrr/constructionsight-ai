"""Pydantic schemas for ML configuration."""

from typing import Optional
from pydantic import BaseModel, Field


class MLConfigUpdate(BaseModel):
    """Request schema for updating ML config (all fields optional)."""
    stage1_conf: Optional[float] = Field(None, ge=0.0, le=1.0)
    stage2_conf: Optional[float] = Field(None, ge=0.0, le=1.0)
    padding: Optional[float] = Field(None, ge=0.0)
    imgsz_stage1: Optional[int] = Field(None, ge=64, le=1920)
    imgsz_stage2: Optional[int] = Field(None, ge=64, le=640)

    helmet_conf_multiplier: Optional[float] = Field(None, ge=0.0, le=2.0)
    vest_conf_multiplier: Optional[float] = Field(None, ge=0.0, le=2.0)
    turned_conf_multiplier: Optional[float] = Field(None, ge=0.0, le=2.0)

    min_crop_height: Optional[int] = Field(None, ge=10, le=500)
    min_crop_width: Optional[int] = Field(None, ge=10, le=500)
    helmet_region_bottom_max_normal: Optional[float] = Field(None, ge=0.0, le=1.0)
    helmet_region_bottom_max_crouching: Optional[float] = Field(None, ge=0.0, le=1.0)
    vest_region_center_min: Optional[float] = Field(None, ge=0.0, le=1.0)
    vest_region_center_max: Optional[float] = Field(None, ge=0.0, le=1.0)
    head_cutoff_px: Optional[int] = Field(None, ge=0)
    legs_only_bottom_px: Optional[int] = Field(None, ge=0)
    legs_only_max_height: Optional[int] = Field(None, ge=10)
    crouching_aspect_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    turned_aspect_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)

    overlap_iou_thresh: Optional[float] = Field(None, ge=0.0, le=1.0)
    blur_laplacian_thresh: Optional[float] = Field(None, ge=0.0)

    confirm_frames: Optional[int] = Field(None, ge=1, le=100)
    violation_frames: Optional[int] = Field(None, ge=1, le=100)
    uncertain_frames_to_fallback: Optional[int] = Field(None, ge=1, le=100)
    lost_frames: Optional[int] = Field(None, ge=1, le=500)
    alert_cooldown_frames: Optional[int] = Field(None, ge=1, le=500)

    reid_enabled: Optional[bool] = None
    reid_thresh: Optional[float] = Field(None, ge=0.0, le=1.0)
    reid_ema_frames: Optional[int] = Field(None, ge=1, le=50)
    reid_ema_alpha: Optional[float] = Field(None, ge=0.0, le=1.0)


class MLConfigOut(BaseModel):
    """Response schema for ML configuration."""
    id: int
    stage1_conf: float
    stage2_conf: float
    padding: float
    imgsz_stage1: int
    imgsz_stage2: int

    helmet_conf_multiplier: float
    vest_conf_multiplier: float
    turned_conf_multiplier: float

    min_crop_height: int
    min_crop_width: int
    helmet_region_bottom_max_normal: float
    helmet_region_bottom_max_crouching: float
    vest_region_center_min: float
    vest_region_center_max: float
    head_cutoff_px: int
    legs_only_bottom_px: int
    legs_only_max_height: int
    crouching_aspect_ratio: float
    turned_aspect_ratio: float

    overlap_iou_thresh: float
    blur_laplacian_thresh: float

    confirm_frames: int
    violation_frames: int
    uncertain_frames_to_fallback: int
    lost_frames: int
    alert_cooldown_frames: int

    reid_enabled: bool
    reid_thresh: float
    reid_ema_frames: int
    reid_ema_alpha: float

    class Config:
        from_attributes = True
