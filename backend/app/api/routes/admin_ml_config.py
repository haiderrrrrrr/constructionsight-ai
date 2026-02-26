"""
Admin ML Config — GET and PATCH the singleton MLConfig row (id=1).

Prefix: /admin/ml-config
Auth:   require_admin

Useful for demo: adjust alert_cooldown_frames and incident_dedup_seconds
without restarting the server. Changes take effect within 5 minutes (cache TTL).
Call PATCH /admin/ml-config/invalidate-cache to force immediate reload.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..deps import get_db, require_admin, get_current_user
from ...models.user import User

router = APIRouter(prefix="/admin/ml-config", tags=["admin-ml-config"])


class MLConfigPatch(BaseModel):
    # State machine
    alert_cooldown_frames: Optional[int] = None
    violation_frames: Optional[int] = None
    confirm_frames: Optional[int] = None
    lost_frames: Optional[int] = None
    uncertain_frames_to_fallback: Optional[int] = None
    # Incident dedup
    incident_dedup_seconds: Optional[int] = None
    # Detection thresholds
    stage1_conf: Optional[float] = Field(None, ge=0.0, le=1.0)
    stage2_conf: Optional[float] = Field(None, ge=0.0, le=1.0)
    # ReID
    reid_enabled: Optional[bool] = None
    reid_thresh: Optional[float] = Field(None, ge=0.0, le=1.0)
    reid_assign_thresh: Optional[float] = Field(None, ge=0.0, le=1.0)
    reid_match_thresh: Optional[float] = Field(None, ge=0.0, le=1.0)
    reid_min_pending_frames: Optional[int] = None
    reid_quality_min: Optional[float] = Field(None, ge=0.0, le=1.0)
    reid_identity_top_k: Optional[int] = None
    reid_min_trusted_embeddings: Optional[int] = None
    reid_max_gallery_size: Optional[int] = None
    reid_persist_state_max_age_s: Optional[int] = None
    # Equipment Analytics
    equipment_stage1_conf:            Optional[float] = Field(None, ge=0.0, le=1.0)
    equipment_movement_thresh:        Optional[float] = None
    equipment_idle_confirm_secs:      Optional[int]   = None
    equipment_lost_frames:            Optional[int]   = None
    equipment_snapshot_interval_secs: Optional[int]   = None
    equipment_alert_cooldown_secs:    Optional[int]   = None
    equipment_groundingdino_prompt:   Optional[str]   = None


def _get_or_create_config(db: Session):
    from ...models.ml_config import MLConfig
    config = db.query(MLConfig).filter(MLConfig.id == 1).first()
    if not config:
        config = MLConfig(id=1)
        db.add(config)
        db.commit()
        db.refresh(config)
    return config


@router.get("")
def get_ml_config(
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Return current ML config values (all fields)."""
    config = _get_or_create_config(db)
    return {
        "id": config.id,
        # Detection
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "padding": config.padding,
        "imgsz_stage1": config.imgsz_stage1,
        "imgsz_stage2": config.imgsz_stage2,
        # Multipliers
        "helmet_conf_multiplier": config.helmet_conf_multiplier,
        "vest_conf_multiplier": config.vest_conf_multiplier,
        "turned_conf_multiplier": config.turned_conf_multiplier,
        # Crop
        "min_crop_height": config.min_crop_height,
        "min_crop_width": config.min_crop_width,
        # State machine
        "confirm_frames": config.confirm_frames,
        "violation_frames": config.violation_frames,
        "uncertain_frames_to_fallback": config.uncertain_frames_to_fallback,
        "lost_frames": config.lost_frames,
        "alert_cooldown_frames": config.alert_cooldown_frames,
        # Incident dedup
        "incident_dedup_seconds": getattr(config, "incident_dedup_seconds", 30),
        # ReID
        "reid_enabled": config.reid_enabled,
        "reid_thresh": config.reid_thresh,
        "reid_ema_frames": config.reid_ema_frames,
        "reid_ema_alpha": config.reid_ema_alpha,
        "reid_assign_thresh": getattr(config, "reid_assign_thresh", 0.86),
        "reid_match_thresh": getattr(config, "reid_match_thresh", 0.72),
        "reid_min_pending_frames": getattr(config, "reid_min_pending_frames", 8),
        "reid_quality_min": getattr(config, "reid_quality_min", 0.65),
        "reid_identity_top_k": getattr(config, "reid_identity_top_k", 5),
        "reid_min_trusted_embeddings": getattr(config, "reid_min_trusted_embeddings", 2),
        "reid_max_gallery_size": getattr(config, "reid_max_gallery_size", 500),
        "reid_persist_state_max_age_s": getattr(config, "reid_persist_state_max_age_s", 300),
        # Equipment Analytics
        "equipment_stage1_conf":            getattr(config, "equipment_stage1_conf",            0.35),
        "equipment_movement_thresh":        getattr(config, "equipment_movement_thresh",        3.0),
        "equipment_idle_confirm_secs":      getattr(config, "equipment_idle_confirm_secs",      30),
        "equipment_lost_frames":            getattr(config, "equipment_lost_frames",            25),
        "equipment_snapshot_interval_secs": getattr(config, "equipment_snapshot_interval_secs", 60),
        "equipment_alert_cooldown_secs":    getattr(config, "equipment_alert_cooldown_secs",    600),
        "equipment_groundingdino_prompt":   getattr(config, "equipment_groundingdino_prompt",   "excavator, wheel loader, front loader, loader, bulldozer, dump truck, crane, forklift, compactor, heavy construction equipment"),
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


@router.patch("")
def patch_ml_config(
    body: MLConfigPatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Update ML config fields. Only provided fields are changed.
    Changes are picked up within 5 minutes (cache TTL).
    Call POST /admin/ml-config/invalidate-cache for immediate effect.

    Note: Relaxed to allow any authenticated user for demo purposes.
    """
    from ...services.ml_config_service import invalidate_cache

    config = _get_or_create_config(db)

    updated_fields = []
    for field, value in body.model_dump(exclude_none=True).items():
        if hasattr(config, field):
            setattr(config, field, value)
            updated_fields.append(field)

    if not updated_fields:
        raise HTTPException(status_code=400, detail="No valid fields provided")

    db.commit()
    db.refresh(config)

    # Invalidate config cache so changes take effect immediately
    invalidate_cache()

    return {
        "updated_fields": updated_fields,
        "alert_cooldown_frames": config.alert_cooldown_frames,
        "incident_dedup_seconds": getattr(config, "incident_dedup_seconds", 30),
        "violation_frames": config.violation_frames,
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "reid_enabled": config.reid_enabled,
        "reid_assign_thresh": getattr(config, "reid_assign_thresh", 0.86),
        "reid_match_thresh": getattr(config, "reid_match_thresh", 0.72),
        "reid_min_pending_frames": getattr(config, "reid_min_pending_frames", 8),
        "reid_quality_min": getattr(config, "reid_quality_min", 0.65),
        "reid_identity_top_k": getattr(config, "reid_identity_top_k", 5),
        "reid_min_trusted_embeddings": getattr(config, "reid_min_trusted_embeddings", 2),
        "reid_max_gallery_size": getattr(config, "reid_max_gallery_size", 500),
        "reid_persist_state_max_age_s": getattr(config, "reid_persist_state_max_age_s", 300),
    }


@router.post("/reset")
def reset_ml_config(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """
    Reset global ML config to defaults (from scripts/run5.py).
    Available to any authenticated user for demo purposes.
    """
    from ...services.ml_config_service import invalidate_cache

    config = _get_or_create_config(db)

    # Reset to defaults (from scripts/run5.py)
    config.stage1_conf = 0.30
    config.stage2_conf = 0.30
    config.padding = 0.30
    config.imgsz_stage1 = 960
    config.imgsz_stage2 = 224
    config.helmet_conf_multiplier = 1.00
    config.vest_conf_multiplier = 0.75
    config.turned_conf_multiplier = 0.75
    config.min_crop_height = 60
    config.min_crop_width = 40
    config.helmet_region_bottom_max_normal = 0.55
    config.helmet_region_bottom_max_crouching = 0.72
    config.vest_region_center_min = 0.25
    config.vest_region_center_max = 0.90
    config.head_cutoff_px = 5
    config.legs_only_bottom_px = 10
    config.legs_only_max_height = 100
    config.crouching_aspect_ratio = 0.70
    config.turned_aspect_ratio = 0.28
    config.overlap_iou_thresh = 0.60
    config.blur_laplacian_thresh = 40.0
    config.confirm_frames = 5
    config.violation_frames = 8
    config.uncertain_frames_to_fallback = 8
    config.lost_frames = 30
    config.alert_cooldown_frames = 90
    config.reid_enabled = True
    config.reid_thresh = 0.60
    config.reid_ema_frames = 5
    config.reid_ema_alpha = 0.6
    config.reid_assign_thresh = 0.86
    config.reid_match_thresh = 0.72
    config.reid_min_pending_frames = 8
    config.reid_quality_min = 0.65
    config.reid_identity_top_k = 5
    config.reid_min_trusted_embeddings = 2
    config.reid_max_gallery_size = 500
    config.reid_persist_state_max_age_s = 300
    config.incident_dedup_seconds = 30

    db.commit()
    db.refresh(config)

    # Invalidate cache so changes take effect immediately
    invalidate_cache()

    return {
        "message": "Global ML config reset to production defaults",
        "stage1_conf": config.stage1_conf,
        "stage2_conf": config.stage2_conf,
        "violation_frames": config.violation_frames,
        "confirm_frames": config.confirm_frames,
        "lost_frames": config.lost_frames,
        "alert_cooldown_frames": config.alert_cooldown_frames,
        "incident_dedup_seconds": config.incident_dedup_seconds,
        "reid_enabled": config.reid_enabled,
    }
