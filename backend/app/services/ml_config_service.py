"""
ML Config Service — load from DB with caching + graceful defaults.

Enterprise pattern:
  - In-memory cache with TTL to avoid DB hits per frame
  - Graceful fallback to hardcoded defaults if DB unavailable
  - Thread-safe reads
  - Hot updates via API
"""

import logging
import threading
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# ── Cache state ────────────────────────────────────────────────────────────
_cache: Optional[Dict[str, Any]] = None
_cache_time: Optional[datetime] = None
_cache_ttl_seconds = 300  # 5 minutes
_cache_lock = threading.Lock()

# ── Hardcoded defaults (fallback) ──────────────────────────────────────────
DEFAULTS = {
    "stage1_conf": 0.30,
    "stage2_conf": 0.30,
    "padding": 0.30,
    "imgsz_stage1": 960,
    "imgsz_stage2": 224,
    "helmet_conf_multiplier": 1.00,
    "vest_conf_multiplier": 0.75,
    "turned_conf_multiplier": 0.75,
    "min_crop_height": 60,
    "min_crop_width": 40,
    "helmet_region_bottom_max_normal": 0.55,
    "helmet_region_bottom_max_crouching": 0.72,
    "vest_region_center_min": 0.25,
    "vest_region_center_max": 0.90,
    "head_cutoff_px": 5,
    "legs_only_bottom_px": 10,
    "legs_only_max_height": 100,
    "crouching_aspect_ratio": 0.70,
    "turned_aspect_ratio": 0.28,
    "overlap_iou_thresh": 0.60,
    "blur_laplacian_thresh": 40.0,
    "confirm_frames": 5,
    "violation_frames": 8,
    "uncertain_frames_to_fallback": 8,
    "lost_frames": 30,
    "alert_cooldown_frames": 90,
    "reid_enabled": True,
    "reid_thresh": 0.60,
    "reid_ema_frames": 5,
    "reid_ema_alpha": 0.6,
    "reid_assign_thresh": 0.86,
    "reid_match_thresh": 0.72,
    "reid_min_pending_frames": 8,
    "reid_quality_min": 0.65,
    "reid_identity_top_k": 5,
    "reid_min_trusted_embeddings": 2,
    "reid_max_gallery_size": 500,
    "reid_persist_state_max_age_s": 300,
    "incident_dedup_seconds": 30,
    # ── Workforce Analytics thresholds ────────────────────────────────────────
    "workforce_movement_thresh":        8.0,   # px: movement_score above = ACTIVE
    "workforce_idle_time_seconds":      30,    # seconds of low movement → IDLE
    "workforce_lost_frames":            20,    # frames not seen → EXITED (~0.67s at 30fps)
    "workforce_confirm_frames":         8,     # frames before ENTERING → confirmed
    "workforce_understaffed_threshold": 2,     # workers below = UNDERSTAFFED
    "workforce_overloaded_threshold":   15,    # workers above = OVERLOADED
    "workforce_snapshot_interval_secs": 60,    # seconds between DB snapshots
    "workforce_alert_cooldown_secs":    600,   # seconds between same-type alerts
    "workforce_reconcile_distance_px":  120,   # px: reconcile brief exits within this radius
    "workforce_reconcile_window_secs":  6,     # seconds: reconcile window
    # ── Equipment Analytics thresholds ───────────────────────────────────────
    "equipment_stage1_conf":            0.35,
    "equipment_movement_thresh":        3.0,
    "equipment_idle_confirm_secs":      30,
    "equipment_lost_frames":            25,
    "equipment_snapshot_interval_secs": 60,
    "equipment_alert_cooldown_secs":    600,
    "equipment_groundingdino_prompt":   "excavator, wheel loader, front loader, loader, bulldozer, dump truck, crane, forklift, compactor, heavy construction equipment",
    # ── PPE pose / sensor edge-case guards ───────────────────────────────────
    "uncertain_conf_floor":             0.12,  # if best raw helmet conf >= this but below threshold in challenging pose → uncertain
    "extreme_crouch_aspect_ratio":      1.00,  # aspect > this = extreme crouch; extends helmet region to 0.90
    "helmet_region_bottom_max_extreme_crouch": 0.90,
    "arms_raised_aspect_ratio":         0.40,  # aspect < this AND ph > H*0.65 → arms-raised; extends helmet region to 0.70
    "arms_raised_height_ratio":         0.65,  # person bbox height as fraction of frame height
    "helmet_region_bottom_max_arms_raised": 0.70,
    "side_cutoff_px":                   20,    # person bbox within this many px of left/right edge → skip (head likely clipped)
    "crop_blur_thresh":                 25.0,  # Laplacian variance below this → blurry crop → skip
    "overlap_grace_frames":             10,    # frames to hold last known state before dropping to uncertain on overlap
}


