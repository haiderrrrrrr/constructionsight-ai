"""
Dev-only video test pipeline.
Upload a video file → runs through PPE + equipment inference → MJPEG stream with overlays.
No DB camera record needed. Virtual camera_id = 9999.
"""
from __future__ import annotations

import os
import tempfile
import threading
import time
import logging
import concurrent.futures
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import cv2
import numpy as np
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..deps import get_db, get_current_user
from ...models.user import User
from ...services.ml_config_service import load_config, DEFAULTS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/dev", tags=["dev-video-test"])

_DEV_CAMERA_ID = 9999
_TEST_VIDEO_DIR = Path(tempfile.gettempdir()) / "constructionsight_dev_uploads"

# ── Shared annotated frame holder (written by pipeline, read by stream) ──────
_dev_annotated: dict = {"frame": None, "seq": 0, "lock": threading.Lock()}

# ── Pipeline state ────────────────────────────────────────────────────────────
_dev_state: dict = {
    "running": False,
    "stop": threading.Event(),
    "project_id": None,
    "zone_name": "Test Zone",
    "ppe_enabled": True,
    "equipment_enabled": False,
    "equipment_enabled_at": None,
    "frame_count": 0,
    "video_path": None,
}
_dev_lock = threading.Lock()


class DevFeaturePatch(BaseModel):
    ppe_enabled: Optional[bool] = None
    equipment_enabled: Optional[bool] = None


def _push_equipment_feature(project_id: Optional[int], enabled: bool) -> None:
    if not project_id:
        return
    try:
        from ...services.equipment_dashboard_broker import push
        push(project_id, {
            "type": "equipment_feature_changed",
            "camera_id": _DEV_CAMERA_ID,
            "equipment_enabled": enabled,
            "any_camera_active": enabled,
            "live_session_start": datetime.now(timezone.utc).isoformat() if enabled else None,
            "cameras": [{
                "camera_id": _DEV_CAMERA_ID,
                "equipment_enabled": enabled,
            }],
        })
    except Exception:
        pass


def get_dev_equipment_feature(project_id: int) -> Optional[dict]:
    with _dev_lock:
        if not _dev_state["running"]:
            return None
        if _dev_state["project_id"] != project_id:
            return None
        if not _dev_state["equipment_enabled"]:
            return None
        return {
            "camera_id": _DEV_CAMERA_ID,
            "camera_name": "Uploaded Video",
            "zone_name": _dev_state["zone_name"],
            "worker_status": "running",
            "runtime_status": {"status": "running"},
            "stream_online": True,
            "latest_health_status": "healthy",
            "registry_status": "verified",
            "verified_at": None,
            "features": {
                "ppe_enabled": bool(_dev_state["ppe_enabled"]),
                "workforce_enabled": False,
                "activity_enabled": False,
                "equipment_enabled": True,
            },
            "_ppe_enabled_at": None,
            "_workforce_enabled_at": None,
            "_activity_enabled_at": None,
            "_equipment_enabled_at": _dev_state["equipment_enabled_at"] or datetime.now(timezone.utc).isoformat(),
        }


# ── Pipeline ──────────────────────────────────────────────────────────────────

