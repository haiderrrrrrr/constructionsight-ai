"""
Branch Manager — per-camera feature branch registry.

Controls which feature branches (PPE, Workforce, Activity, Equipment) are
running for each camera. Thread-safe. One branch instance per camera per
feature type.

Usage:
    from app.services import branch_manager

    # Start PPE for camera 5
    branch_manager.enable_feature(camera_id=5, feature_name="ppe", db=db)

    # Stop PPE for camera 5
    branch_manager.disable_feature(camera_id=5, feature_name="ppe")

    # Stop everything (camera removed from project)
    branch_manager.stop_all_for_camera(camera_id=5)
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Registry: camera_id → { feature_name → branch_instance } ────────────────
_branches: dict[int, dict[str, Any]] = {}
_cameras_lock: dict[int, threading.Lock] = {}
_global_lock = threading.Lock()

FEATURE_NAMES = ("ppe", "workforce", "activity", "equipment")


def _get_camera_lock(camera_id: int) -> threading.Lock:
    with _global_lock:
        if camera_id not in _cameras_lock:
            _cameras_lock[camera_id] = threading.Lock()
        return _cameras_lock[camera_id]


def _get_branch_class(feature_name: str):
    """Lazy import to avoid circular imports at module load time."""
    if feature_name == "ppe":
        from .feature_branches.ppe_branch import PPEBranch
        return PPEBranch
    if feature_name == "workforce":
        from .feature_branches.workforce_branch import WorkforceBranch
        return WorkforceBranch
    if feature_name == "activity":
        from .feature_branches.activity_branch import ActivityBranch
        return ActivityBranch
    if feature_name == "equipment":
        from .feature_branches.equipment_branch import EquipmentBranch
        return EquipmentBranch
    raise ValueError(f"Unknown feature: {feature_name}")


def enable_feature(camera_id: int, feature_name: str, db=None) -> bool:
    """
    Start `feature_name` branch for `camera_id`.
    `db` — open SQLAlchemy session required by PPEBranch (credentials / config).
    Returns True on success or if already running.
    """
    lock = _get_camera_lock(camera_id)
    with lock:
        cam_branches = _branches.setdefault(camera_id, {})
        existing = cam_branches.get(feature_name)
        if existing is not None and existing.is_running():
            logger.info(
                f"[BranchManager] Camera {camera_id} '{feature_name}' already running"
            )
            return True

        cls = _get_branch_class(feature_name)
        branch = cls(camera_id)
        ok = branch.start(db=db)
        cam_branches[feature_name] = branch
        if ok:
            logger.info(f"[BranchManager] Camera {camera_id} '{feature_name}' enabled")
        else:
            logger.warning(
                f"[BranchManager] Camera {camera_id} '{feature_name}' failed to start"
            )
        return ok


def disable_feature(camera_id: int, feature_name: str) -> None:
    """Stop `feature_name` branch for `camera_id`."""
    lock = _get_camera_lock(camera_id)
    with lock:
        cam_branches = _branches.get(camera_id, {})
        branch = cam_branches.pop(feature_name, None)
        if branch:
            branch.stop()
            logger.info(f"[BranchManager] Camera {camera_id} '{feature_name}' disabled")


def stop_all_for_camera(camera_id: int) -> None:
    """
    Stop all feature branches for a camera (called on camera unassign / removal).
    """
    lock = _get_camera_lock(camera_id)
    with lock:
        cam_branches = _branches.pop(camera_id, {})
        for feature_name, branch in cam_branches.items():
            try:
                branch.stop()
                logger.info(
                    f"[BranchManager] Camera {camera_id} '{feature_name}' stopped (camera removed)"
                )
            except Exception as e:
                logger.warning(
                    f"[BranchManager] Camera {camera_id} '{feature_name}' stop error: {e}"
                )


def get_running_features(camera_id: int) -> list[str]:
    """Return list of feature names currently running for camera_id."""
    with _get_camera_lock(camera_id):
        cam_branches = _branches.get(camera_id, {})
        return [name for name, b in cam_branches.items() if b.is_running()]


def is_feature_running(camera_id: int, feature_name: str) -> bool:
    with _get_camera_lock(camera_id):
        cam_branches = _branches.get(camera_id, {})
        b = cam_branches.get(feature_name)
        return b is not None and b.is_running()


def get_cameras_with_running_feature(feature_name: str) -> list[int]:
    if feature_name not in FEATURE_NAMES:
        raise ValueError(f"Unknown feature: {feature_name}")

    with _global_lock:
        camera_ids = list(_branches.keys())

    running: list[int] = []
    for camera_id in camera_ids:
        if is_feature_running(camera_id, feature_name):
            running.append(camera_id)
    return running