def _sf(val: Any, default: float) -> float:
    """Safe float coercion — returns default if val is None, non-numeric, or wrong type."""
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _si(val: Any, default: int) -> int:
    """Safe int coercion — returns default if val is None, non-numeric, or wrong type."""
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def _sb(val: Any, default: bool) -> bool:
    """Safe bool coercion — returns default if val is None."""
    if val is None:
        return default
    return bool(val)


def _is_cache_valid() -> bool:
    """Check if cache exists and is fresh (within TTL)."""
    global _cache, _cache_time
    if _cache is None or _cache_time is None:
        return False
    elapsed = (datetime.utcnow() - _cache_time).total_seconds()
    return elapsed < _cache_ttl_seconds


def load_config(db_session: Any) -> Dict[str, Any]:
    """
    Load ML config from DB with caching.
    Falls back to hardcoded defaults if DB fails.
    Thread-safe, returns dict with all config keys.
    """
    global _cache, _cache_time

    with _cache_lock:
        # Return cached config if fresh
        if _is_cache_valid():
            logger.debug("ML config: cache hit")
            return _cache.copy()

    # Try to load from DB
    try:
        from ..models.ml_config import MLConfig
        config = db_session.query(MLConfig).filter(MLConfig.id == 1).first()
        if config:
            D = DEFAULTS  # shorthand for fallback values
            config_dict = {
                "stage1_conf":                      _sf(config.stage1_conf,                      D["stage1_conf"]),
                "stage2_conf":                      _sf(config.stage2_conf,                      D["stage2_conf"]),
                "padding":                          _sf(config.padding,                          D["padding"]),
                "imgsz_stage1":                     _si(config.imgsz_stage1,                     D["imgsz_stage1"]),
                "imgsz_stage2":                     _si(config.imgsz_stage2,                     D["imgsz_stage2"]),
                "helmet_conf_multiplier":           _sf(config.helmet_conf_multiplier,           D["helmet_conf_multiplier"]),
                "vest_conf_multiplier":             _sf(config.vest_conf_multiplier,             D["vest_conf_multiplier"]),
                "turned_conf_multiplier":           _sf(config.turned_conf_multiplier,           D["turned_conf_multiplier"]),
                "min_crop_height":                  _si(config.min_crop_height,                  D["min_crop_height"]),
                "min_crop_width":                   _si(config.min_crop_width,                   D["min_crop_width"]),
                "helmet_region_bottom_max_normal":  _sf(config.helmet_region_bottom_max_normal,  D["helmet_region_bottom_max_normal"]),
                "helmet_region_bottom_max_crouching": _sf(config.helmet_region_bottom_max_crouching, D["helmet_region_bottom_max_crouching"]),
                "vest_region_center_min":           _sf(config.vest_region_center_min,           D["vest_region_center_min"]),
                "vest_region_center_max":           _sf(config.vest_region_center_max,           D["vest_region_center_max"]),
                "head_cutoff_px":                   _si(config.head_cutoff_px,                   D["head_cutoff_px"]),
                "legs_only_bottom_px":              _si(config.legs_only_bottom_px,              D["legs_only_bottom_px"]),
                "legs_only_max_height":             _si(config.legs_only_max_height,             D["legs_only_max_height"]),
                "crouching_aspect_ratio":           _sf(config.crouching_aspect_ratio,           D["crouching_aspect_ratio"]),
                "turned_aspect_ratio":              _sf(config.turned_aspect_ratio,              D["turned_aspect_ratio"]),
                "overlap_iou_thresh":               _sf(config.overlap_iou_thresh,               D["overlap_iou_thresh"]),
                "blur_laplacian_thresh":            _sf(config.blur_laplacian_thresh,            D["blur_laplacian_thresh"]),
                "confirm_frames":                   _si(config.confirm_frames,                   D["confirm_frames"]),
                "violation_frames":                 _si(config.violation_frames,                 D["violation_frames"]),
                "uncertain_frames_to_fallback":     _si(config.uncertain_frames_to_fallback,     D["uncertain_frames_to_fallback"]),
                "lost_frames":                      _si(config.lost_frames,                      D["lost_frames"]),
                "alert_cooldown_frames":            _si(config.alert_cooldown_frames,            D["alert_cooldown_frames"]),
                "reid_enabled":                     _sb(config.reid_enabled,                     D["reid_enabled"]),
                "reid_thresh":                      _sf(config.reid_thresh,                      D["reid_thresh"]),
                "reid_ema_frames":                  _si(config.reid_ema_frames,                  D["reid_ema_frames"]),
                "reid_ema_alpha":                   _sf(config.reid_ema_alpha,                   D["reid_ema_alpha"]),
                "reid_assign_thresh":               _sf(getattr(config, "reid_assign_thresh",               None), D["reid_assign_thresh"]),
                "reid_match_thresh":                _sf(getattr(config, "reid_match_thresh",                None), D["reid_match_thresh"]),
                "reid_min_pending_frames":          _si(getattr(config, "reid_min_pending_frames",          None), D["reid_min_pending_frames"]),
                "reid_quality_min":                 _sf(getattr(config, "reid_quality_min",                 None), D["reid_quality_min"]),
                "reid_identity_top_k":              _si(getattr(config, "reid_identity_top_k",              None), D["reid_identity_top_k"]),
                "reid_min_trusted_embeddings":      _si(getattr(config, "reid_min_trusted_embeddings",      None), D["reid_min_trusted_embeddings"]),
                "reid_max_gallery_size":            _si(getattr(config, "reid_max_gallery_size",            None), D["reid_max_gallery_size"]),
                "reid_persist_state_max_age_s":     _sf(getattr(config, "reid_persist_state_max_age_s",     None), D["reid_persist_state_max_age_s"]),
                "incident_dedup_seconds":           _si(getattr(config, "incident_dedup_seconds",           None), D["incident_dedup_seconds"]),
                # Workforce thresholds
                "workforce_movement_thresh":        _sf(getattr(config, "workforce_movement_thresh",        None), D["workforce_movement_thresh"]),
                "workforce_idle_time_seconds":      _si(getattr(config, "workforce_idle_time_seconds",      None), D["workforce_idle_time_seconds"]),
                "workforce_lost_frames":            _si(getattr(config, "workforce_lost_frames",            None), D["workforce_lost_frames"]),
                "workforce_confirm_frames":         _si(getattr(config, "workforce_confirm_frames",         None), D["workforce_confirm_frames"]),
                "workforce_understaffed_threshold": _si(getattr(config, "workforce_understaffed_threshold", None), D["workforce_understaffed_threshold"]),
                "workforce_overloaded_threshold":   _si(getattr(config, "workforce_overloaded_threshold",   None), D["workforce_overloaded_threshold"]),
                "workforce_snapshot_interval_secs": _si(getattr(config, "workforce_snapshot_interval_secs", None), D["workforce_snapshot_interval_secs"]),
                "workforce_alert_cooldown_secs":    _si(getattr(config, "workforce_alert_cooldown_secs",    None), D["workforce_alert_cooldown_secs"]),
                "workforce_reconcile_distance_px":  _sf(getattr(config, "workforce_reconcile_distance_px",  None), D["workforce_reconcile_distance_px"]),
                "workforce_reconcile_window_secs":  _sf(getattr(config, "workforce_reconcile_window_secs",  None), D["workforce_reconcile_window_secs"]),
                # Equipment Analytics
                "equipment_stage1_conf":            _sf(getattr(config, "equipment_stage1_conf",            None), D["equipment_stage1_conf"]),
                "equipment_movement_thresh":        _sf(getattr(config, "equipment_movement_thresh",        None), D["equipment_movement_thresh"]),
                "equipment_idle_confirm_secs":      _si(getattr(config, "equipment_idle_confirm_secs",      None), D["equipment_idle_confirm_secs"]),
                "equipment_lost_frames":            _si(getattr(config, "equipment_lost_frames",            None), D["equipment_lost_frames"]),
                "equipment_snapshot_interval_secs": _si(getattr(config, "equipment_snapshot_interval_secs", None), D["equipment_snapshot_interval_secs"]),
                "equipment_alert_cooldown_secs":    _si(getattr(config, "equipment_alert_cooldown_secs",    None), D["equipment_alert_cooldown_secs"]),
                "equipment_groundingdino_prompt":   getattr(config, "equipment_groundingdino_prompt", None) or D["equipment_groundingdino_prompt"],
            }

            with _cache_lock:
                _cache = config_dict.copy()
                _cache_time = datetime.utcnow()

            logger.debug("ML config: loaded from DB")
            return config_dict
    except Exception as e:
        logger.warning(f"ML config: DB load failed ({type(e).__name__}: {e}), using defaults")

    # Fallback to hardcoded defaults
    with _cache_lock:
        _cache = DEFAULTS.copy()
        _cache_time = datetime.utcnow()

    logger.info("ML config: using hardcoded defaults")
    return DEFAULTS.copy()


def invalidate_cache() -> None:
    """Invalidate cache (called after config update via API)."""
    global _cache, _cache_time
    with _cache_lock:
        _cache = None
        _cache_time = None
    logger.debug("ML config cache invalidated")