def _run_dev_pipeline(
    video_path: str,
    project_id: int,
    zone_name: str,
    ppe_enabled: bool,
    equipment_enabled: bool,
    cfg: dict,
    stop: threading.Event,
):
    logger.info(f"[dev_pipeline] starting — video={video_path} ppe={ppe_enabled} eq={equipment_enabled}")

    # Write a placeholder frame IMMEDIATELY so the MJPEG stream has something
    # to show while models/imports/video-open are still being set up. Without
    # this, the stream sits empty for seconds and the browser fires onerror.
    try:
        _ph = np.zeros((540, 960, 3), dtype=np.uint8)
        cv2.putText(_ph, "Pipeline starting...", (240, 280),
                    cv2.FONT_HERSHEY_SIMPLEX, 1.0, (200, 200, 200), 2, cv2.LINE_AA)
        with _dev_annotated["lock"]:
            _dev_annotated["frame"] = _ph
            _dev_annotated["seq"] = 1
    except Exception:
        pass

    _stage1 = _stage2 = None
    _gdino_model = None
    _gdino_available = False
    _post_equipment_detections = None
    _get_or_create_bytetracker = None
    _parse_ppe_result = None
    draw_person = None
    PersonTrack = None
    _ppe_blend_rect = _ppe_rounded_rect = None
    DEVICE = "cpu"
    USE_HALF = False
    _run_groundingdino = None
    _load_groundingdino = None
    _gdino_load_attempted = False
    try:
        import sys
        _mse = sys.modules.get("app.api.routes.ml_stream_enterprise") or \
               sys.modules.get("backend.app.api.routes.ml_stream_enterprise")
        if _mse is None:
            from . import ml_stream_enterprise as _mse
        _stage1 = getattr(_mse, "_stage1", None)
        _stage2 = getattr(_mse, "_stage2", None)
        _gdino_model = getattr(_mse, "_gdino_model", None)
        _gdino_available = getattr(_mse, "_gdino_available", False)
        _post_equipment_detections = getattr(_mse, "_post_equipment_detections", None)
        _get_or_create_bytetracker = getattr(_mse, "_get_or_create_bytetracker", None)
        _parse_ppe_result = getattr(_mse, "_parse_ppe_result", None)
        draw_person = getattr(_mse, "draw_person", None)
        PersonTrack = getattr(_mse, "PersonTrack", None)
        _ppe_blend_rect = getattr(_mse, "_ppe_blend_rect", None)
        _ppe_rounded_rect = getattr(_mse, "_ppe_rounded_rect", None)
        DEVICE = getattr(_mse, "DEVICE", "cpu")
        USE_HALF = getattr(_mse, "USE_HALF", False)
        _run_groundingdino = getattr(_mse, "_run_groundingdino", None)
        _load_groundingdino = getattr(_mse, "_load_groundingdino", None)
        if equipment_enabled and _load_groundingdino is not None:
            _gdino_load_attempted = True
            logger.info("[dev_pipeline] attempting YOLO-World load via _load_groundingdino()...")
            try:
                _gdino_available = bool(_load_groundingdino())
                _gdino_model = getattr(_mse, "_gdino_model", None)
                logger.info(f"[dev_pipeline] _load_groundingdino result: available={_gdino_available} model_loaded={_gdino_model is not None}")
            except Exception as _ld_err:
                logger.error(f"[dev_pipeline] _load_groundingdino RAISED: {_ld_err}", exc_info=True)
                _gdino_available = False
                _gdino_model = None
        logger.info(f"[dev_pipeline] models — stage1={_stage1 is not None} stage2={_stage2 is not None} gdino={_gdino_available}")
    except Exception as _ie:
        logger.warning(f"[dev_pipeline] model import failed ({_ie}) — streaming raw video only", exc_info=True)
        # Do NOT return — continue with all models as None, raw video still streams

    EquipmentProcessor = None
    register_processor = unregister_processor = get_processor = None
    try:
        from ...services.equipment_analytics import (
            EquipmentProcessor as _EP, register_processor as _rp,
            get_processor as _gp, unregister_processor as _up,
        )
        EquipmentProcessor = _EP
        register_processor = _rp
        get_processor = _gp
        unregister_processor = _up
    except Exception as _ea_err:
        logger.warning(f"[dev_pipeline] equipment_analytics import failed ({_ea_err}) — DB analytics disabled", exc_info=True)

    # ── Start equipment processor ─────────────────────────────────────────────
    eq_processor = None
    if EquipmentProcessor is not None:
        try:
            existing = get_processor(_DEV_CAMERA_ID) if get_processor else None
            if existing is not None:
                existing.stop()
                if unregister_processor:
                    unregister_processor(_DEV_CAMERA_ID)
        except Exception as _eq_err:
            logger.warning(f"[dev_pipeline] equipment processor start failed ({_eq_err}) — continuing without DB analytics", exc_info=True)
            eq_processor = None

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.error(f"[dev_pipeline] cv2 could not open video: {video_path}")
        return
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frame_delay = 1.0 / fps
    logger.info(f"[dev_pipeline] video opened — fps={fps:.1f} path={video_path}")

    track_registry: dict[int, PersonTrack] = {}
    # Side-dict: last-known box per track_id. Used to re-draw a person's box
    # for a few frames after detection momentarily drops, eliminating flicker
    # on high-FPS uploaded videos (live cameras run at ~5–15 fps so the same
    # miss is invisible there).
    track_last_box: dict = {}
    PERSIST_DRAW_FRAMES = 8
    seq = 0
    frame_count = 0

    # Async equipment inference
    eq_executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="dev-eq")
    pending_eq_future = None
    pending_eq_frame = None
    pending_eq_seq = -1
    last_eq_dets: list = []
    _gdino_warned = False
    _gdino_load_attempted = _gdino_load_attempted or bool(_gdino_model is not None)

    try:
        while not stop.is_set():
            try:
                t0 = time.time()
                ret, frame = cap.read()
                if not ret or frame is None:
                    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue

                seq += 1
                frame_count += 1
                H, W = frame.shape[:2]
                annotated = frame.copy()

                # Re-read feature flags so live toggles take effect without restart
                with _dev_lock:
                    ppe_enabled = _dev_state["ppe_enabled"]
                    equipment_enabled = _dev_state["equipment_enabled"]

                # ── PPE inference ─────────────────────────────────────────────
                if ppe_enabled and _stage1 is not None and _stage2 is not None:
                    try:
                        r1 = _stage1.predict(
                            source=frame,
                            classes=[0],
                            conf=cfg.get("stage1_conf", 0.30),
                            imgsz=cfg.get("imgsz_stage1", 960),
                            device=DEVICE,
                            half=USE_HALF,
                            verbose=False,
                        )
                        bt = _get_or_create_bytetracker(_DEV_CAMERA_ID)
                        tracked = bt.update(r1[0].boxes.cpu(), frame)

                        seen_ids: set = set()
                        if tracked is not None and len(tracked) > 0:
                            for row in tracked:
                                bx1, by1, bx2, by2 = int(row[0]), int(row[1]), int(row[2]), int(row[3])
                                bx1, by1 = max(0, bx1), max(0, by1)
                                bx2, by2 = min(W, bx2), min(H, by2)
                                if bx2 <= bx1 or by2 <= by1:
                                    continue
                                track_id = int(row[4]) if len(row) > 4 else -(seq)
                                seen_ids.add(track_id)

                                if track_id not in track_registry:
                                    track_registry[track_id] = PersonTrack(track_id)
                                track = track_registry[track_id]

                                pad = int(cfg.get("padding", 0.30) * max(bx2 - bx1, by2 - by1))
                                cx1 = max(0, bx1 - pad)
                                cy1 = max(0, by1 - pad)
                                cx2 = min(W, bx2 + pad)
                                cy2 = min(H, by2 + pad)
                                crop = frame[cy1:cy2, cx1:cx2]
                                crop_h = cy2 - cy1

                                has_helmet = False
                                has_vest = False
                                is_uncertain = False

                                if crop.size > 0 and crop_h >= cfg.get("min_crop_height", 60):
                                    r2 = _stage2.predict(
                                        source=crop,
                                        conf=cfg.get("stage2_conf", 0.30),
                                        imgsz=cfg.get("imgsz_stage2", 224),
                                        device=DEVICE,
                                        half=USE_HALF,
                                        verbose=False,
                                    )
                                    boxes2 = r2[0].boxes if r2 and r2[0].boxes is not None else []
                                    meta = {
                                        "crop": crop,
                                        "crop_h": crop_h,
                                        "helmet_conf": cfg.get("stage2_conf", 0.30) * cfg.get("helmet_conf_multiplier", 1.0),
                                        "vest_conf": cfg.get("stage2_conf", 0.30) * cfg.get("vest_conf_multiplier", 0.75),
                                        "helmet_bottom_max": cfg.get("helmet_region_bottom_max_normal", 0.55),
                                        "turned": False,
                                        "extreme_crouch": False,
                                    }
                                    result = _parse_ppe_result(boxes2, meta, cfg)
                                    has_helmet = result["has_helmet"]
                                    has_vest = result["has_vest"]
                                    is_uncertain = result.get("is_uncertain", False)

                                track.update(has_helmet, has_vest, is_uncertain, cfg)
                                track_last_box[track_id] = (bx1, by1, bx2, by2)
                                if draw_person is not None:
                                    draw_person(annotated, bx1, by1, bx2, by2, track, H, W, cfg)

                        lost_limit = cfg.get("lost_frames", 30)
                        for tid in list(track_registry.keys()):
                            if tid not in seen_ids:
                                track_registry[tid].frames_lost = getattr(track_registry[tid], "frames_lost", 0) + 1
                                if track_registry[tid].frames_lost > lost_limit:
                                    del track_registry[tid]
                                    track_last_box.pop(tid, None)
                            else:
                                track_registry[tid].frames_lost = 0

                        # Anti-flicker: re-draw boxes for tracks that were not
                        # detected this frame but were seen within the last
                        # PERSIST_DRAW_FRAMES frames, using their last known box.
                        if draw_person is not None:
                            for tid, tr in track_registry.items():
                                if tid in seen_ids:
                                    continue
                                lost = getattr(tr, "frames_lost", 0)
                                if lost <= 0 or lost > PERSIST_DRAW_FRAMES:
                                    continue
                                box = track_last_box.get(tid)
                                if box is None:
                                    continue
                                draw_person(annotated, box[0], box[1], box[2], box[3], tr, H, W, cfg)

                    except Exception as e:
                        logger.warning(f"[dev_pipeline] PPE error frame {seq}: {e}")

                # ── Equipment inference (async, non-blocking) ─────────────────
                if (
                    equipment_enabled
                    and not _gdino_load_attempted
                    and (not _gdino_available or _gdino_model is None)
                    and _load_groundingdino is not None
                ):
                    _gdino_load_attempted = True
                    _gdino_available = bool(_load_groundingdino())
                    try:
                        import sys
                        _mse = sys.modules.get("app.api.routes.ml_stream_enterprise") or \
                               sys.modules.get("backend.app.api.routes.ml_stream_enterprise")
                        _gdino_model = getattr(_mse, "_gdino_model", None) if _mse is not None else _gdino_model
                    except Exception:
                        pass

                if equipment_enabled and _gdino_available and _gdino_model is not None and _run_groundingdino is not None:
                    if pending_eq_future is not None and pending_eq_future.done():
                        try:
                            new_dets = pending_eq_future.result()
                            if new_dets:
                                last_eq_dets = new_dets
                                logger.info(f"[dev_pipeline] equipment dets={len(new_dets)} frame={pending_eq_seq} labels={[d.get('label') for d in new_dets]}")
                            if eq_processor is not None and _post_equipment_detections is not None:
                                _post_equipment_detections(_DEV_CAMERA_ID, new_dets or [], pending_eq_frame, pending_eq_seq)
                        except Exception as e:
                            logger.debug(f"[dev_pipeline] equipment result error: {e}")
                        pending_eq_future = None

                    if pending_eq_future is None:
                        prompt = cfg.get(
                            "equipment_groundingdino_prompt",
                            "excavator, wheel loader, front loader, loader, bulldozer, dump truck, crane, forklift, compactor, heavy construction equipment",
                        )
                        prompt_bits = [p.strip().lower() for p in str(prompt).replace(".", ",").split(",") if p.strip()]
                        for must_have in ("wheel loader", "front loader", "loader", "heavy construction equipment"):
                            if must_have not in prompt_bits:
                                prompt = f"{prompt}, {must_have}"
                        conf = min(float(cfg.get("equipment_stage1_conf", 0.35)), 0.25)
                        pending_eq_frame = frame.copy()
                        pending_eq_seq = seq
                        pending_eq_future = eq_executor.submit(_run_groundingdino, pending_eq_frame, prompt, conf)

                    for d in last_eq_dets:
                        x1, y1, x2, y2 = d["x1"], d["y1"], d["x2"], d["y2"]
                        label = f"{d['label']} {d['score']:.0%}"
                        color = (30, 165, 255)
                        if _ppe_rounded_rect is not None:
                            _ppe_rounded_rect(annotated, x1, y1, x2, y2, color, 2, radius=5)
                        else:
                            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)
                        if _ppe_blend_rect is not None:
                            _ppe_blend_rect(annotated, x1, y1, x2, min(y1 + 24, y2), color, 0.75)
                        else:
                            cv2.rectangle(annotated, (x1, y1), (x2, min(y1 + 24, y2)), color, -1)
                        cv2.putText(annotated, label, (x1 + 4, y1 + 16),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
                elif equipment_enabled and not _gdino_warned:
                    logger.warning(
                        f"[dev_pipeline] equipment requested but YOLO-World unavailable "
                        f"(_gdino_available={_gdino_available}, _gdino_model={_gdino_model is not None}, "
                        f"_run_groundingdino={_run_groundingdino is not None}) — no equipment boxes will draw"
                    )
                    _gdino_warned = True

                # ── Write final annotated frame (with overlays) ───────────────
                with _dev_annotated["lock"]:
                    _dev_annotated["frame"] = annotated
                    _dev_annotated["seq"] = seq * 2

                with _dev_lock:
                    _dev_state["frame_count"] = frame_count

                # ── Throttle to video FPS ─────────────────────────────────────
                elapsed = time.time() - t0
                wait = frame_delay - elapsed
                if wait > 0:
                    time.sleep(wait)

            except Exception as loop_err:
                logger.error(f"[dev_pipeline] loop error at frame {seq}: {loop_err}", exc_info=True)
                time.sleep(0.1)

    finally:
        cap.release()
        eq_executor.shutdown(wait=False)
        if eq_processor is not None:
            eq_processor.stop()
            if unregister_processor is not None:
                unregister_processor(_DEV_CAMERA_ID)
        logger.info("[dev_pipeline] stopped")


def _stop_pipeline():
    with _dev_lock:
        _dev_state["stop"].set()
        _dev_state["running"] = False
        _dev_state["equipment_enabled_at"] = None
    time.sleep(0.4)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/video-upload")
async def upload_video(
    file: UploadFile = File(...),
    project_id: int = Form(...),
    zone_name: str = Form("Test Zone"),
    ppe_enabled: bool = Form(True),
    equipment_enabled: bool = Form(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _stop_pipeline()

    _TEST_VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "video.mp4").suffix or ".mp4"
    video_path = _TEST_VIDEO_DIR / f"dev_upload{suffix}"
    content = await file.read()
    with open(video_path, "wb") as f:
        f.write(content)

    try:
        cfg = load_config(db)
    except Exception:
        cfg = DEFAULTS.copy()

    stop_event = threading.Event()
    equipment_enabled_at = datetime.now(timezone.utc).isoformat() if equipment_enabled else None
    with _dev_lock:
        _dev_state.update({
            "running": True,
            "stop": stop_event,
            "project_id": project_id,
            "zone_name": zone_name,
            "ppe_enabled": ppe_enabled,
            "equipment_enabled": equipment_enabled,
            "equipment_enabled_at": equipment_enabled_at,
            "frame_count": 0,
            "video_path": str(video_path),
        })
    with _dev_annotated["lock"]:
        _dev_annotated["frame"] = None
        _dev_annotated["seq"] = 0

    t = threading.Thread(
        target=_run_dev_pipeline,
        args=(str(video_path), project_id, zone_name, ppe_enabled, equipment_enabled, cfg, stop_event),
        daemon=True,
        name="dev-pipeline",
    )
    t.start()
    _push_equipment_feature(project_id, equipment_enabled)
    return {"status": "started", "zone_name": zone_name, "fps_source": "video"}


@router.post("/video-stop")
def stop_video(user: User = Depends(get_current_user)):
    with _dev_lock:
        project_id = _dev_state.get("project_id")
    _stop_pipeline()
    _push_equipment_feature(project_id, False)
    return {"status": "stopped"}


@router.patch("/features")
def patch_features(
    body: DevFeaturePatch,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    with _dev_lock:
        if not _dev_state["running"]:
            raise HTTPException(status_code=400, detail="No pipeline running. Upload a video first.")
        ppe_enabled = body.ppe_enabled
        equipment_enabled = body.equipment_enabled
        if ppe_enabled is not None:
            _dev_state["ppe_enabled"] = ppe_enabled
        if equipment_enabled is not None:
            _dev_state["equipment_enabled"] = equipment_enabled
            _dev_state["equipment_enabled_at"] = datetime.now(timezone.utc).isoformat() if equipment_enabled else None
        video_path = _dev_state["video_path"]
        project_id = _dev_state["project_id"]
        zone_name = _dev_state["zone_name"]
        new_ppe = _dev_state["ppe_enabled"]
        new_eq = _dev_state["equipment_enabled"]
        stop_event = _dev_state["stop"]

    stop_event.set()
    time.sleep(0.4)

    try:
        cfg = load_config(db)
    except Exception:
        cfg = DEFAULTS.copy()

    new_stop = threading.Event()
    with _dev_lock:
        _dev_state["stop"] = new_stop
        _dev_state["running"] = True

    t = threading.Thread(
        target=_run_dev_pipeline,
        args=(video_path, project_id, zone_name, new_ppe, new_eq, cfg, new_stop),
        daemon=True,
        name="dev-pipeline",
    )
    t.start()
    _push_equipment_feature(project_id, new_eq)
    return {"status": "restarted", "ppe_enabled": new_ppe, "equipment_enabled": new_eq}


@router.get("/stream")
def dev_stream(token: str = Query(default=""), request: Request = None, db: Session = Depends(get_db)):
    """MJPEG stream of annotated dev video frames. Accepts token via query param for <img> src."""
    from ...core.security import decode_access_token
    # Accept token from query param (img src can't send headers) or Authorization header
    raw = token or ""
    if not raw:
        authz = (request.headers.get("authorization") or "") if request else ""
        if authz.lower().startswith("bearer "):
            raw = authz.split(" ", 1)[1].strip()
    if not raw:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = decode_access_token(raw)
        sub = payload.get("sub")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = db.query(User).filter(User.id == int(sub)).first()
        if not user or not user.is_active or not user.is_approved:
            raise HTTPException(status_code=401, detail="Invalid token")
        ver = payload.get("ver")
        if ver is None or int(ver) != int(user.token_version or 1):
            raise HTTPException(status_code=401, detail="Invalid token")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    db.close()

    def generate():
        last_seq = -1
        deadline = time.time() + 30.0  # 30s for first frame (model warmup on GPU)
        while True:
            with _dev_annotated["lock"]:
                frame = _dev_annotated.get("frame")
                seq = _dev_annotated.get("seq", -1)

            if frame is None or seq == last_seq:
                if time.time() > deadline:
                    break
                time.sleep(0.02)
                continue

            deadline = time.time() + 10.0
            last_seq = seq
            try:
                _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                fb = buf.tobytes()
            except Exception:
                continue
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(fb)).encode() + b"\r\n\r\n"
                + fb + b"\r\n"
            )

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status")
def dev_status(user: User = Depends(get_current_user)):
    with _dev_lock:
        return {
            "running": _dev_state["running"],
            "frame_count": _dev_state["frame_count"],
            "ppe_enabled": _dev_state["ppe_enabled"],
            "equipment_enabled": _dev_state["equipment_enabled"],
            "zone_name": _dev_state["zone_name"],
            "project_id": _dev_state["project_id"],
        }
