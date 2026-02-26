"""
ML Configuration — singleton table for detection + tracking thresholds.

Enterprise pattern:
  - Only 1 row (id=1) should exist
  - Hot-updateable via API
  - Persists across restarts
  
  - Replicates all settings from scripts/run5.py
"""

from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Boolean, DateTime, Float, String
from ..core.db import Base


class MLConfig(Base):
    """Singleton table for ML inference configuration."""
    __tablename__ = "ml_config"

    id = Column(Integer, primary_key=True, default=1)

    # ── Detection thresholds ───────────────────────────────────────────
    # Stage 1 (person detection) confidence
    stage1_conf = Column(Float, default=0.30)
    # Stage 2 (PPE detection) confidence
    stage2_conf = Column(Float, default=0.30)
    # Crop padding around person bbox
    padding = Column(Float, default=0.30)
    # Stage 1 input image size
    imgsz_stage1 = Column(Integer, default=960)
    # Stage 2 input image size
    imgsz_stage2 = Column(Integer, default=224)

    # ── Confidence multipliers ──────────────────────────────────────────
    helmet_conf_multiplier = Column(Float, default=1.00)
    vest_conf_multiplier = Column(Float, default=0.75)
    turned_conf_multiplier = Column(Float, default=0.75)

    # ── Crop validation ────────────────────────────────────────────────
    min_crop_height = Column(Integer, default=60)
    min_crop_width = Column(Integer, default=40)
    helmet_region_bottom_max_normal = Column(Float, default=0.55)
    helmet_region_bottom_max_crouching = Column(Float, default=0.72)
    vest_region_center_min = Column(Float, default=0.25)
    vest_region_center_max = Column(Float, default=0.90)
    head_cutoff_px = Column(Integer, default=5)
    legs_only_bottom_px = Column(Integer, default=10)
    legs_only_max_height = Column(Integer, default=100)
    crouching_aspect_ratio = Column(Float, default=0.70)
    turned_aspect_ratio = Column(Float, default=0.28)

    # ── Frame quality ──────────────────────────────────────────────────
    overlap_iou_thresh = Column(Float, default=0.60)
    blur_laplacian_thresh = Column(Float, default=40.0)

    # ── State machine ──────────────────────────────────────────────────
    confirm_frames = Column(Integer, default=5)
    violation_frames = Column(Integer, default=8)
    uncertain_frames_to_fallback = Column(Integer, default=8)
    lost_frames = Column(Integer, default=30)
    alert_cooldown_frames = Column(Integer, default=90)

    # ── ReID (enterprise advanced feature) ──────────────────────────────
    reid_enabled = Column(Boolean, default=True)
    reid_thresh = Column(Float, default=0.60)
    reid_ema_frames = Column(Integer, default=5)
    reid_ema_alpha = Column(Float, default=0.6)
    reid_assign_thresh = Column(Float, default=0.86)
    reid_match_thresh = Column(Float, default=0.72)
    reid_min_pending_frames = Column(Integer, default=8)
    reid_quality_min = Column(Float, default=0.65)
    reid_identity_top_k = Column(Integer, default=5)
    reid_min_trusted_embeddings = Column(Integer, default=2)
    reid_max_gallery_size = Column(Integer, default=500)
    reid_persist_state_max_age_s = Column(Integer, default=300)

    # ── Incident deduplication window ────────────────────────────────────
    # Seconds within which the same person's second violation is skipped (prevents spam)
    incident_dedup_seconds = Column(Integer, default=30)

    # ── Workforce Analytics thresholds ────────────────────────────────────────
    workforce_movement_thresh        = Column(Float,   default=8.0)
    workforce_idle_time_seconds      = Column(Integer, default=30)
    workforce_lost_frames            = Column(Integer, default=45)
    workforce_confirm_frames         = Column(Integer, default=8)
    workforce_understaffed_threshold = Column(Integer, default=2)
    workforce_overloaded_threshold   = Column(Integer, default=15)
    workforce_snapshot_interval_secs = Column(Integer, default=60)
    workforce_alert_cooldown_secs    = Column(Integer, default=600)
    workforce_reconcile_distance_px  = Column(Integer, default=80)
    workforce_reconcile_window_secs  = Column(Integer, default=4)

    # ── Equipment Analytics thresholds ────────────────────────────────────────
    equipment_stage1_conf            = Column(Float,   default=0.35)
    equipment_movement_thresh        = Column(Float,   default=3.0)
    equipment_idle_confirm_secs      = Column(Integer, default=30)
    equipment_lost_frames            = Column(Integer, default=25)
    equipment_snapshot_interval_secs = Column(Integer, default=60)
    equipment_alert_cooldown_secs    = Column(Integer, default=600)
    equipment_groundingdino_prompt   = Column(String,  default="crane, excavator, concrete truck, dump truck, bulldozer, forklift, compactor")

    updated_at = Column(DateTime(timezone=True), default=datetime.now(timezone.utc), onupdate=datetime.now(timezone.utc))
