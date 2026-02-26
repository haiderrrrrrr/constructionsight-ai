"""
Project Feature Control endpoints.

GET  /projects/{project_id}/cameras/features
     List all cameras in the project with their per-feature toggle states,
     zone name, worker_status, and stream_online flag.

PATCH /projects/{project_id}/cameras/{camera_id}/features
      Toggle one or more features (ppe_enabled, workforce_enabled,
      activity_enabled, equipment_enabled) for a camera.
      Starts / stops the corresponding branch in branch_manager.

Auth: any active project member (or creator).
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_current_user, get_db, build_runtime_status
from ...models.user import User
from ...models.camera import Camera, CameraHealthLog, CameraHealthStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/projects/{project_id}", tags=["features"])


# ── Auth helper (reused from project_ppe) ────────────────────────────────────

def _require_member(project_id: int, user: User, db: Session) -> None:
    from ...models.project_membership import ProjectMembership, MembershipStatus
    from ...models.project import Project

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = (
        db.query(ProjectMembership)
        .filter(
            ProjectMembership.project_id == project_id,
            ProjectMembership.user_id == user.id,
            ProjectMembership.status == MembershipStatus.ACTIVE,
        )
        .first()
    )
    if not membership and project.created_by != user.id:
        raise HTTPException(status_code=403, detail="Access denied")


# ── Schemas ───────────────────────────────────────────────────────────────────

class FeatureTogglePatch(BaseModel):
    ppe_enabled:       Optional[bool] = None
    workforce_enabled: Optional[bool] = None
    activity_enabled:  Optional[bool] = None
    equipment_enabled: Optional[bool] = None


# ── GET /projects/{project_id}/cameras/features ───────────────────────────────

@router.get("/cameras/features")
def list_camera_features(
    project_id: int,
    db: Session = Depends(get_db),
    user: User   = Depends(get_current_user),
):
    """
    Return all cameras assigned to this project with their feature toggle
    states, zone name, worker_status, and stream_online flag.
    """
    _require_member(project_id, user, db)

    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics
    from ...models.camera import Camera
    from ...models.zone import Zone

    pcs = (
        db.query(ProjectCamera)
        .filter(ProjectCamera.project_id == project_id)
        .all()
    )

    result = []
    for pc in pcs:
        camera = db.query(Camera).filter(Camera.id == pc.camera_id).first()
        if not camera:
            continue

        zone_name = None
        if pc.zone_id:
            zone = db.query(Zone).filter(Zone.id == pc.zone_id).first()
            zone_name = zone.name if zone else None

        analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )

        # Determine stream_online from latest health status
        # Use the same health status values shown in admin panel
        latest_health = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == camera.id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        # Online = healthy or degraded (stream reachable)
        # Offline = offline or maintenance (stream unreachable or not configured)
        health_status = latest_health.health_status if latest_health else None
        stream_online = health_status in (CameraHealthStatus.healthy, CameraHealthStatus.degraded)

        result.append({
            "camera_id":        camera.id,
            "camera_name":      camera.name,
            "zone_name":        zone_name,
            "worker_status":    camera.worker_status or "idle",
            "runtime_status":   camera.runtime_status or build_runtime_status(camera, analytics),
            "stream_online":    stream_online,
            "latest_health_status": health_status.value if health_status else "no_data",
            "registry_status":  camera.registry_status.value if camera.registry_status else "draft",
            "verified_at":      camera.verified_at.isoformat() if camera.verified_at else None,
            "features": {
                "ppe_enabled":       analytics.ppe_enabled       if analytics else False,
                "workforce_enabled": analytics.workforce_enabled if analytics else False,
                "activity_enabled":  analytics.activity_enabled  if analytics else False,
                "equipment_enabled": analytics.equipment_enabled if analytics else False,
            },
            "_ppe_enabled_at":       analytics.ppe_enabled_at.isoformat()       if analytics and analytics.ppe_enabled       and analytics.ppe_enabled_at       else None,
            "_workforce_enabled_at": analytics.workforce_enabled_at.isoformat() if analytics and analytics.workforce_enabled and analytics.workforce_enabled_at else None,
            "_activity_enabled_at":  (
                (camera.runtime_status or {}).get("feature_statuses", {}).get("activity", {}).get("enabled_at")
                if (
                    analytics
                    and analytics.activity_enabled
                    and (camera.runtime_status or {}).get("feature_statuses", {}).get("activity", {}).get("enabled_at")
                )
                else None
            ),
            "_equipment_enabled_at": (
                (camera.runtime_status or {}).get("feature_statuses", {}).get("equipment", {}).get("enabled_at")
                if (
                    analytics
                    and analytics.equipment_enabled
                    and (camera.runtime_status or {}).get("feature_statuses", {}).get("equipment", {}).get("enabled_at")
                )
                else None
            ),
        })

    try:
        from .dev_video_test import get_dev_equipment_feature
        dev_equipment = get_dev_equipment_feature(project_id)
        if dev_equipment is not None:
            result.append(dev_equipment)
    except Exception:
        pass

    # Compute the earliest activation time per feature across all cameras with that feature enabled.
    # This is the server-authoritative live session start — all users see the same window.
    ppe_starts = [
        c.get("_ppe_enabled_at") for c in result
        if c.get("_ppe_enabled_at") is not None
    ]
    workforce_starts = [
        c.get("_workforce_enabled_at") for c in result
        if c.get("_workforce_enabled_at") is not None
    ]
    activity_starts = [
        c.get("_activity_enabled_at") for c in result
        if c.get("_activity_enabled_at") is not None
    ]
    equipment_starts = [
        c.get("_equipment_enabled_at") for c in result
        if c.get("_equipment_enabled_at") is not None
    ]
    live_session_start           = min(ppe_starts)       if ppe_starts       else None
    workforce_live_session_start = min(workforce_starts) if workforce_starts else None
    activity_live_session_start  = min(activity_starts)  if activity_starts  else None
    equipment_live_session_start = min(equipment_starts) if equipment_starts else None

    # Clean up internal fields before returning
    for c in result:
        c.pop("_ppe_enabled_at",       None)
        c.pop("_workforce_enabled_at", None)
        c.pop("_activity_enabled_at",  None)
        c.pop("_equipment_enabled_at", None)

    return {
        "cameras":                      result,
        "live_session_start":           live_session_start,
        "workforce_live_session_start": workforce_live_session_start,
        "activity_live_session_start":  activity_live_session_start,
        "equipment_live_session_start": equipment_live_session_start,
    }


# ── PATCH /projects/{project_id}/cameras/{camera_id}/features ─────────────────

@router.patch("/cameras/{camera_id}/features")
def toggle_camera_features(
    project_id: int,
    camera_id:  int,
    body:       FeatureTogglePatch,
    db:         Session = Depends(get_db),
    user:       User    = Depends(get_current_user),
):
    """
    Toggle feature branches for a camera.
    Returns the updated feature states.
    """
    _require_member(project_id, user, db)

    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics
    from ...models.project import Project, ProjectStatus
    from ...services import branch_manager

    # Verify camera is in this project
    pc = (
        db.query(ProjectCamera)
        .filter(
            ProjectCamera.project_id == project_id,
            ProjectCamera.camera_id  == camera_id,
        )
        .first()
    )
    if not pc:
        raise HTTPException(status_code=404, detail="Camera not assigned to this project")

    # Project must be active
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project or project.status != ProjectStatus.ACTIVE:
        raise HTTPException(
            status_code=400,
            detail="Feature toggles are only available for active projects"
        )

    # Get camera object (needed for worker_status update)
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Check if any feature is being enabled
    enabling_feature = any([body.ppe_enabled, body.workforce_enabled, body.activity_enabled, body.equipment_enabled])

    if enabling_feature:
        # Camera must be assigned to a zone
        if not pc.zone_id:
            raise HTTPException(
                status_code=400,
                detail="Camera must be assigned to a zone before enabling features. Assign zone in Cameras tab."
            )

        from ...models.camera import RegistryStatus
        if camera.registry_status != RegistryStatus.verified:
            raise HTTPException(
                status_code=400,
                detail=f"Camera must be verified before enabling features (current: {camera.registry_status.value})"
            )

        # Camera must be healthy or degraded (not offline or maintenance)
        latest_health = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == camera.id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        if not latest_health or latest_health.health_status not in (CameraHealthStatus.healthy, CameraHealthStatus.degraded):
            health_val = latest_health.health_status.value if latest_health else "no_data"
            raise HTTPException(
                status_code=400,
                detail=f"Camera is not reachable — cannot enable features (health: {health_val}). Check RTSP connection and try verify again."
            )

    # Get or create analytics row
    analytics = (
        db.query(ProjectCameraAnalytics)
        .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
        .first()
    )
    if not analytics:
        analytics = ProjectCameraAnalytics(project_camera_id=pc.id)
        db.add(analytics)
        db.flush()

    # Apply toggles and start/stop branches
    feature_map = {
        "ppe":       ("ppe_enabled",       body.ppe_enabled),
        "workforce": ("workforce_enabled",  body.workforce_enabled),
        "activity":  ("activity_enabled",   body.activity_enabled),
        "equipment": ("equipment_enabled",  body.equipment_enabled),
    }

    startup_failures = []
    any_feature_enabled = False
    feature_toggled = set()  # tracks which features had their DB state changed this request
    prev_runtime = camera.runtime_status or {}
    enabled_now_iso = None
    for feature_name, (col_name, new_value) in feature_map.items():
        if new_value is None:
            continue
        if new_value:
            # Enable feature — try startup BEFORE updating DB
            enabled_ok = branch_manager.enable_feature(camera_id, feature_name, db=db)
            if not enabled_ok:
                startup_failures.append(feature_name)
                logger.warning(
                    f"Feature {feature_name} startup failed for camera {camera_id}, keeping DB disabled"
                )
                continue  # Skip DB update if startup failed
            # Only update DB if startup succeeded
            was_disabled = not getattr(analytics, col_name, False)
            setattr(analytics, col_name, new_value)
            any_feature_enabled = True
            if was_disabled:
                feature_toggled.add(feature_name)
                if enabled_now_iso is None:
                    from datetime import datetime, timezone
                    enabled_now_iso = datetime.now(timezone.utc).isoformat()
                # Stamp <feature>_enabled_at when feature transitions off → on (server-authoritative live start)
                if feature_name == "ppe":
                    from datetime import datetime, timezone
                    analytics.ppe_enabled_at = datetime.now(timezone.utc)
                elif feature_name == "workforce":
                    from datetime import datetime, timezone
                    analytics.workforce_enabled_at = datetime.now(timezone.utc)
        else:
            # Disable feature
            was_enabled = bool(getattr(analytics, col_name, False))
            branch_manager.disable_feature(camera_id, feature_name)
            setattr(analytics, col_name, new_value)
            if was_enabled:
                feature_toggled.add(feature_name)
            # Clear <feature>_enabled_at when feature is disabled so it resets for the next session
            if feature_name == "ppe":
                analytics.ppe_enabled_at = None
            elif feature_name == "workforce":
                analytics.workforce_enabled_at = None

    # Update worker_status: set to idle only if NO features are enabled
    # Check all features to see if any are still enabled
    any_enabled = any([
        analytics.ppe_enabled,
        analytics.workforce_enabled,
        analytics.activity_enabled,
        analytics.equipment_enabled,
    ])
    if not any_enabled:
        camera.worker_status = "idle"
    else:
        camera.worker_status = "running"

    # Build and store structured runtime status (Fix 3)
    rt = build_runtime_status(camera, analytics) or {}
    rt_features = rt.get("feature_statuses") or {}
    prev_features = (prev_runtime or {}).get("feature_statuses") or {}

    if analytics.ppe_enabled and analytics.ppe_enabled_at and rt_features.get("ppe", {}).get("status") == "running":
        rt_features["ppe"] = { **rt_features.get("ppe", {}), "enabled_at": analytics.ppe_enabled_at.isoformat() }
    else:
        if "ppe" in rt_features:
            rt_features["ppe"].pop("enabled_at", None)

    if analytics.workforce_enabled and analytics.workforce_enabled_at and rt_features.get("workforce", {}).get("status") == "running":
        rt_features["workforce"] = { **rt_features.get("workforce", {}), "enabled_at": analytics.workforce_enabled_at.isoformat() }
    else:
        if "workforce" in rt_features:
            rt_features["workforce"].pop("enabled_at", None)

    if analytics.activity_enabled and rt_features.get("activity", {}).get("status") == "running":
        prev_at = (prev_features.get("activity") or {}).get("enabled_at")
        at = enabled_now_iso if "activity" in feature_toggled else prev_at
        rt_features["activity"] = { **rt_features.get("activity", {}), "enabled_at": at or prev_at or enabled_now_iso }
    else:
        if "activity" in rt_features:
            rt_features["activity"].pop("enabled_at", None)

    if analytics.equipment_enabled and rt_features.get("equipment", {}).get("status") == "running":
        prev_at = (prev_features.get("equipment") or {}).get("enabled_at")
        at = enabled_now_iso if "equipment" in feature_toggled else prev_at
        rt_features["equipment"] = { **rt_features.get("equipment", {}), "enabled_at": at or prev_at or enabled_now_iso }
    else:
        if "equipment" in rt_features:
            rt_features["equipment"].pop("enabled_at", None)

    rt["feature_statuses"] = rt_features
    camera.runtime_status = rt

    db.commit()
    db.refresh(analytics)
    db.refresh(camera)

    # Immediately trigger the stream server to reconcile feature branches so
    # streams start without waiting for the 2-second reconcile loop tick.
    try:
        import threading as _threading
        import urllib.request as _ur
        def _ping():
            try:
                _ur.urlopen("http://127.0.0.1:8001/internal/sync-features", data=b"", timeout=2)
            except Exception:
                pass
        _threading.Thread(target=_ping, daemon=True).start()
    except Exception:
        pass

    # Notify all connected SSE clients (any tab, any device) that PPE feature state changed.
    # Carry the full canonical state so other-account windows (which have no local
    # broadcast / cache) can render correctly from the SSE alone — no polling required.
    try:
        from ...services.ppe_dashboard_broker import push as broker_push
        all_pcs = (
            db.query(ProjectCamera)
            .filter(ProjectCamera.project_id == project_id)
            .all()
        )
        per_cam = []
        ppe_starts = []
        for other_pc in all_pcs:
            other_a = (
                db.query(ProjectCameraAnalytics)
                .filter(ProjectCameraAnalytics.project_camera_id == other_pc.id)
                .first()
            )
            cam_ppe = bool(other_a.ppe_enabled) if other_a else False
            per_cam.append({"camera_id": other_pc.camera_id, "ppe_enabled": cam_ppe})
            if cam_ppe and other_a and other_a.ppe_enabled_at:
                ppe_starts.append(other_a.ppe_enabled_at.isoformat())
        any_camera_active = any(c["ppe_enabled"] for c in per_cam)
        broker_push(project_id, {
            "type":               "ppe_feature_changed",
            "camera_id":          camera_id,
            "ppe_enabled":        analytics.ppe_enabled,
            "any_camera_active":  any_camera_active,
            "cameras":            per_cam,
            "live_session_start": min(ppe_starts) if ppe_starts else None,
        })
    except Exception:
        pass  # non-critical — dashboard will fall back to 30s poll

    # Notify all connected SSE clients that Workforce feature state changed.
    # Mirrors the PPE broadcast above. Carries the full canonical state so other-account
    # windows (which have no local broadcast / cache) can render correctly from the SSE alone.
    if "workforce" in feature_toggled:
        try:
            from ...services.workforce_dashboard_broker import push as wf_broker_push
            all_pcs = (
                db.query(ProjectCamera)
                .filter(ProjectCamera.project_id == project_id)
                .all()
            )
            wf_per_cam   = []
            wf_starts    = []
            for other_pc in all_pcs:
                other_a = (
                    db.query(ProjectCameraAnalytics)
                    .filter(ProjectCameraAnalytics.project_camera_id == other_pc.id)
                    .first()
                )
                cam_wf = bool(other_a.workforce_enabled) if other_a else False
                wf_per_cam.append({"camera_id": other_pc.camera_id, "workforce_enabled": cam_wf})
                if cam_wf and other_a and other_a.workforce_enabled_at:
                    wf_starts.append(other_a.workforce_enabled_at.isoformat())
            wf_any_active = any(c["workforce_enabled"] for c in wf_per_cam)
            wf_broker_push(project_id, {
                "type":               "workforce_feature_changed",
                "camera_id":          camera_id,
                "workforce_enabled":  analytics.workforce_enabled,
                "any_camera_active":  wf_any_active,
                "cameras":            wf_per_cam,
                "live_session_start": min(wf_starts) if wf_starts else None,
            })
        except Exception:
            pass  # non-critical — dashboard will fall back to safety-net poll

    # Notify SSE clients of Activity feature state change.
    if "activity" in feature_toggled:
        try:
            from ...services.activity_dashboard_broker import push as act_broker_push
            all_pcs = (
                db.query(ProjectCamera)
                .filter(ProjectCamera.project_id == project_id)
                .all()
            )
            act_per_cam = []
            act_starts = []
            for other_pc in all_pcs:
                other_a = (
                    db.query(ProjectCameraAnalytics)
                    .filter(ProjectCameraAnalytics.project_camera_id == other_pc.id)
                    .first()
                )
                cam_act = bool(other_a.activity_enabled) if other_a else False
                act_per_cam.append({"camera_id": other_pc.camera_id, "activity_enabled": cam_act})
                if cam_act:
                    other_cam = db.query(Camera).filter(Camera.id == other_pc.camera_id).first()
                    rt = (other_cam.runtime_status or {}) if other_cam else {}
                    at = (rt.get("feature_statuses") or {}).get("activity", {}).get("enabled_at")
                    if at:
                        act_starts.append(at)
            act_any_active = any(c["activity_enabled"] for c in act_per_cam)
            act_broker_push(project_id, {
                "type":              "activity_feature_changed",
                "camera_id":         camera_id,
                "activity_enabled":  analytics.activity_enabled,
                "any_camera_active": act_any_active,
                "cameras":           act_per_cam,
                "live_session_start": min(act_starts) if act_starts else None,
            })
        except Exception:
            pass

    # Notify SSE clients of Equipment feature state change via equipment_dashboard_broker.
    # Mirrors the Workforce broadcast above — carries full canonical camera list so
    # other-account windows can render correctly from the SSE alone.
    if "equipment" in feature_toggled:
        try:
            from ...services.equipment_dashboard_broker import push as eq_broker_push
            all_pcs = (
                db.query(ProjectCamera)
                .filter(ProjectCamera.project_id == project_id)
                .all()
            )
            eq_per_cam = []
            for other_pc in all_pcs:
                other_a = (
                    db.query(ProjectCameraAnalytics)
                    .filter(ProjectCameraAnalytics.project_camera_id == other_pc.id)
                    .first()
                )
                cam_eq = bool(other_a.equipment_enabled) if other_a else False
                eq_per_cam.append({"camera_id": other_pc.camera_id, "equipment_enabled": cam_eq})
            eq_any_active = any(c["equipment_enabled"] for c in eq_per_cam)
            eq_broker_push(project_id, {
                "type":              "equipment_feature_changed",
                "camera_id":         camera_id,
                "equipment_enabled": analytics.equipment_enabled,
                "any_camera_active": eq_any_active,
                "cameras":           eq_per_cam,
            })
        except Exception:
            pass

    # Fetch fresh health status to sync frontend (race condition fix)
    latest_health = (
        db.query(CameraHealthLog)
        .filter(CameraHealthLog.camera_id == camera_id)
        .order_by(CameraHealthLog.checked_at.desc())
        .first()
    )

    response = {
        "camera_id":  camera_id,
        "project_id": project_id,
        "latest_health_status": latest_health.health_status.value if latest_health else "no_data",
        "worker_status": camera.worker_status,  # Return updated worker_status so frontend syncs immediately
        "runtime_status": camera.runtime_status,  # New: structured status (Fix 3)
        "features": {
            "ppe_enabled":       analytics.ppe_enabled,
            "workforce_enabled": analytics.workforce_enabled,
            "activity_enabled":  analytics.activity_enabled,
            "equipment_enabled": analytics.equipment_enabled,
        },
    }

    # Warn frontend if any features failed to start
    if startup_failures:
        response["startup_warnings"] = {
            "failed_features": startup_failures,
            "message": f"Feature(s) {', '.join(startup_failures)} failed to start (kept disabled). Check camera health and verify RTSP connection."
        }

    return response
