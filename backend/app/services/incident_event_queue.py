"""
Incident Event Queue — fire-and-forget bridge between the ML inferencer thread and the DB.

Two queues:
  incident_queue  (maxsize=500)  fast path: write PpeIncident + save snapshot JPEG
  clip_queue      (maxsize=50)   slow path: encode .mp4 from post-violation frames

Both queues use threading.Queue so the GPU inferencer thread can call put_nowait()
without any async/await overhead.  Workers run as daemon threads started in on_startup.
"""

import os
import queue
import logging
import threading
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import cv2

logger = logging.getLogger(__name__)

# ── Public queues (imported by ml_stream_enterprise.py) ──────────────────────
incident_queue: queue.Queue = queue.Queue(maxsize=2000)
clip_queue: queue.Queue = queue.Queue(maxsize=500)

# ThreadPoolExecutor for local clip encoding when Celery is disabled
_clip_executor = ThreadPoolExecutor(max_workers=12, thread_name_prefix="clip_worker")

# ── FFmpeg path cache ──────────────────────────────────────────────
_ffmpeg_path: str | None = None
_ffmpeg_checked = False

# Registry: camera_id -> most-recent incident_id  (so clip worker can attach clip_url)
_recent_incident_ids: dict = {}
_recent_incident_lock = threading.Lock()

# ── Pre-enqueue dedup: tracks currently in the queue (camera_id, track_id or global_id)
# Prevents the queue filling with hundreds of identical frames for the same person.
_queued_keys: set = set()
_queued_keys_lock = threading.Lock()

_WORKER_COUNT = 4  # parallel incident worker threads

# Counts events dropped due to full queue — exposed via health endpoint for monitoring.
_dropped_incident_count: int = 0
_dropped_incident_lock = threading.Lock()


def get_dropped_incident_count() -> int:
    with _dropped_incident_lock:
        return _dropped_incident_count


def _get_ffmpeg() -> str | None:
    global _ffmpeg_path, _ffmpeg_checked
    if _ffmpeg_checked:
        return _ffmpeg_path
    _ffmpeg_path = shutil.which("ffmpeg")
    if not _ffmpeg_path:
        candidates = [
            r"C:\Program Files\Agent\dlls\x64\ffmpeg.exe",
            r"C:\Program Files\Agent DVR\ffmpeg.exe",
            r"C:\Program Files (x86)\Agent DVR\ffmpeg.exe",
            r"C:\Agent DVR\ffmpeg.exe",
            r"C:\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
            r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
            r"C:\tools\ffmpeg\bin\ffmpeg.exe",
            r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
            r"C:\ProgramData\scoop\apps\ffmpeg\current\bin\ffmpeg.exe",
        ]
        for p in candidates:
            try:
                if os.path.exists(p):
                    _ffmpeg_path = p
                    break
            except Exception:
                continue
    _ffmpeg_checked = True
    return _ffmpeg_path


# ─────────────────────────────────────────────────────────────────────────────
# PRE-ENQUEUE DEDUP HELPER
# ─────────────────────────────────────────────────────────────────────────────

def try_enqueue(event: dict) -> bool:
    """
    Attempt to add an incident event to the queue.
    Returns False (and drops) if the queue is full OR if the same
    (camera, person) is already queued and hasn't been processed yet.
    """
    global _dropped_incident_count

    camera_id = event.get("camera_id")
    global_id  = event.get("global_id")
    track_id   = event.get("track_id")
    # Prefer global_id for dedup key; fall back to track_id
    person_key = global_id if global_id is not None else track_id
    dedup_key  = (camera_id, person_key)

    with _queued_keys_lock:
        if dedup_key in _queued_keys:
            logger.debug(f"[incident_queue] Pre-enqueue dedup: skipping camera={camera_id} person={person_key}")
            return False
        _queued_keys.add(dedup_key)

    # put_nowait is called outside the lock intentionally (no blocking in hot path).
    # If the queue is full we must remove the key we just added, otherwise this
    # (camera, person) pair will be permanently silenced until server restart.
    try:
        incident_queue.put_nowait({**event, "_dedup_key": dedup_key})
        return True
    except queue.Full:
        with _queued_keys_lock:
            _queued_keys.discard(dedup_key)
        with _dropped_incident_lock:
            _dropped_incident_count += 1
        logger.warning(
            f"[ml_stream] incident_queue FULL — event dropped for camera {camera_id} "
            f"(total dropped: {_dropped_incident_count})"
        )
        return False


