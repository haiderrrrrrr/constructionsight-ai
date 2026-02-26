"""
Celery evidence clipper task.
Uploads evidence frames to Cloudinary and stores URLs in incident_evidence.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import tempfile
from io import BytesIO

import cv2
import numpy as np

from ..celery_app import celery_app

logger = logging.getLogger(__name__)

_ffmpeg_path: str | None = None
_ffmpeg_checked = False


def _get_ffmpeg() -> str | None:
    """Find FFmpeg executable on Windows or Unix."""
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


@celery_app.task(
    name="app.tasks.clipper_task.save_evidence",
    bind=True,
    max_retries=3,
    queue="clipper",
)
def save_evidence(
    self,
    incident_id: int,
    frame_bytes_list: list[bytes],
    detections_list:  list[dict],
) -> None:
    """
    Upload each frame to Cloudinary (or store locally as fallback).
    Create IncidentEvidence rows in DB.
    """
    try:
        from ..core.db import SessionLocal
        from ..models.incident import IncidentEvidence

        urls: list[str | None] = []
        for frame_bytes in frame_bytes_list:
            url = _upload_frame(incident_id, frame_bytes)
            urls.append(url)

        db = SessionLocal()
        try:
            for url, dets in zip(urls, detections_list):
                ev = IncidentEvidence(
                    incident_id     = incident_id,
                    frame_url       = url,
                    detections_json = dets,
                )
                db.add(ev)
            db.commit()
        finally:
            db.close()

    except Exception as exc:
        logger.error("save_evidence incident=%d: %s", incident_id, exc)
        raise self.retry(exc=exc, countdown=5)


@celery_app.task(
    name="app.tasks.clipper_task.save_video_clip",
    bind=True,
    max_retries=2,
    queue="clipper",
)
def save_video_clip(
    self,
    frames_b64: list[str],
    camera_id: int,
    incident_id: int,
) -> None:
    import base64

    try:
        from ..core.db import SessionLocal
        from ..core.config import settings
        from ..models.ppe_incident import PpeIncident

        if not frames_b64:
            return

        frames = []
        for b64 in frames_b64:
            try:
                img_bytes = base64.b64decode(b64)
                nparr = np.frombuffer(img_bytes, np.uint8)
                frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                if frame is not None:
                    frames.append(frame)
            except Exception:
                continue

        if not frames:
            return

        h, w = frames[0].shape[:2]
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp4")
        clip_path = tmp.name
        tmp.close()

        ffmpeg_path = _get_ffmpeg()
        if ffmpeg_path:
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
                clip_path,
            ]
            try:
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
                    raise Exception(f"FFmpeg encoding failed with code {proc.returncode}")
            except Exception as e:
                logger.warning("save_video_clip: FFmpeg encoding failed, falling back: %s", e)
                try:
                    os.remove(clip_path)
                except Exception:
                    pass
                clip_path = None
        else:
            logger.warning("save_video_clip: ffmpeg not found, cannot encode")
            clip_path = None

        clip_url = None

        if clip_path and settings.cloudinary_cloud_name and settings.cloudinary_api_key:
            try:
                import cloudinary
                import cloudinary.uploader

                cloudinary.config(
                    cloud_name=settings.cloudinary_cloud_name,
                    api_key=settings.cloudinary_api_key,
                    api_secret=settings.cloudinary_api_secret,
                )
                result = cloudinary.uploader.upload(
                    clip_path,
                    folder=f"ppe_incidents/{incident_id}",
                    public_id="video_clip",
                    resource_type="video",
                    eager=[{"format": "mp4", "video_codec": "h264", "audio_codec": "aac"}],
                    eager_async=False,
                    overwrite=True,
                )
                eager = result.get("eager") or []
                clip_url = (eager[0].get("secure_url") if eager else None) or result.get("secure_url")
                if not clip_url:
                    raise Exception("No secure_url in response")
                logger.info("save_video_clip: incident=%d clip=%s", incident_id, clip_url)
            except Exception as e:
                logger.warning("save_video_clip: Cloudinary failed, using local fallback: %s", e)

        if not clip_url and clip_path:
            clip_url = _save_clip_local_fallback(clip_path, incident_id)
        else:
            try:
                if clip_path:
                    os.remove(clip_path)
            except Exception:
                pass

        if clip_url:
            db = SessionLocal()
            try:
                db.query(PpeIncident).filter(PpeIncident.id == incident_id).update(
                    {"video_clip_url": clip_url}
                )
                db.commit()
            finally:
                db.close()

    except Exception as exc:
        logger.error("save_video_clip incident=%d camera=%d: %s", incident_id, camera_id, exc)
        raise self.retry(exc=exc, countdown=10)


def _upload_frame(incident_id: int, frame_bytes: bytes) -> str | None:
    """Upload to Cloudinary; falls back to local storage on failure."""
    import uuid as _uuid
    from ..core.config import settings

    if settings.cloudinary_cloud_name and settings.cloudinary_api_key:
        try:
            import cloudinary
            import cloudinary.uploader

            cloudinary.config(
                cloud_name = settings.cloudinary_cloud_name,
                api_key    = settings.cloudinary_api_key,
                api_secret = settings.cloudinary_api_secret,
            )
            buf = BytesIO(frame_bytes)
            result = cloudinary.uploader.upload(
                buf,
                folder=f"incidents/{incident_id}",
                resource_type="image",
            )
            url = result.get("secure_url")
            if url:
                return url
        except Exception as exc:
            logger.warning("Cloudinary upload failed, using local fallback: %s", exc)

    # Local fallback
    try:
        import os
        frame_id = _uuid.uuid4().hex[:8]
        folder = os.path.join(settings.media_snapshots_dir, "incidents", str(incident_id))
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{frame_id}.jpg")
        with open(path, "wb") as f:
            f.write(frame_bytes)
        return f"/media/snapshots/incidents/{incident_id}/{frame_id}.jpg"
    except Exception as exc:
        logger.warning("Local frame save failed: %s", exc)
        return None


def _save_clip_local_fallback(tmp_path: str, incident_id: int) -> str | None:
    """Move encoded temp .mp4 to permanent local media dir. Returns URL path or None."""
    try:
        import os
        import shutil
        from ..core.config import settings

        folder = os.path.join(settings.media_clips_dir, "ppe_incidents", str(incident_id))
        os.makedirs(folder, exist_ok=True)
        dest = os.path.join(folder, "video_clip.mp4")
        shutil.move(tmp_path, dest)
        logger.info("save_video_clip: local fallback incident=%d path=%s", incident_id, dest)
        return f"/media/clips/ppe_incidents/{incident_id}/video_clip.mp4"
    except Exception as exc:
        logger.warning("Local clip save failed: %s", exc)
        try:
            import os as _os
            _os.remove(tmp_path)
        except Exception:
            pass
        return None