# ─────────────────────────────────────────────────────────────────────────────
# INCIDENT WORKER
# ─────────────────────────────────────────────────────────────────────────────

def _incident_worker():
    """Consume incident_queue, write DB row + snapshot, then fire notification/task engines."""
    logger.info("[incident_worker] Started")
    while True:
        event = incident_queue.get()
        dedup_key = event.pop("_dedup_key", None)
        logger.debug(f"[incident_worker] Got event: camera={event.get('camera_id')}, track={event.get('track_id')}")
        try:
            _process_incident(event)
        except Exception as exc:
            logger.error(f"[incident_queue] Unhandled error: {exc}", exc_info=True)
        finally:
            if dedup_key is not None:
                with _queued_keys_lock:
                    _queued_keys.discard(dedup_key)
            incident_queue.task_done()


def _process_incident(event: dict):
    from ..core.db import SessionLocal
    from ..core.config import settings
    from ..models.project_camera import ProjectCamera
    from ..models.project_camera_analytics import ProjectCameraAnalytics
    from ..models.project import Project, ProjectStatus
    from ..models.zone import Zone
    from ..models.ppe_incident import PpeIncident
    from ..models.camera import Camera
    from . import notification_engine
    from . import auto_task_engine

    camera_id  = event["camera_id"]
    has_helmet = event["has_helmet"]
    has_vest   = event["has_vest"]
    timestamp  = event.get("timestamp") or datetime.now(timezone.utc)

    logger.info(f"[incident_queue] Processing: camera={camera_id}, helmet={has_helmet}, vest={has_vest}")

    ppe_broadcast_data = None
    project_id = None
    db = SessionLocal()
    try:
        # 1. Find active project for this camera
        pc = (
            db.query(ProjectCamera)
            .join(Project, Project.id == ProjectCamera.project_id)
            .filter(
                ProjectCamera.camera_id == camera_id,
                Project.status == ProjectStatus.ACTIVE,
            )
            .first()
        )
        if not pc:
            logger.warning(f"[incident_queue] Camera {camera_id} not assigned to active project")
            return  # camera not assigned to any active project

        project_id = pc.project_id

        # 2. Check analytics config
        analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == pc.id)
            .first()
        )
        if analytics and not analytics.inference_events_enabled:
            logger.debug(f"[incident_queue] inference_events disabled for camera={camera_id} project_camera_id={pc.id}")
            return

        # 3. Deduplication — skip if open incident for the same person within N seconds.
        #    Window is configurable via MLConfig.incident_dedup_seconds (default 30s).
        #    Prefer global_person_id (FAISS cross-camera identity) when available;
        #    fall back to track_id (local ByteTrack ID) otherwise.
        from datetime import timedelta
        from .ml_config_service import load_config as _load_cfg
        _dedup_seconds = _load_cfg(db).get("incident_dedup_seconds", 30)
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=_dedup_seconds)
        global_id = event.get("global_id")
        track_id  = event.get("track_id")

        if global_id is not None:
            # Global identity is cross-camera: dedup across ALL cameras in the project.
            # Same person (G-5) on Camera A and Camera B simultaneously must not
            # create two separate open incidents — one is enough.
            recent = (
                db.query(PpeIncident)
                .filter(
                    PpeIncident.project_id       == pc.project_id,
                    PpeIncident.global_person_id == global_id,
                    PpeIncident.status           == "open",
                    PpeIncident.started_at       >= cutoff,
                )
                .first()
            )
        elif track_id is not None:
            # No global ID yet (ReID unavailable) — track_id is camera-local, so
            # dedup is per-camera (different cameras may reuse the same track_id integer)
            recent = (
                db.query(PpeIncident)
                .filter(
                    PpeIncident.camera_id  == camera_id,
                    PpeIncident.track_id   == track_id,
                    PpeIncident.status     == "open",
                    PpeIncident.started_at >= cutoff,
                )
                .first()
            )
        else:
            recent = None

        if recent:
            logger.debug(
                f"[incident_queue] Dedup skip: camera={camera_id} global_id={global_id} track_id={track_id} "
                f"window_s={_dedup_seconds}"
            )
            # Register the existing incident so clip_worker can attach any queued clip to it
            with _recent_incident_lock:
                _recent_incident_ids[(camera_id, track_id)] = recent.id
                _recent_incident_ids[camera_id] = recent.id
            return

        # 4. Determine incident_type + severity
        if not has_helmet and not has_vest:
            incident_type = "both_missing"
            severity      = "high"
        elif not has_helmet:
            incident_type = "no_helmet"
            severity      = "medium"
        else:
            incident_type = "no_vest"
            severity      = "medium"

        # 5. Zone info from project_camera
        zone_id   = pc.zone_id
        zone_name = None
        if zone_id:
            zone = db.query(Zone).filter(Zone.id == zone_id).first()
            zone_name = zone.name if zone else None

        # 5b. Camera name for broadcast
        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        camera_name = camera.name if camera else f"Camera {camera_id}"

        # 6. Write incident row
        incident = PpeIncident(
            project_id       = project_id,
            camera_id        = camera_id,
            zone_id          = zone_id,
            zone_name        = zone_name,
            track_id         = track_id,
            global_person_id = event.get("global_id"),
            has_helmet       = has_helmet,
            has_vest         = has_vest,
            incident_type    = incident_type,
            started_at       = timestamp,
            severity         = severity,
            status           = "open",
        )
        db.add(incident)
        db.flush()  # get incident.id before commit

        # 7. Save snapshot JPEG (Cloudinary preferred, local fallback)
        snapshot_frame = event.get("snapshot_frame")
        if snapshot_frame is not None:
            try:
                success, buf = cv2.imencode(".jpg", snapshot_frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                if success:
                    img_bytes_raw = buf.tobytes()
                    cloud_url = None
                    if settings.cloudinary_cloud_name and settings.cloudinary_api_key:
                        try:
                            import cloudinary
                            import cloudinary.uploader
                            from io import BytesIO
                            cloudinary.config(
                                cloud_name=settings.cloudinary_cloud_name,
                                api_key=settings.cloudinary_api_key,
                                api_secret=settings.cloudinary_api_secret,
                            )
                            result = cloudinary.uploader.upload(
                                BytesIO(img_bytes_raw),
                                folder=f"ppe_incidents/{incident.id}",
                                public_id="snapshot",
                                resource_type="image",
                                overwrite=True,
                            )
                            cloud_url = result.get("secure_url")
                            if not cloud_url:
                                raise Exception("No secure_url in response")
                            incident.snapshot_url = cloud_url
                            logger.info(f"[incident_queue] Snapshot uploaded to Cloudinary: {cloud_url}")
                        except Exception as e:
                            logger.warning(f"[incident_queue] Cloudinary snapshot upload failed, using local fallback: {e}")

                    if not cloud_url:
                        local_url = _save_snapshot_local(img_bytes_raw, incident.id)
                        if local_url:
                            incident.snapshot_url = local_url
                            logger.info(f"[incident_queue] Snapshot saved locally: {local_url}")
            except Exception as e:
                logger.warning(f"[incident_queue] Snapshot save failed for incident {incident.id}: {e}")

        db.commit()

        # 8. Broadcast new incident to all connected PPE dashboard clients via SSE (instant real-time)
        # Store broadcast data before db closes
        ppe_broadcast_data = {
            "type": "ppe_live_alert",
            "incident_id": incident.id,
            "camera_id": camera_id,
            "camera_name": camera_name,
            "zone_name": zone_name,
            "severity": incident.severity,
            "incident_type": incident.incident_type,
            "has_helmet": incident.has_helmet,
            "has_vest": incident.has_vest,
            "timestamp": incident.started_at.isoformat() if incident.started_at else None,
            "snapshot_url": incident.snapshot_url,
            "person_id": (
                f"G-{incident.global_person_id}" if incident.global_person_id is not None
                else (f"T-{track_id}" if track_id is not None else None)
            ),
        }

        # 9. Track recent incident_id for clip worker — keyed by (camera_id, track_id)
        #    so multiple simultaneous violations on the same camera map to the right incident.
        with _recent_incident_lock:
            _recent_incident_ids[(camera_id, track_id)] = incident.id
            # Legacy camera_id-only key kept for any callers that don't have track_id
            _recent_incident_ids[camera_id] = incident.id

        # 10. Notifications
        try:
            notification_engine.notify(db, project_id, camera_id, incident)
            db.commit()
        except Exception as e:
            logger.warning(f"[incident_queue] Notification failed: {e}")

        # 10. Auto-tasks
        try:
            auto_task_engine.evaluate(db, project_id, camera_id, incident)
            db.commit()
            # Push SSE: notify task pages that new tasks may have been created
            from .project_task_broker import push as _task_push
            _task_push(project_id, {"type": "task_refresh", "project_id": project_id})
        except Exception as e:
            logger.warning(f"[incident_queue] Auto-task failed: {e}")

    finally:
        db.close()

    # 11. Broadcast to all connected SSE clients (outside db session)
    if ppe_broadcast_data:
        try:
            from . import ppe_dashboard_broker
            ppe_dashboard_broker.push(project_id, ppe_broadcast_data)
            logger.debug(f"[incident_queue] Broadcast sent for incident {ppe_broadcast_data.get('incident_id')}")
        except Exception as e:
            logger.warning(f"[incident_queue] PPE dashboard broadcast failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# CLIP WORKER
# ─────────────────────────────────────────────────────────────────────────────

def _clip_worker():
    """Consume clip_queue, encode frames to .mp4, attach url to incident."""
    while True:
        event = clip_queue.get()
        try:
            _process_clip(event)
        except Exception as exc:
            logger.error(f"[clip_queue] Unhandled error: {exc}", exc_info=True)
        finally:
            clip_queue.task_done()


def _process_clip(event: dict):
    import time
    from ..core.config import settings

    camera_id = event["camera_id"]
    frames    = event.get("frames", [])

    if not frames:
        return

    # Prefer incident_id passed directly in the event (fastest, no race).
    incident_id = event.get("incident_id")

    track_id = event.get("track_id")

    # Registry fallback — keyed by (camera_id, track_id) for precision, camera_id as last resort.
    if not incident_id:
        with _recent_incident_lock:
            incident_id = (
                _recent_incident_ids.get((camera_id, track_id))
                or _recent_incident_ids.get(camera_id)
            )

    # DB fallback — retry for up to 2 s; filter by track_id when available.
    if not incident_id:
        from ..core.db import SessionLocal
        from ..models.ppe_incident import PpeIncident
        from datetime import timedelta
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline:
            db = SessionLocal()
            try:
                cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
                q = db.query(PpeIncident.id).filter(
                    PpeIncident.camera_id  == camera_id,
                    PpeIncident.started_at >= cutoff,
                )
                if track_id is not None:
                    q = q.filter(PpeIncident.track_id == track_id)
                row = q.order_by(PpeIncident.id.desc()).first()
                if row:
                    incident_id = row[0]
                    break
            finally:
                db.close()
            time.sleep(0.2)

    if not incident_id:
        logger.warning(f"[clip_worker] No incident_id found for camera={camera_id}; dropping clip")
        return

    if settings.celery_enabled:
        _dispatch_clip_to_celery(frames, camera_id, incident_id)
    else:
        _clip_executor.submit(_save_clip_local, frames, camera_id, incident_id)


def _save_clip_local(frames: list, camera_id: int, incident_id: int):
    """Encode frames list to H.264 MP4 using FFmpeg and save to local media storage."""
    from ..core.db import SessionLocal
    from ..models.ppe_incident import PpeIncident

    if not frames:
        return

    try:
        ffmpeg_path = _get_ffmpeg()
        if not ffmpeg_path:
            logger.error("[clip_worker] ffmpeg not found — cannot encode clip for incident %d", incident_id)
            return

        h, w = frames[0].shape[:2]
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        tmp_path = tmp.name
        tmp.close()

        cmd = [
            ffmpeg_path, "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-pix_fmt", "bgr24",
            "-s", f"{w}x{h}",
            "-r", "15",
            "-i", "pipe:0",
            "-an",
            "-vcodec", "libx264",
            "-preset", "veryfast",
            "-crf", "28",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            tmp_path,
        ]

        proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        for frame in frames:
            if frame is not None:
                if frame.shape[:2] != (h, w):
                    frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_LINEAR)
                proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        proc.wait(timeout=30)

        if proc.returncode != 0:
            logger.error(f"[clip_worker] FFmpeg encoding failed (code={proc.returncode}) for incident {incident_id}")
            return

        clip_url = _save_clip_to_local(tmp_path, incident_id)

        if clip_url:
            db = SessionLocal()
            try:
                db.query(PpeIncident).filter(PpeIncident.id == incident_id).update(
                    {"video_clip_url": clip_url}
                )
                db.commit()
                # Notify SSE clients so the clip link appears without manual refresh
                try:
                    incident_row = db.query(PpeIncident).filter(PpeIncident.id == incident_id).first()
                    if incident_row:
                        from .ppe_dashboard_broker import push as _broker_push
                        _broker_push(incident_row.project_id, {
                            "type":          "ppe_incident_updated",
                            "incident_id":   incident_id,
                            "video_clip_url": clip_url,
                        })
                except Exception:
                    pass
            finally:
                db.close()

    except Exception as e:
        logger.error(f"[clip_worker] Clip encoding failed for camera {camera_id}: {e}")


def _save_snapshot_local(img_bytes: bytes, incident_id: int) -> str | None:
    """Save JPEG bytes to local media dir. Returns the URL path or None."""
    try:
        from ..core.config import settings
        folder = os.path.join(settings.media_snapshots_dir, "ppe_incidents", str(incident_id))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "snapshot.jpg")
        with open(path, "wb") as f:
            f.write(img_bytes)
        return f"/media/snapshots/ppe_incidents/{incident_id}/snapshot.jpg"
    except Exception as e:
        logger.warning(f"[incident_queue] Local snapshot save failed: {e}")
        return None


def _save_clip_to_local(tmp_path: str, incident_id: int) -> str | None:
    """Move encoded temp .mp4 to permanent local media dir. Returns the URL path or None."""
    try:
        import shutil
        from ..core.config import settings
        folder = os.path.join(settings.media_clips_dir, "ppe_incidents", str(incident_id))
        os.makedirs(folder, exist_ok=True)
        dest = os.path.join(folder, "video_clip.mp4")
        shutil.move(tmp_path, dest)
        logger.info(f"[clip_worker] Clip saved locally: {dest} for incident {incident_id}")
        return f"/media/clips/ppe_incidents/{incident_id}/video_clip.mp4"
    except Exception as e:
        logger.warning(f"[clip_worker] Local clip save failed: {e}")
        return None


def _dispatch_clip_to_celery(frames: list, camera_id: int, incident_id: int):
    """Serialize frames and dispatch to Celery clipper_task."""
    try:
        import base64
        frames_b64 = []
        for f in frames:
            if f is not None:
                success, buf = cv2.imencode(".jpg", f, [cv2.IMWRITE_JPEG_QUALITY, 75])
                if success:
                    frames_b64.append(base64.b64encode(buf).decode())
        if not frames_b64:
            return
        from ..tasks.clipper_task import save_video_clip
        save_video_clip.delay(frames_b64, camera_id, incident_id)
    except Exception as e:
        logger.error(f"[clip_worker] Celery dispatch failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# STARTUP
# ─────────────────────────────────────────────────────────────────────────────

def start_workers():
    """Start incident worker pool + clip worker. Called from main.py on_startup."""
    try:
        for i in range(_WORKER_COUNT):
            t = threading.Thread(target=_incident_worker, name=f"incident-worker-{i}", daemon=True)
            t.start()
        # One consumer thread is enough — it just calls _clip_executor.submit() which is instant.
        # Real parallelism is in the executor pool (max_workers=6).
        t2 = threading.Thread(target=_clip_worker, name="clip-worker", daemon=True)
        t2.start()
        logger.info(f"✅ Incident event queue workers started ({_WORKER_COUNT}x incident-worker + 1x clip-worker → 6x clip-encoder)")
    except Exception as e:
        logger.error(f"❌ Failed to start queue workers: {e}", exc_info=True)
        raise
