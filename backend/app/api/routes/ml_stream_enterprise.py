from __future__ import annotations

"""
Enterprise ML Stream — MJPEG + PPE Detection + ReID + FAISS

Features:
  - Configuration-driven (all thresholds from DB, hot-updateable)
  - ReID: optional OSNet model for global identity tracking
  - FAISS: shared cross-camera identity gallery (in-memory, survives brief disconnects)
  - GlobalStateMemory: restore compliance state when person returns
  - Graceful degradation: PPE works without ReID
  - Shared singletons: one FAISS + state memory across ALL cameras for cross-camera ReID

Architecture (Enterprise):
  1. Load config from ml_config_service (with TTL cache)
  2. Load YOLO models once at module level (singleton per process)
  3. Load ReID model once at module level (optional)
  4. Shared: one FAISS gallery + state memory across all cameras (thread-safe)
  5. Frame pipeline:
     - Stage 1: Person detection + ByteTrack
     - PPE: Stage 2 on person crop (helmet/vest)
     - ReID: Extract embedding (if config + model available)
     - FAISS: Assign/update global ID
     - State Machine: Update compliance status
     - Draw: Annotate frame
  6. Graceful error handling: skip ReID if model unavailable
"""

import os

# Must be set before any cv2.VideoCapture RTSP call — tells FFmpeg to disable
# its internal jitter buffer so RTSP streams have minimal latency.
os.environ.setdefault(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;0|reorder_queue_size;0"
)

import cv2
import time
import logging
import threading
import subprocess
import shutil
import numpy as np
from pathlib import Path
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..deps import get_db
from ...core.crypto import decrypt_credential
from ...core.db import SessionLocal
from ...models.camera import Camera, CameraCredential
from ...core.config import settings
from ...services.ml_config_service import load_config, DEFAULTS

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/stream", tags=["stream"])

# ─────────────────────────────────────────────────────────────
# FFmpeg MJPEG CAPTURE (low-latency RTSP → MJPEG pipe → numpy)
# ─────────────────────────────────────────────────────────────
def _find_ffmpeg() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found
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
                return p
        except Exception:
            continue
    return None


_CLIP_MAX_WIDTH = 640  # clip frames downscaled before buffering (~9x RAM savings at 1080p)

def _scale_frame_for_clip(f: np.ndarray) -> np.ndarray:
    h, w = f.shape[:2]
    if w <= _CLIP_MAX_WIDTH:
        return f
    scale = _CLIP_MAX_WIDTH / w
    return cv2.resize(f, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


class _FFmpegMJPEGCapture:
    def __init__(self, rtsp_url: str, transport: str):
        self._rtsp_url = rtsp_url
        self._transport = transport or "tcp"
        self._ffmpeg = _find_ffmpeg()
        self._proc = None
        self._buf = b""
        self._opened = False
        self._stderr_tail = deque(maxlen=30)
        self._stderr_thread = None
        self._logged_dead = False
        self._start()

    def _start(self) -> None:
        if not self._ffmpeg:
            logger.error("ffmpeg not found on PATH or known install locations")
            return
        cmd = [
            self._ffmpeg, "-y",
            "-fflags", "nobuffer+discardcorrupt",
            "-flags", "low_delay",
            "-probesize", "32",
            "-analyzeduration", "0",
            "-max_delay", "0",
            "-reorder_queue_size", "0",
            "-rtsp_transport", self._transport,
            "-i", self._rtsp_url,
            "-an",
            "-vsync", "passthrough",
            "-f", "mjpeg",
            "-q:v", "6",
            "pipe:1",
        ]
        self._proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self._opened = True
        self._logged_dead = False

        def _stderr_reader():
            proc = self._proc
            if proc is None or proc.stderr is None:
                return
            try:
                for line in proc.stderr:
                    # line is bytes, decode to str
                    if isinstance(line, bytes):
                        line = line.decode("utf-8", errors="replace")
                    self._stderr_tail.append(line.rstrip("\n"))
            except Exception:
                return

        self._stderr_thread = threading.Thread(target=_stderr_reader, daemon=True)
        self._stderr_thread.start()

    def isOpened(self) -> bool:
        if not self._opened or self._proc is None:
            return False
        code = self._proc.poll()
        if code is None:
            return True
        if not self._logged_dead:
            tail = "\n".join(list(self._stderr_tail)[-12:])
            if tail:
                logger.error(f"ffmpeg capture exited (code={code}). stderr tail:\n{tail}")
            else:
                logger.error(f"ffmpeg capture exited (code={code}).")
            self._logged_dead = True
        return False

    def release(self) -> None:
        self._opened = False
        if self._proc is None:
            return
        try:
            self._proc.kill()
            self._proc.wait(timeout=2)
        except Exception:
            pass
        self._proc = None

    def get(self, _prop_id) -> float:
        return 0.0

    def _read_jpeg_bytes(self) -> bytes | None:
        if self._proc is None or self._proc.stdout is None:
            return None

        # Read one chunk to ensure buf has data
        if not self._buf:
            chunk = self._proc.stdout.read(65536)
            if not chunk:
                return None
            self._buf += chunk

        # Drain all non-blocking available data so we always return the
        # freshest frame instead of the oldest buffered one.
        try:
            import os, fcntl
            fd = self._proc.stdout.fileno()
            flags = fcntl.fcntl(fd, fcntl.F_GETFL)
            fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
            try:
                while True:
                    drain = self._proc.stdout.read(65536)
                    if not drain:
                        break
                    self._buf += drain
            except (BlockingIOError, OSError):
                pass
            finally:
                fcntl.fcntl(fd, fcntl.F_SETFL, flags)
        except Exception:
            pass  # Windows (no fcntl) — skip drain, still returns a frame

        # Return the LAST complete JPEG in buf (skip any stale leading frames)
        last_frame = None
        search_pos = 0
        while True:
            sof = self._buf.find(b"\xff\xd8", search_pos)
            if sof == -1:
                break
            eof = self._buf.find(b"\xff\xd9", sof + 2)
            if eof == -1:
                break
            last_frame = self._buf[sof:eof + 2]
            search_pos = eof + 2

        if last_frame is not None:
            self._buf = self._buf[search_pos:]
            return last_frame

        # No complete JPEG in buf yet — block until one arrives
        while True:
            start = self._buf.find(b"\xff\xd8")
            if start != -1:
                end = self._buf.find(b"\xff\xd9", start + 2)
                if end != -1:
                    frame = self._buf[start:end + 2]
                    self._buf = self._buf[end + 2:]
                    return frame
                self._buf = self._buf[start:]
            chunk = self._proc.stdout.read(65536)
            if not chunk:
                return None
            self._buf += chunk

    def read(self):
        jpg = self._read_jpeg_bytes()
        if not jpg:
            return False, None
        arr = np.frombuffer(jpg, dtype=np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if frame is None:
            return False, None
        return True, frame

# ─────────────────────────────────────────────────────────────
# YOLO + REID MODELS (Singleton per process)
# ─────────────────────────────────────────────────────────────
_models_loaded = False
_stage1 = None
_stage2 = None
_reid_model = None
_reid_available = False

def _load_models():
    """Load YOLO + ReID models once at startup."""
    global _models_loaded, _stage1, _stage2, _reid_model, _reid_available

    if _models_loaded:
        return

    try:
        from ultralytics import YOLO

        model_dir = Path(__file__).resolve().parents[4] / "backend" / "app" / "ml" / "models" / "yolo_ppe"
        stage1_path = model_dir / "yolo11m.pt"
        stage2_path = model_dir / "ppe_stage2_best.pt"

        if not stage1_path.exists() or not stage2_path.exists():
            logger.warning(f"YOLO models not found at {model_dir} — PPE detection disabled")
            _models_loaded = True
            return

        _stage1 = YOLO(str(stage1_path))
        _stage2 = YOLO(str(stage2_path))
        # Prevent double-fuse: Stage 2 is already fused when saved.
        # Calling fuse() again removes .bn attributes from Conv layers,
        # causing "'Conv' object has no attribute 'bn'" during predict().
        try:
            _stage2.model.fuse = lambda *a, **kw: _stage2.model
        except Exception:
            pass
        logger.info("✅ YOLO models loaded")

        # Warm-up pass: force CUDA kernel compilation now so the first real
        # frame doesn't incur a 3-8s JIT delay. A single predict() on a blank
        # frame is enough to compile all kernels for that input shape.
        try:
            import numpy as np
            _dummy = np.zeros((640, 640, 3), dtype=np.uint8)
            _stage1.predict(_dummy, verbose=False, imgsz=640)
            _stage2.predict(_dummy, verbose=False, imgsz=640)
            logger.info("✅ YOLO warm-up complete — first inference will be fast")
        except Exception as _wu_e:
            logger.warning(f"YOLO warm-up skipped: {_wu_e}")
    except Exception as e:
        logger.warning(f"Failed to load YOLO models: {e}")
        _models_loaded = True
        return

    # ── Load ReID (optional) ───────────────────────────────────────────────
    try:
        # Try torchreid import
        try:
            from torchreid.reid.utils.feature_extractor import FeatureExtractor
        except ImportError:
            from torchreid.utils import FeatureExtractor

        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _reid_model = FeatureExtractor(model_name="osnet_ain_x1_0", device=device)
        _reid_available = True
        logger.info("✅ ReID model loaded (OSNet-AIN x1.0)")
    except Exception as e:
        logger.warning(f"ReID unavailable: {e} — global identity disabled")
        _reid_model = None
        _reid_available = False

    _models_loaded = True


# Try to load models on import
try:
    _load_models()
except Exception as e:
    logger.debug(f"Deferred model loading: {e}")

# ─────────────────────────────────────────────────────────────
# WORKFORCE SHARED DETECTION INBOX
# After ByteTrack in the PPE inferencer, raw detections are posted here so
# WorkforceProcessor can consume them without a second YOLO call.
# When no PPE pipeline is running, WorkforceBranch starts its own standalone
# reader+detector that also posts here.
# ─────────────────────────────────────────────────────────────
_workforce_detection_inbox: dict = {}      # camera_id -> {"detections": [...], "frame": ndarray, "seq": int, "timestamp": float}
_workforce_inbox_locks: dict = {}          # camera_id -> threading.Lock
_workforce_annotated: dict = {}            # camera_id -> {"frame": ndarray|None, "seq": int, "lock": Lock}

# Ref-counted capture: multiple features (PPE, Workforce) share one _FFmpegMJPEGCapture.
# Capture is only released when ALL features have stopped (ref == 0).
_camera_capture_refs: dict = {}            # camera_id -> int (ref count)
_capture_refs_lock = threading.Lock()

# Standalone workforce reader pipelines (used when PPE is NOT running)
_workforce_standalone_pipelines: dict = {} # camera_id -> {"stop": Event, "reader": Thread, "detector": Thread}
_workforce_standalone_lock = threading.Lock()

# ─────────────────────────────────────────────────────────────
# Activity / Idle Monitoring detection inbox.
# ActivityProcessor reads from here (same structure as workforce inbox).
# Posted by PPE pipeline, Workforce standalone, or activity standalone.
# ─────────────────────────────────────────────────────────────
_activity_detection_inbox: dict = {}       # camera_id -> {"detections": [...], "frame": ndarray, "seq": int, "timestamp": float}
_activity_inbox_locks: dict = {}           # camera_id -> threading.Lock
_activity_annotated: dict = {}             # camera_id -> {"frame": ndarray|None, "seq": int, "lock": Lock}

# Standalone activity reader pipelines (used when neither PPE nor Workforce is running)
_activity_standalone_pipelines: dict = {}  # camera_id -> {"stop": Event, "reader": Thread, "detector": Thread}
_activity_standalone_lock = threading.Lock()

# ─────────────────────────────────────────────────────────────
# Equipment Usage detection inbox.
# EquipmentProcessor reads from here. Posted by Grounding DINO thread-pool
# call in the PPE pipeline or by a standalone equipment reader.
# ─────────────────────────────────────────────────────────────
_equipment_detection_inbox: dict = {}      # camera_id -> {"detections": [...], "frame": ndarray, "seq": int, "timestamp": float}
_equipment_inbox_locks: dict = {}          # camera_id -> threading.Lock
_equipment_annotated: dict = {}            # camera_id -> {"frame": ndarray|None, "seq": int, "lock": Lock}

# Standalone equipment reader pipelines (used when no PPE pipeline is running)
_equipment_standalone_pipelines: dict = {}  # camera_id -> {"stop": Event, "reader": Thread, "detector": Thread}
_equipment_standalone_lock = threading.Lock()


def _get_equipment_inbox_lock(camera_id: int) -> threading.Lock:
    _equipment_inbox_locks.setdefault(camera_id, threading.Lock())
    return _equipment_inbox_locks[camera_id]


def _post_equipment_detections(camera_id: int, detections: list, frame, seq: int) -> None:
    """Post Grounding DINO results to the equipment inbox."""
    lock = _get_equipment_inbox_lock(camera_id)
    with lock:
        _equipment_detection_inbox[camera_id] = {
            "detections": detections,
            "frame":      frame.copy() if frame is not None else None,
            "seq":        seq,
            "timestamp":  time.time(),
        }


def _get_workforce_inbox_lock(camera_id: int) -> threading.Lock:
    _workforce_inbox_locks.setdefault(camera_id, threading.Lock())
    return _workforce_inbox_locks[camera_id]


def _post_workforce_detections(camera_id: int, detections: list, frame, seq: int) -> None:
    """Post ByteTrack results to the workforce inbox. Called from PPE inferencer after Stage 1."""
    # Apply same size + aspect-ratio guard used in standalone detector so that
    # low-confidence PPE Stage-1 detections (bags, chairs, shadows) are filtered out.
    if frame is not None and len(detections) > 0:
        H, W = frame.shape[:2]
        min_h = H * 0.03
        min_w = W * 0.015
        detections = [
            d for d in detections
            if (d["x2"] - d["x1"]) >= min_w
            and (d["y2"] - d["y1"]) >= min_h
            and (d["y2"] - d["y1"]) / max(d["x2"] - d["x1"], 1) >= 0.6
        ]
    lock = _get_workforce_inbox_lock(camera_id)
    with lock:
        _workforce_detection_inbox[camera_id] = {
            "detections": detections,
            "frame":      frame,
            "seq":        seq,
            "timestamp":  time.time(),
        }
    # Also post to activity inbox — ActivityProcessor reads the same detections
    # so it gets zero-cost GPU sharing when PPE or Workforce pipeline is running.
    _post_activity_detections(camera_id, detections, frame, seq)


def _post_activity_detections(camera_id: int, detections: list, frame, seq: int) -> None:
    """Post ByteTrack results to the activity detection inbox."""
    _activity_inbox_locks.setdefault(camera_id, threading.Lock())
    with _activity_inbox_locks[camera_id]:
        _activity_detection_inbox[camera_id] = {
            "detections": detections,
            "frame":      frame.copy() if frame is not None else None,
            "seq":        seq,
            "timestamp":  time.time(),
        }


def acquire_capture(camera_id: int, rtsp_url: str, transport: str = "tcp"):
    """
    Increment ref count for camera_id's capture.
    Creates and stores a new _FFmpegMJPEGCapture if not already present.
    Returns the capture, or None on failure.
    """
    with _capture_refs_lock:
        existing = _camera_captures.get(camera_id)
        if existing is not None and existing.isOpened():
            _camera_capture_refs[camera_id] = _camera_capture_refs.get(camera_id, 0) + 1
            logger.debug(f"[capture_ref] Camera {camera_id} ref++ = {_camera_capture_refs[camera_id]} (existing)")
            return existing
        # Create new
        try:
            cap = _FFmpegMJPEGCapture(rtsp_url, transport)
            if not cap.isOpened():
                logger.error(f"[acquire_capture] Camera {camera_id} could not open RTSP")
                return None
            _camera_captures[camera_id] = cap
            _camera_capture_refs[camera_id] = _camera_capture_refs.get(camera_id, 0) + 1
            logger.info(f"[capture_ref] Camera {camera_id} opened, ref = {_camera_capture_refs[camera_id]}")
            return cap
        except Exception as e:
            logger.error(f"[acquire_capture] Camera {camera_id} error: {e}")
            return None


def release_capture(camera_id: int) -> None:
    """
    Decrement ref count for camera_id's capture.
    Releases and removes the FFmpeg process only when ref reaches 0.
    """
    with _capture_refs_lock:
        refs = _camera_capture_refs.get(camera_id, 0)
        if refs <= 1:
            cap = _camera_captures.pop(camera_id, None)
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            _camera_capture_refs.pop(camera_id, None)
            logger.info(f"[capture_ref] Camera {camera_id} released (ref → 0)")
        else:
            _camera_capture_refs[camera_id] = refs - 1
            logger.debug(f"[capture_ref] Camera {camera_id} ref-- = {_camera_capture_refs[camera_id]}")


def start_workforce_standalone(camera_id: int, rtsp_url: str, transport: str = "tcp") -> bool:
    """
    Start a standalone reader+detector for workforce when PPE is NOT running.
    Posts to _workforce_detection_inbox just like the PPE inferencer would.
    """
    with _workforce_standalone_lock:
        existing = _workforce_standalone_pipelines.get(camera_id)
        if existing is not None and not existing["stop"].is_set():
            return True  # already running

    cap = acquire_capture(camera_id, rtsp_url, transport)
    if cap is None:
        return False

    fresh  = {"frame": None, "seq": 0, "lock": threading.Lock()}
    stop   = threading.Event()

    def _wf_reader():
        consecutive_failures = 0
        while not stop.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    logger.warning(f"[wf_standalone] Camera {camera_id} disconnected")
                    stop.set()
                    break
                time.sleep(0.1)
                continue
            consecutive_failures = 0
            with fresh["lock"]:
                fresh["frame"] = frame
                fresh["seq"]  += 1

    def _wf_detector():
        last_seq = -1
        while not stop.is_set():
            with fresh["lock"]:
                frame = fresh["frame"]
                seq   = fresh["seq"]
            if frame is None or seq == last_seq:
                time.sleep(0.01)
                continue
            last_seq = seq
            frame_copy = frame.copy()
            H, W = frame_copy.shape[:2]

            if _stage1 is None:
                time.sleep(0.05)
                continue
            try:
                r1 = _stage1.predict(
                    source=frame_copy,
                    classes=[0],
                    # 0.30: catches distant workers while filtering laptop/bag false positives.
                    # The size+aspect-ratio filter in _post_workforce_detections() catches
                    # non-human false positives (bags, chairs) that slip through at this conf.
                    conf=0.30,
                    imgsz=960,
                    device=DEVICE,
                    half=USE_HALF,
                    verbose=False,
                )
                bt = _get_or_create_bytetracker(camera_id)
                tracked = bt.update(r1[0].boxes.cpu(), frame_copy)
                detections = []
                # Minimum bbox size: reject anything too small to be a real person
                min_h = H * 0.03
                min_w = W * 0.015
                if tracked is not None and len(tracked) > 0:
                    for row in tracked:
                        x1, y1, x2, y2 = int(row[0]), int(row[1]), int(row[2]), int(row[3])
                        bw, bh = x2 - x1, y2 - y1
                        if bh < min_h or bw < min_w:
                            continue  # too small — not a real person
                        if bh / max(bw, 1) < 0.6:
                            continue  # very wide flat box — not a person
                        tid = int(row[4]) if len(row) > 4 else -1
                        cx  = (x1 + x2) / 2.0
                        cy  = (y1 + y2) / 2.0
                        detections.append({"track_id": tid, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": cx, "cy": cy})
                _post_workforce_detections(camera_id, detections, frame_copy, seq)
            except Exception as e:
                logger.debug(f"[wf_standalone] detector error camera {camera_id}: {e}")

    r_thread = threading.Thread(target=_wf_reader,   daemon=True, name=f"wf-reader-{camera_id}")
    d_thread = threading.Thread(target=_wf_detector, daemon=True, name=f"wf-detector-{camera_id}")
    r_thread.start()
    d_thread.start()

    with _workforce_standalone_lock:
        _workforce_standalone_pipelines[camera_id] = {"stop": stop, "reader": r_thread, "detector": d_thread}

    logger.info(f"[wf_standalone] Camera {camera_id} standalone pipeline started")
    return True


def stop_workforce_standalone(camera_id: int) -> None:
    """Stop the standalone workforce reader+detector for a camera."""
    with _workforce_standalone_lock:
        pipeline = _workforce_standalone_pipelines.pop(camera_id, None)
    if pipeline:
        pipeline["stop"].set()
        try:
            pipeline["reader"].join(timeout=1.0)
            pipeline["detector"].join(timeout=1.0)
        except Exception:
            pass
        release_capture(camera_id)
        # Clean up inbox + annotated
        _workforce_detection_inbox.pop(camera_id, None)
        ann = _workforce_annotated.pop(camera_id, None)
        logger.info(f"[wf_standalone] Camera {camera_id} standalone pipeline stopped")


def is_workforce_standalone_running(camera_id: int) -> bool:
    with _workforce_standalone_lock:
        p = _workforce_standalone_pipelines.get(camera_id)
    return p is not None and not p["stop"].is_set()


# ─────────────────────────────────────────────────────────────
# Activity standalone reader pipeline (used when neither PPE nor Workforce runs)
# Posts to _activity_detection_inbox just like _post_workforce_detections does.
# ─────────────────────────────────────────────────────────────

def start_activity_standalone(camera_id: int, rtsp_url: str, transport: str = "tcp") -> bool:
    """
    Start a standalone reader+detector for activity when PPE and Workforce are NOT running.
    Posts to _activity_detection_inbox using the same ByteTrack pipeline.
    """
    with _activity_standalone_lock:
        existing = _activity_standalone_pipelines.get(camera_id)
        if existing is not None and not existing["stop"].is_set():
            return True  # already running

    cap = acquire_capture(camera_id, rtsp_url, transport)
    if cap is None:
        return False

    fresh = {"frame": None, "seq": 0, "lock": threading.Lock()}
    stop  = threading.Event()

    def _act_reader():
        consecutive_failures = 0
        while not stop.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    logger.warning(f"[act_standalone] Camera {camera_id} disconnected")
                    stop.set()
                    break
                time.sleep(0.1)
                continue
            consecutive_failures = 0
            with fresh["lock"]:
                fresh["frame"] = frame
                fresh["seq"]  += 1

    def _act_detector():
        last_seq = -1
        while not stop.is_set():
            with fresh["lock"]:
                frame = fresh["frame"]
                seq   = fresh["seq"]
            if frame is None or seq == last_seq:
                time.sleep(0.01)
                continue
            last_seq = seq
            frame_copy = frame.copy()
            H, W = frame_copy.shape[:2]

            if _stage1 is None:
                time.sleep(0.05)
                continue
            try:
                r1 = _stage1.predict(
                    source=frame_copy,
                    classes=[0],
                    conf=0.30,
                    imgsz=960,
                    device=DEVICE,
                    half=USE_HALF,
                    verbose=False,
                )
                bt = _get_or_create_bytetracker(camera_id)
                tracked = bt.update(r1[0].boxes.cpu(), frame_copy)
                detections = []
                min_h = H * 0.03
                min_w = W * 0.015
                if tracked is not None and len(tracked) > 0:
                    for row in tracked:
                        x1, y1, x2, y2 = int(row[0]), int(row[1]), int(row[2]), int(row[3])
                        bw, bh = x2 - x1, y2 - y1
                        if bh < min_h or bw < min_w:
                            continue
                        if bh / max(bw, 1) < 0.6:
                            continue
                        tid = int(row[4]) if len(row) > 4 else -1
                        cx  = (x1 + x2) / 2.0
                        cy  = (y1 + y2) / 2.0
                        detections.append({"track_id": tid, "x1": x1, "y1": y1, "x2": x2, "y2": y2, "cx": cx, "cy": cy})
                _post_activity_detections(camera_id, detections, frame_copy, seq)
            except Exception as e:
                logger.debug(f"[act_standalone] detector error camera {camera_id}: {e}")

    r_thread = threading.Thread(target=_act_reader,   daemon=True, name=f"act-reader-{camera_id}")
    d_thread = threading.Thread(target=_act_detector, daemon=True, name=f"act-detector-{camera_id}")
    r_thread.start()
    d_thread.start()

    with _activity_standalone_lock:
        _activity_standalone_pipelines[camera_id] = {"stop": stop, "reader": r_thread, "detector": d_thread}

    logger.info(f"[act_standalone] Camera {camera_id} standalone pipeline started")
    return True


def stop_activity_standalone(camera_id: int) -> None:
    """Stop the standalone activity reader+detector for a camera."""
    with _activity_standalone_lock:
        pipeline = _activity_standalone_pipelines.pop(camera_id, None)
    if pipeline:
        pipeline["stop"].set()
        try:
            pipeline["reader"].join(timeout=1.0)
            pipeline["detector"].join(timeout=1.0)
        except Exception:
            pass
        release_capture(camera_id)
        _activity_detection_inbox.pop(camera_id, None)
        _activity_annotated.pop(camera_id, None)
        logger.info(f"[act_standalone] Camera {camera_id} standalone pipeline stopped")


def is_activity_standalone_running(camera_id: int) -> bool:
    with _activity_standalone_lock:
        p = _activity_standalone_pipelines.get(camera_id)
    return p is not None and not p["stop"].is_set()


# ─────────────────────────────────────────────────────────────
# EQUIPMENT STANDALONE PIPELINE (Grounding DINO)
# Starts a standalone RTSP reader + Grounding DINO detection thread
# for cameras where equipment_enabled=True but no PPE pipeline is active.
# Posts detections to _equipment_detection_inbox for EquipmentProcessor.
# ─────────────────────────────────────────────────────────────

# Grounding DINO model singleton (loaded lazily on first equipment feature enable)
_gdino_model = None
_gdino_processor = None
_gdino_lock = threading.Lock()
_gdino_available = False


def _load_groundingdino():
    """Lazy-load YOLO-World model. Called once when first equipment branch starts."""
    global _gdino_model, _gdino_processor, _gdino_available
    with _gdino_lock:
        if _gdino_model is not None:
            _gdino_available = True
            return True
        try:
            from ultralytics import YOLO
            import torch
            import os
            _model_path = os.path.join(os.path.dirname(__file__), "..", "..", "ml", "tracking", "yolov8m-worldv2.pt")
            _model_path = os.path.normpath(_model_path)
            _gdino_model = YOLO(_model_path)
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
            _gdino_model.to(device)
            _gdino_available = True
            logger.info(f"✅ YOLO-World medium loaded from local path (device={device})")
            return True
        except Exception as e:
            logger.warning(f"YOLO-World unavailable — equipment detection disabled: {e}")
            _gdino_model = None
            _gdino_available = False
            return False


def _run_groundingdino(frame_bgr, prompt: str, conf_thresh: float = 0.35) -> list:
    """
    Run YOLO-World on a single BGR frame.
    Returns list of dicts: {label, x1, y1, x2, y2, cx, cy, score}.
    Thread-safe — called from thread-pool in the equipment standalone detector.
    Skips inference if model not loaded (returns []).
    """
    if not _gdino_available or _gdino_model is None:
        return []
    try:
        import numpy as np

        H, W = frame_bgr.shape[:2]

        # Set classes from prompt — split on comma or period, strip whitespace
        classes = [c.strip().rstrip(".") for c in prompt.replace(".", ",").split(",") if c.strip()]
        _gdino_model.set_classes(classes)

        results = _gdino_model.predict(frame_bgr, conf=conf_thresh, verbose=False)
        detections = []
        if results:
            r = results[0]
            for box, score, cls_idx in zip(
                r.boxes.xyxy.tolist(),
                r.boxes.conf.tolist(),
                r.boxes.cls.tolist(),
            ):
                x1, y1, x2, y2 = [int(v) for v in box]
                label = classes[int(cls_idx)] if int(cls_idx) < len(classes) else str(int(cls_idx))
                detections.append({
                    "label": label,
                    "score": float(score),
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "cx": (x1 + x2) / 2.0,
                    "cy": (y1 + y2) / 2.0,
                })
        return detections
    except Exception as e:
        logger.debug(f"[yoloworld] inference error: {e}")
        return []


def start_equipment_standalone(
    camera_id: int,
    rtsp_url: str,
    transport: str = "tcp",
    prompt: str = "crane. excavator. concrete truck. dump truck. bulldozer. forklift. compactor.",
    conf_thresh: float = 0.35,
) -> bool:
    """
    Start standalone RTSP reader + Grounding DINO detector for equipment.
    Posts to _equipment_detection_inbox for EquipmentProcessor to consume.
    """
    with _equipment_standalone_lock:
        existing = _equipment_standalone_pipelines.get(camera_id)
        if existing is not None and not existing["stop"].is_set():
            return True  # already running

    # Ensure Grounding DINO is loaded
    if not _load_groundingdino():
        logger.warning(f"[eq_standalone] Camera {camera_id}: Grounding DINO not available — equipment detection skipped")
        # Still return True so branch doesn't fail; processor will get empty frames
        # and produce zero counts (no crash, feature shows as enabled but inactive).

    cap = acquire_capture(camera_id, rtsp_url, transport)
    if cap is None:
        return False

    fresh = {"frame": None, "seq": 0, "lock": threading.Lock()}
    stop  = threading.Event()

    def _eq_reader():
        consecutive_failures = 0
        while not stop.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    logger.warning(f"[eq_standalone] Camera {camera_id} disconnected")
                    stop.set()
                    break
                time.sleep(0.1)
                continue
            consecutive_failures = 0
            with fresh["lock"]:
                fresh["frame"] = frame
                fresh["seq"]  += 1

    def _eq_detector():
        import concurrent.futures
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="gdino")
        last_seq   = -1
        pending_future = None
        pending_frame  = None
        pending_seq    = -1

        while not stop.is_set():
            with fresh["lock"]:
                frame = fresh["frame"]
                seq   = fresh["seq"]

            # Collect finished future
            if pending_future is not None and pending_future.done():
                try:
                    detections = pending_future.result()
                    _post_equipment_detections(camera_id, detections, pending_frame, pending_seq)
                except Exception as e:
                    logger.debug(f"[eq_standalone] gdino result error: {e}")
                pending_future = None

            # Submit new frame if no work in flight
            if frame is not None and seq != last_seq and pending_future is None:
                last_seq = seq
                frame_copy = frame.copy()
                pending_frame = frame_copy
                pending_seq   = seq
                pending_future = executor.submit(_run_groundingdino, frame_copy, prompt, conf_thresh)
            else:
                time.sleep(0.02)

        executor.shutdown(wait=False)

    r_thread = threading.Thread(target=_eq_reader,   daemon=True, name=f"eq-reader-{camera_id}")
    d_thread = threading.Thread(target=_eq_detector, daemon=True, name=f"eq-detector-{camera_id}")
    r_thread.start()
    d_thread.start()

    with _equipment_standalone_lock:
        _equipment_standalone_pipelines[camera_id] = {"stop": stop, "reader": r_thread, "detector": d_thread}

    logger.info(f"[eq_standalone] Camera {camera_id} standalone pipeline started")
    return True


def stop_equipment_standalone(camera_id: int) -> None:
    """Stop the standalone equipment reader+detector for a camera."""
    with _equipment_standalone_lock:
        pipeline = _equipment_standalone_pipelines.pop(camera_id, None)
    if pipeline:
        pipeline["stop"].set()
        try:
            pipeline["reader"].join(timeout=1.0)
            pipeline["detector"].join(timeout=1.0)
        except Exception:
            pass
        release_capture(camera_id)
        _equipment_detection_inbox.pop(camera_id, None)
        _equipment_annotated.pop(camera_id, None)
        logger.info(f"[eq_standalone] Camera {camera_id} standalone pipeline stopped")


def is_equipment_standalone_running(camera_id: int) -> bool:
    with _equipment_standalone_lock:
        p = _equipment_standalone_pipelines.get(camera_id)
    return p is not None and not p["stop"].is_set()


# ─────────────────────────────────────────────────────────────
# PPE INCIDENT EVENT HOOKS
# Per-camera post-violation clip collector.  Populated inside _inferencer only.
# _reader is never touched.
# ─────────────────────────────────────────────────────────────
_clip_collectors: dict = {}  # (camera_id, track_id) -> {"frames": list, "remaining": int, "camera_id": int, "track_id": int}

# Lazy import so the stream module loads even if incident_event_queue is not yet
# initialised (e.g. during unit tests).  Queues are module-level singletons so
# this reference is stable after first access.
def _get_incident_queue():
    try:
        from ...services.incident_event_queue import incident_queue
        return incident_queue
    except Exception:
        return None

def _try_enqueue_incident(event: dict) -> bool:
    try:
        from ...services.incident_event_queue import try_enqueue
        return try_enqueue(event)
    except Exception:
        return False

def _get_clip_queue():
    try:
        from ...services.incident_event_queue import clip_queue
        return clip_queue
    except Exception:
        return None

# ─────────────────────────────────────────────────────────────
# DEVICE
# ─────────────────────────────────────────────────────────────
try:
    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    if torch.cuda.is_available():
        torch.backends.cudnn.benchmark = True
except ImportError:
    DEVICE = "cpu"

USE_HALF = DEVICE == "cuda"

# ─────────────────────────────────────────────────────────────
# STATE MACHINE STATES
# ─────────────────────────────────────────────────────────────
ST_CHECKING  = "checking"
ST_COMPLIANT = "compliant"
ST_VIOLATION = "violation"
ST_UNCERTAIN = "uncertain"
ST_LOST      = "lost"

# ─────────────────────────────────────────────────────────────
# PERSON TRACKING (per-frame state)
# ─────────────────────────────────────────────────────────────
class PersonTrack:
    """Track a single person with PPE + ReID state."""
    def __init__(self, track_id: int):
        self.track_id            = track_id
        self.state               = ST_CHECKING
        self.frames_seen         = 0
        self.frames_lost         = 0
        self.compliant_streak    = 0
        self.violation_streak    = 0
        self.uncertain_streak    = 0
        self.overlap_streak      = 0
        self.frames_since_alert  = 0
        self.alert_count            = 0
        self.has_helmet          = False
        self.has_vest            = False
        self.entry_time          = time.time()
        self.first_seen_at       = time.time()   # for dwell time in PPE overlay

        # ReID state
        self.global_id             = None
        self.embedding_assigned    = False
        self.embedding_frame_count = 0
        # ReID quality + delayed assignment
        self.reid_quality_score    = 0.0   # latest crop quality score (0–1)
        self._pending_embeddings: list = []  # buffer before first FAISS assignment
        self._pending_qualities:  list = []  # quality score per pending embedding
        self.id_locked             = False   # once True, global_id never changes this track

    def update(self, has_helmet: bool, has_vest: bool, is_uncertain: bool,
               cfg: dict) -> bool:
        """Update state machine, return True if new violation alert triggered."""
        self.frames_seen        += 1
        self.frames_lost         = 0
        self.frames_since_alert += 1

        if is_uncertain:
            self.uncertain_streak += 1
            if self.state in (ST_COMPLIANT, ST_VIOLATION):
                if self.uncertain_streak >= cfg["uncertain_frames_to_fallback"]:
                    self.state = ST_UNCERTAIN
            else:
                self.state = ST_UNCERTAIN
            return False

        self.uncertain_streak = 0
        self.has_helmet       = has_helmet
        self.has_vest         = has_vest
        compliant             = has_helmet and has_vest

        if compliant:
            self.compliant_streak += 1
            self.violation_streak  = 0
            if self.compliant_streak >= cfg["confirm_frames"]:
                self.state = ST_COMPLIANT
        else:
            self.violation_streak += 1
            self.compliant_streak  = 0
            if self.violation_streak >= cfg["violation_frames"]:
                self.state = ST_VIOLATION
                if (self.violation_streak >= cfg["violation_frames"] and
                        (self.alert_count == 0 or
                         self.frames_since_alert >= cfg["alert_cooldown_frames"])):
                    self.frames_since_alert = 0
                    self.alert_count += 1
                    return True
        return False

    def mark_lost(self) -> bool:
        self.frames_lost += 1
        return False  # Note: removal handled by caller with lost_frames check

# ─────────────────────────────────────────────────────────────
# REID SUPPORT
# ─────────────────────────────────────────────────────────────
def _make_faiss_index(dim: int):
    """
    Create a FAISS HNSW index for O(log N) approximate nearest-neighbor search.
    Falls back to IndexFlatIP if HNSW construction fails.
    L2-normalized embeddings are used so inner product = cosine similarity.
    """
    try:
        import faiss
        hnsw = faiss.IndexHNSWFlat(dim, 32, faiss.METRIC_INNER_PRODUCT)
        hnsw.hnsw.efConstruction = 200         # Build quality
        hnsw.hnsw.efSearch = 64                # Search quality (~99% recall for 512-dim)
        return hnsw
    except Exception:
        import faiss
        return faiss.IndexFlatIP(dim)


class GlobalIDManager:
    """
    FAISS-backed global ID manager for person re-identification.

    Enterprise improvements:
    - Two-threshold matching: strict assign_thresh for new persons,
      lenient match_thresh for returning persons (is_rematch=True).
    - Top-K embedding gallery per identity: keeps up to identity_top_k
      best-quality embeddings per global_id so matching uses the full
      identity set rather than a single averaged vector.
    - Gallery eviction: remove weak/stale identities when gallery exceeds
      max_gallery_size.
    - HNSW index: O(log N) search instead of O(N) for large galleries.
    - Per-identity last_seen timestamps for age-based eviction.
    """

    def __init__(self, dim: int = 512, assign_thresh: float = 0.86,
                 match_thresh: float = 0.72, identity_top_k: int = 5,
                 cross_camera_thresh: float = 0.40):
        self.dim                 = dim
        self.assign_thresh       = assign_thresh       # strict: first-time gallery entry
        self.match_thresh        = match_thresh        # lenient: returning identity re-match
        self.cross_camera_thresh = cross_camera_thresh # cross-camera active confirmation
        self.identity_top_k  = identity_top_k
        self.next_id         = 0
        self.id_map          = []              # FAISS row index → global_id
        self._embeddings     = []              # kept for persistence compat (flat list)
        # Top-K gallery: global_id → [(quality, normalised_embedding), ...] sorted desc
        self._identity_embeddings: dict = {}
        # Age tracking: global_id → unix timestamp of last successful match
        self._identity_last_seen: dict[int, float] = {}
        self._dirty          = False           # True when buckets changed but index not rebuilt
        try:
            self.index = _make_faiss_index(dim)
        except ImportError:
            self.index = None
            logger.warning("FAISS not available — global ID disabled")

    def _normalise(self, emb: np.ndarray) -> np.ndarray:
        norm = np.linalg.norm(emb)
        if norm < 1e-6:
            return np.zeros(self.dim, dtype=np.float32)
        return (emb / norm).astype(np.float32)

    def assign(
        self,
        embedding: np.ndarray,
        quality: float = 1.0,
        state_memory=None,
        active_tracks: dict | None = None,
        track_key: tuple | None = None,
        now_s: float | None = None,
        active_ttl_s: float = 2.5,
        override_assign_thresh: float | None = None,
    ) -> int:
        """
        Assign or match embedding to a global ID using two-pass thresholding.

        Pass 1 — strict assign_thresh: match if the gallery already knows this person.
        Pass 2 — lenient match_thresh: only if score is between the two thresholds
                  AND state_memory has recent snapshots (someone left recently → likely returning).

        Collision check: only blocks re-use of a global_id when the SAME camera has it
        assigned to a DIFFERENT track_id that is still fresh. Cross-camera multi-view of
        the same person is ALLOWED — that is the point of global identity.

        override_assign_thresh: temporary lower threshold (e.g. on camera reconnect)
                                 to improve re-matching existing identities.

        Buckets are marked dirty but NOT rebuilt here — call flush_if_dirty() once
        per inference cycle to do one FAISS rebuild regardless of how many persons
        were processed.
        """
        if self.index is None or embedding is None:
            return self._next_id_only()

        emb_norm = self._normalise(embedding).reshape(1, -1)

        if self.index.ntotal == 0:
            return self._new_id(emb_norm, quality)

        k = min(self.index.ntotal, 5)
        distances, indices = self.index.search(emb_norm, k)
        candidates = self._candidate_matches(distances, indices)

        now_s = float(time.time()) if now_s is None else float(now_s)
        effective_thresh = float(override_assign_thresh) if override_assign_thresh is not None else self.assign_thresh
        camera_id_curr = track_key[0] if track_key is not None else None
        track_id_curr  = track_key[1] if track_key is not None else None

        for score, gid in candidates:
            if gid is None:
                continue

            # Collision check: block only intra-camera false-positives.
            # Multiple cameras seeing the same person (cross-camera multi-view) is valid
            # and must NOT be blocked — that is how cross-camera identity works.
            if active_tracks is not None and camera_id_curr is not None:
                info = active_tracks.get(gid)
                if info is not None:
                    cam_entry = info.get("cameras", {}).get(camera_id_curr)
                    if cam_entry is not None:
                        same_cam_diff_track = cam_entry["track_id"] != track_id_curr
                        still_fresh = (now_s - float(cam_entry["last_seen"])) <= active_ttl_s
                        if same_cam_diff_track and still_fresh:
                            # Same camera, different track — likely FAISS false-positive
                            continue
                    # Different camera OR same camera same track → allow the match

            if score >= effective_thresh:
                self._add_bucket(gid, emb_norm.flatten(), quality)
                self._identity_last_seen[gid] = now_s
                return gid

            # Pass 2a: cross-camera active confirmation.
            # Another camera in the same project is currently tracking this gid and this is
            # a different camera — the person is in multi-view. Use a lower floor (0.40)
            # because viewpoint changes between cameras cause OSNet similarity to drop to
            # 0.40–0.55 even for the same person. The active_track entry is the safety net
            # that prevents false-positive matches with other workers in the scene.
            _other_cam_active = (
                active_tracks is not None
                and gid in active_tracks
                and camera_id_curr is not None
                and camera_id_curr not in active_tracks[gid].get("cameras", {})
            )
            if _other_cam_active and score >= self.cross_camera_thresh:
                self._add_bucket(gid, emb_norm.flatten(), quality)
                self._identity_last_seen[gid] = now_s
                return gid

            # Pass 2b: returning-person lenient match.
            # This specific gid has a state snapshot (person recently left frame).
            # Use match_thresh (0.58) — no viewpoint change expected for the same camera.
            _has_state_for_gid = (
                state_memory is not None
                and gid in state_memory._memory
            )
            if (
                self.match_thresh <= score < effective_thresh
                and _has_state_for_gid
            ):
                self._add_bucket(gid, emb_norm.flatten(), quality)
                self._identity_last_seen[gid] = now_s
                return gid

        return self._new_id(emb_norm, quality)

    def _candidate_matches(self, distances, indices) -> list[tuple[float, int | None]]:
        candidates: list[tuple[float, int | None]] = []
        seen = set()
        for dist, idx in zip(distances[0], indices[0]):
            gid = self.id_map[int(idx)]
            if gid in seen:
                continue
            seen.add(gid)
            candidates.append((float(dist), gid))
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates

    def _add_bucket(self, global_id: int, emb_flat: np.ndarray, quality: float) -> None:
        """Append embedding to top-K bucket and mark index dirty (no rebuild)."""
        bucket = self._identity_embeddings.setdefault(global_id, [])
        bucket.append((quality, emb_flat))
        bucket.sort(key=lambda x: x[0], reverse=True)
        if len(bucket) > self.identity_top_k:
            bucket.pop()
        self._dirty = True

    # Keep old name as alias so persistence code (reid_persistence.py) still works
    def _add_to_identity(self, global_id: int, emb_flat: np.ndarray,
                         quality: float) -> None:
        self._add_bucket(global_id, emb_flat, quality)

    def flush_if_dirty(self) -> None:
        """Rebuild FAISS index once if any bucket changed this cycle. Call after Phase 4."""
        if self._dirty:
            self._rebuild_index()
            self._dirty = False

    def _new_id(self, emb_norm: np.ndarray, quality: float = 1.0) -> int:
        global_id = self.next_id
        self.next_id += 1
        flat = emb_norm.flatten()
        self._identity_embeddings[global_id] = [(quality, flat)]
        self._identity_last_seen[global_id] = time.time()
        self._dirty = True
        return global_id

    def _rebuild_index(self) -> None:
        """Rebuild FAISS index and id_map from _identity_embeddings (HNSW)."""
        if self.index is None:
            return
        all_embs   = []
        new_id_map = []
        for gid, bucket in self._identity_embeddings.items():
            for _, emb in bucket:
                all_embs.append(emb)
                new_id_map.append(gid)
        self.id_map      = new_id_map
        self._embeddings = all_embs  # kept for persistence compat
        self.index = _make_faiss_index(self.dim)
        if all_embs:
            arr = np.array(all_embs, dtype=np.float32)
            self.index.add(arr)

    def evict_weak_identities(self, min_trusted: int = 2) -> int:
        """
        Remove identities that have fewer than min_trusted embeddings in their
        bucket (insufficient evidence). Rebuilds FAISS index after eviction.
        Returns number of identities evicted.
        """
        to_remove = [
            gid for gid, bucket in self._identity_embeddings.items()
            if len(bucket) < min_trusted
        ]
        for gid in to_remove:
            del self._identity_embeddings[gid]
            self._identity_last_seen.pop(gid, None)
        if to_remove:
            self._rebuild_index()
            logger.info(f"[reid] Evicted {len(to_remove)} weak identities from gallery")
        return len(to_remove)

    def evict_stale_identities(self, max_age_days: float = 7.0) -> int:
        """
        Remove identities not seen for more than max_age_days.
        Prevents unbounded gallery growth when the soft-cap eviction is a no-op
        (all identities have ≥ min_trusted embeddings).
        """
        cutoff = time.time() - (max_age_days * 86400)
        to_remove = [
            gid for gid, last in self._identity_last_seen.items()
            if last < cutoff
        ]
        for gid in to_remove:
            self._identity_embeddings.pop(gid, None)
            self._identity_last_seen.pop(gid, None)
        if to_remove:
            self._rebuild_index()
            logger.info(f"[reid] Evicted {len(to_remove)} stale identities (>{max_age_days:.1f}d ago)")
        return len(to_remove)

    def _next_id_only(self) -> int:
        """Allocate a new global_id without adding to FAISS (no embedding available)."""
        gid = self.next_id
        self.next_id += 1
        return gid

    @property
    def total_identities(self) -> int:
        return len(self._identity_embeddings)


class GlobalStateMemory:
    """Store compliance state per global ID."""
    def __init__(self):
        self._memory = {}

    def save(self, global_id: int, track) -> None:
        self._memory[global_id] = {
            "state": track.state,
            "compliant_streak": track.compliant_streak,
            "violation_streak": track.violation_streak,
            "has_helmet": track.has_helmet,
            "has_vest": track.has_vest,
            "frames_since_alert": track.frames_since_alert,
            "saved_at": time.time(),
        }

    def restore(self, global_id: int, track, max_age_s: float = 90.0) -> bool:
        snap = self._memory.get(global_id)
        if snap is None:
            return False
        age = time.time() - snap["saved_at"]
        if age > max_age_s:
            del self._memory[global_id]
            return False
        track.state = snap["state"]
        track.compliant_streak = snap["compliant_streak"]
        track.violation_streak = snap["violation_streak"]
        track.has_helmet = snap["has_helmet"]
        track.has_vest = snap["has_vest"]
        track.frames_since_alert = snap["frames_since_alert"]
        logger.info(f"State restored: G-{global_id} → {snap['state']} (age {age:.1f}s)")
        return True

# ─────────────────────────────────────────────────────────────
# PER-CAMERA SINGLETONS (capture + tracker stay per-camera)
# ─────────────────────────────────────────────────────────────
_camera_captures = {}
_camera_track_registries = {}
# Per-camera BYTETracker instances — each camera gets its own tracker so that
# calling _stage1.predict() (shared GPU model, no internal state) + feeding
# detections into a dedicated tracker prevents cross-camera state corruption.
_camera_bytetrackers = {}

def _get_or_create_bytetracker(camera_id: int) -> "BYTETracker":
    if camera_id not in _camera_bytetrackers:
        from ultralytics.trackers import BYTETracker
        from ultralytics.utils import YAML, IterableSimpleNamespace
        from ultralytics.utils.checks import check_yaml
        tracker_yaml = check_yaml("bytetrack.yaml")
        cfg_bt = IterableSimpleNamespace(**YAML.load(tracker_yaml))
        _camera_bytetrackers[camera_id] = BYTETracker(cfg_bt, frame_rate=30)
    return _camera_bytetrackers[camera_id]

# ── PER-PROJECT REID SINGLETONS ───────────────────────────────────────────────
# One FAISS index + state memory + active tracking dict PER PROJECT so that
# global_id is isolated to a project (different construction sites don't share
# identities).  Protected by per-project locks so Project A and Project B
# don't serialize each other during inference.
_project_faiss_managers:    dict[int, GlobalIDManager]   = {}  # project_id → manager
_project_state_memories:    dict[int, GlobalStateMemory] = {}  # project_id → memory
_project_reid_locks:        dict[int, threading.Lock]    = {}  # project_id → lock
# Multi-camera active tracking: project_id → {global_id → {"cameras": {cam_id: {"track_id", "last_seen"}}, "last_seen"}}
_project_active_global_ids: dict[int, dict]              = {}
# Reverse map so stop_camera_background knows which project to save
_camera_project_ids:        dict[int, int]               = {}  # camera_id → project_id
# Reconnect timestamps for grace-period lower threshold (Fix 5)
_camera_reconnect_timestamps: dict[int, float]           = {}


def _get_project_reid_context(project_id: int, cfg: dict):
    """
    Return (faiss_manager, state_memory, reid_lock, active_ids) for the project.
    Creates per-project instances on first call. Thread-safe via a bootstrap lock.
    """
    # Fast path: all four already exist
    if (project_id in _project_faiss_managers and
            project_id in _project_state_memories and
            project_id in _project_reid_locks and
            project_id in _project_active_global_ids):
        mgr = _project_faiss_managers[project_id]
        # Sync config thresholds without re-creating
        if "reid_assign_thresh" in cfg:
            mgr.assign_thresh = float(cfg["reid_assign_thresh"])
        if "reid_match_thresh" in cfg:
            mgr.match_thresh = float(cfg["reid_match_thresh"])
        if "reid_identity_top_k" in cfg:
            mgr.identity_top_k = int(cfg["reid_identity_top_k"])
        if "reid_cross_camera_thresh" in cfg:
            mgr.cross_camera_thresh = float(cfg["reid_cross_camera_thresh"])
        return (
            mgr,
            _project_state_memories[project_id],
            _project_reid_locks[project_id],
            _project_active_global_ids[project_id],
        )

    # Slow path: first call for this project — use a module-level bootstrap lock
    with _reid_bootstrap_lock:
        if project_id not in _project_reid_locks:
            _project_reid_locks[project_id] = threading.Lock()
        if project_id not in _project_faiss_managers:
            # Try to load persisted gallery for this project
            try:
                from ...services.reid_persistence import load_gallery
                mgr, sm = load_gallery(project_id=project_id)
            except Exception:
                mgr, sm = None, None
            if mgr is None:
                mgr = GlobalIDManager(
                    dim=512,
                    assign_thresh=cfg.get("reid_assign_thresh", 0.65),
                    match_thresh=cfg.get("reid_match_thresh", 0.58),
                    identity_top_k=cfg.get("reid_identity_top_k", 5),
                    cross_camera_thresh=cfg.get("reid_cross_camera_thresh", 0.40),
                )
            else:
                if "reid_assign_thresh" in cfg:
                    mgr.assign_thresh = float(cfg["reid_assign_thresh"])
                if "reid_match_thresh" in cfg:
                    mgr.match_thresh = float(cfg["reid_match_thresh"])
                if "reid_identity_top_k" in cfg:
                    mgr.identity_top_k = int(cfg["reid_identity_top_k"])
                if "reid_cross_camera_thresh" in cfg:
                    mgr.cross_camera_thresh = float(cfg["reid_cross_camera_thresh"])
            _project_faiss_managers[project_id] = mgr
            _project_state_memories[project_id] = sm if sm is not None else GlobalStateMemory()
            _project_active_global_ids[project_id] = {}

    return (
        _project_faiss_managers[project_id],
        _project_state_memories[project_id],
        _project_reid_locks[project_id],
        _project_active_global_ids[project_id],
    )


_reid_bootstrap_lock = threading.Lock()  # Guards first-time per-project init only


def _update_active_ids(active_ids: dict, global_id: int,
                       camera_id: int, track_id: int, now_s: float) -> None:
    """
    Record that global_id was seen on camera_id/track_id at now_s.
    Multiple cameras can share the same global_id simultaneously (multi-view).
    """
    entry = active_ids.setdefault(global_id, {"cameras": {}, "last_seen": now_s})
    entry["cameras"][camera_id] = {"track_id": track_id, "last_seen": now_s}
    entry["last_seen"] = max(entry.get("last_seen", now_s), now_s)


def _purge_stale_active_global_ids(active_ids: dict, now_s: float, ttl_s: float) -> None:
    """
    Evict per-camera entries that haven't been seen within ttl_s.
    Remove the global_id entry entirely when no camera entries remain.
    """
    to_remove_gids = []
    for gid, info in active_ids.items():
        stale_cams = [
            cid for cid, c in info.get("cameras", {}).items()
            if (now_s - float(c.get("last_seen", 0.0))) > ttl_s
        ]
        for cid in stale_cams:
            del info["cameras"][cid]
        if not info.get("cameras"):
            to_remove_gids.append(gid)
    for gid in to_remove_gids:
        del active_ids[gid]

# ─────────────────────────────────────────────────────────────
# DETECTION HELPERS
# ─────────────────────────────────────────────────────────────
def _release_missing_camera_tracks_for_reid(
    active_ids: dict,
    state_memory,
    track_registry: dict,
    camera_id: int,
    seen_ids: set,
) -> None:
    """
    Let ReID recover from same-camera ByteTrack ID switches.

    ByteTrack can briefly drop a worker during motion/blur and return the same
    person with a new local track_id. If the old global_id remains marked active
    for this camera, the collision guard correctly blocks two simultaneous boxes
    from sharing one G-ID, but it also blocks this handoff case. As soon as the
    old local track is absent from the current frame, release only this camera's
    active claim and save state memory so the new local track may match the old
    global_id using the returning-person threshold.
    """
    for tid, track in list(track_registry.items()):
        gid = getattr(track, "global_id", None)
        if gid is None or tid in seen_ids:
            continue

        if state_memory is not None:
            state_memory.save(int(gid), track)

        entry = active_ids.get(int(gid)) if active_ids is not None else None
        if entry is None:
            continue
        entry.get("cameras", {}).pop(camera_id, None)
        if not entry.get("cameras"):
            active_ids.pop(int(gid), None)


def clamp_box(x1, y1, x2, y2, W, H):
    """Clamp box to frame bounds."""
    return (
        max(0, min(int(x1), W-1)),
        max(0, min(int(y1), H-1)),
        max(0, min(int(x2), W-1)),
        max(0, min(int(y2), H-1)),
    )

def is_frame_blurry(frame, threshold: float) -> bool:
    """Check if frame is too blurry."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    return cv2.Laplacian(gray, cv2.CV_64F).var() < threshold

def find_overlapping_indices(all_boxes, thresh: float) -> set:
    """Find overlapping person bboxes (symmetric true IoU so both persons are marked uncertain)."""
    def iou(a, b):
        ix1=max(a[0],b[0]); iy1=max(a[1],b[1])
        ix2=min(a[2],b[2]); iy2=min(a[3],b[3])
        if ix2<=ix1 or iy2<=iy1: return 0.0
        inter=(ix2-ix1)*(iy2-iy1)
        area_a=(a[2]-a[0])*(a[3]-a[1])
        area_b=(b[2]-b[0])*(b[3]-b[1])
        union=area_a+area_b-inter
        return inter/union if union>0 else 0.0
    overlapping=set()
    for i in range(len(all_boxes)):
        for j in range(i+1,len(all_boxes)):
            if iou(all_boxes[i],all_boxes[j])>thresh:
                overlapping.add(i); overlapping.add(j)
    return overlapping

def extract_embedding(crop: np.ndarray) -> np.ndarray:
    """Extract ReID embedding from person crop."""
    if _reid_model is None or crop is None or crop.size == 0:
        return None
    if crop.shape[0] < 32 or crop.shape[1] < 16:
        return None
    try:
        features = _reid_model([crop])
        embedding = features.cpu().numpy().flatten().astype(np.float32)
        return embedding
    except Exception as e:
        logger.debug(f"ReID embedding failed: {e}")
        return None


def extract_embeddings_batch(crops: list) -> list:
    """Extract ReID embeddings for multiple crops in ONE OSNet call (faster than N separate calls)."""
    if _reid_model is None or not crops:
        return [None] * len(crops)
    valid_indices = [i for i, c in enumerate(crops) if c is not None and c.size > 0
                     and c.shape[0] >= 32 and c.shape[1] >= 16]
    if not valid_indices:
        return [None] * len(crops)
    try:
        valid_crops = [crops[i] for i in valid_indices]
        features = _reid_model(valid_crops)  # Single OSNet call for all crops
        embeddings_np = features.cpu().numpy().astype(np.float32)
        results = [None] * len(crops)
        for k, idx in enumerate(valid_indices):
            results[idx] = embeddings_np[k]
        return results
    except Exception as e:
        logger.debug(f"Batch ReID failed: {e}")
        return [None] * len(crops)


def _compute_reid_quality(meta: dict, track) -> float:
    """
    Compute a ReID crop quality score in [0.0, 1.0].
    Uses signals already in meta (no new GPU calls).
    Returns 0.0 (hard reject) for skipped/blurry/uncertain crops.
    """
    if meta is None or meta.get("skip"):
        return 0.0
    # Uncertain state = unreliable PPE result, unreliable body pose
    if track.state == ST_UNCERTAIN:
        return 0.0
    crop = meta.get("crop")
    if crop is None or crop.size == 0:
        return 0.0

    score = 0.5  # base
    h, w = crop.shape[:2]
    if w >= 80 and h >= 120:
        score += 0.2
    # Crop-level blur check (not frame-level)
    try:
        lap = cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        if lap < 30.0:
            return 0.0   # hard reject: blurry crop
        if lap > 80.0:
            score += 0.15
    except Exception:
        return 0.0
    # State bonus: confirmed compliance state = stable pose = better embedding
    if track.state in (ST_COMPLIANT, ST_VIOLATION):
        score += 0.15
    return min(score, 1.0)


def _prepare_ppe_crop(frame, x1, y1, x2, y2, cfg: dict) -> dict:
    """Validate person bbox and extract padded crop. Returns metadata dict (no GPU call)."""
    H, W = frame.shape[:2]
    pw, ph = x2-x1, y2-y1
    min_h = cfg.get("min_crop_height", 60)
    min_w = cfg.get("min_crop_width", 40)

    if pw < min_w or ph < min_h:
        return {"skip": True, "reason": f"too_small({pw}x{ph})", "crop": None}
    head_cutoff = cfg.get("head_cutoff_px", 5)
    if y1 <= head_cutoff:
        return {"skip": True, "reason": "head_cut_off", "crop": None}
    # Fix 4: side-of-frame entry — head clipped horizontally by left/right edge
    side_cutoff = cfg.get("side_cutoff_px", 20)
    if x1 <= side_cutoff or x2 >= (W - side_cutoff):
        return {"skip": True, "reason": "side_cut_off", "crop": None}
    legs_only_bottom = cfg.get("legs_only_bottom_px", 10)
    legs_only_max_h = cfg.get("legs_only_max_height", 100)
    if y2 >= (H - legs_only_bottom) and ph < legs_only_max_h:
        return {"skip": True, "reason": "legs_only", "crop": None}

    aspect = pw / ph if ph > 0 else 0.0
    crouching = aspect > cfg.get("crouching_aspect_ratio", 0.70)
    # Fix 2: extreme crouch — worker fully bent over, head at bottom of bbox
    extreme_crouch = aspect > cfg.get("extreme_crouch_aspect_ratio", 1.00)
    turned = aspect < cfg.get("turned_aspect_ratio", 0.28)
    # Fix 3: arms raised overhead — YOLO bbox extends up to raised fingertips, pushing
    # helmet into the middle of the normalized crop
    arms_raised = (aspect < cfg.get("arms_raised_aspect_ratio", 0.40) and
                   ph > H * cfg.get("arms_raised_height_ratio", 0.65))
    padding = cfg.get("padding", 0.30)
    pad_x = int(pw * padding); pad_top = int(ph * 0.35); pad_bottom = int(ph * 0.10)
    cx1 = max(0, x1 - pad_x); cy1 = max(0, y1 - pad_top)
    cx2 = min(W, x2 + pad_x); cy2 = min(H, y2 + pad_bottom)

    if cx2 <= cx1 or cy2 <= cy1:
        return {"skip": True, "reason": "invalid_crop", "crop": None}

    crop = frame[cy1:cy2, cx1:cx2]
    if crop.size == 0:
        return {"skip": True, "reason": "empty_crop", "crop": None}

    # Fix 5: crop-level blur guard — blurry crop from fast movement returns uncertain
    try:
        lap = cv2.Laplacian(cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F).var()
        if lap < cfg.get("crop_blur_thresh", 25.0):
            return {"skip": True, "reason": "blurry_crop", "crop": None}
    except Exception:
        pass  # if blur check fails, proceed with inference

    stage2_conf = cfg.get("stage2_conf", 0.30)
    helmet_mult = cfg.get("helmet_conf_multiplier", 1.00)
    vest_mult = cfg.get("vest_conf_multiplier", 0.75)
    turned_mult = cfg.get("turned_conf_multiplier", 0.75)
    helmet_conf = stage2_conf * helmet_mult
    vest_conf = stage2_conf * vest_mult
    if turned:
        helmet_conf *= turned_mult
        vest_conf *= turned_mult

    # Determine helmet region bottom limit based on pose
    if extreme_crouch:
        helmet_bottom_max = cfg.get("helmet_region_bottom_max_extreme_crouch", 0.90)
    elif crouching:
        helmet_bottom_max = cfg.get("helmet_region_bottom_max_crouching", 0.72)
    elif arms_raised:
        helmet_bottom_max = cfg.get("helmet_region_bottom_max_arms_raised", 0.70)
    else:
        helmet_bottom_max = cfg.get("helmet_region_bottom_max_normal", 0.55)

    return {
        "skip": False, "crop": crop, "crop_h": crop.shape[0],
        "helmet_conf": helmet_conf, "vest_conf": vest_conf,
        "run_conf": min(helmet_conf, vest_conf), "crouching": crouching,
        "extreme_crouch": extreme_crouch, "turned": turned,
        "helmet_bottom_max": helmet_bottom_max,
    }


def _parse_ppe_result(boxes2, meta: dict, cfg: dict) -> dict:
    """Parse Stage 2 result boxes for one person crop (no GPU call)."""
    crop = meta["crop"]
    if boxes2 is None or len(boxes2) == 0:
        return {"has_helmet": False, "has_vest": False, "is_uncertain": False,
                "reason": "no_ppe_detected", "crop": crop}
    has_helmet = False; has_vest = False
    crop_h = meta["crop_h"]
    helmet_conf = meta["helmet_conf"]; vest_conf = meta["vest_conf"]
    helmet_bottom_max = meta["helmet_bottom_max"]
    vest_min = cfg.get("vest_region_center_min", 0.25)
    vest_max = cfg.get("vest_region_center_max", 0.90)
    # Fix 1: track best raw helmet confidence seen (even below threshold) for
    # the confidence-floor uncertain zone (covers tilted helmet, turned, bent,
    # hand over helmet — model saw something but pose prevented confident ID)
    best_helmet_raw_conf = 0.0
    for box in boxes2:
        cls_id = int(box.cls[0]); conf = float(box.conf[0])
        xyxy = box.xyxy[0]
        xyxy = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.array(xyxy)
        by1 = float(xyxy[1]) / crop_h if crop_h > 0 else 0.0
        by2 = float(xyxy[3]) / crop_h if crop_h > 0 else 1.0
        cy = (by1 + by2) / 2.0
        if cls_id == 0:
            if conf > best_helmet_raw_conf:
                best_helmet_raw_conf = conf
            if conf >= helmet_conf and by2 <= helmet_bottom_max:
                has_helmet = True
        elif cls_id == 1 and conf >= vest_conf:
            if vest_min <= cy <= vest_max: has_vest = True
    # If helmet was not confirmed but model saw a low-confidence candidate in a
    # challenging pose (turned / extreme crouch), defer judgment → uncertain
    # rather than recording a confident violation.
    if not has_helmet:
        uncertain_floor = cfg.get("uncertain_conf_floor", 0.12)
        is_challenging_pose = meta.get("turned", False) or meta.get("extreme_crouch", False)
        if is_challenging_pose and best_helmet_raw_conf >= uncertain_floor:
            return {"has_helmet": False, "has_vest": has_vest,
                    "is_uncertain": True, "reason": "pose_low_conf_helmet", "crop": crop}
    return {
        "has_helmet": has_helmet, "has_vest": has_vest, "is_uncertain": False,
        "reason": "compliant" if (has_helmet and has_vest) else "violation",
        "crop": crop,
    }


# ─────────────────────────────────────────────────────────────
# PPE OVERLAY DRAWING HELPERS
# ─────────────────────────────────────────────────────────────

def _ppe_blend_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                    color_bgr: tuple, alpha: float) -> None:
    """Alpha-blend a filled rectangle onto frame in-place."""
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(frame.shape[1] - 1, x2), min(frame.shape[0] - 1, y2)
    if x2 <= x1 or y2 <= y1:
        return
    roi     = frame[y1:y2, x1:x2]
    colored = np.full_like(roi, color_bgr, dtype=np.uint8)
    cv2.addWeighted(colored, alpha, roi, 1 - alpha, 0, roi)


def _ppe_rounded_rect(frame: np.ndarray, x1: int, y1: int, x2: int, y2: int,
                      color: tuple, thickness: int, radius: int = 8) -> None:
    """Draw a rounded-corner rectangle border."""
    r = min(radius, (x2 - x1) // 2, (y2 - y1) // 2)
    if r < 1:
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
        return
    cv2.line(frame,  (x1 + r, y1), (x2 - r, y1), color, thickness)
    cv2.line(frame,  (x1 + r, y2), (x2 - r, y2), color, thickness)
    cv2.line(frame,  (x1, y1 + r), (x1, y2 - r), color, thickness)
    cv2.line(frame,  (x2, y1 + r), (x2, y2 - r), color, thickness)
    cv2.ellipse(frame, (x1 + r, y1 + r), (r, r), 180,  0, 90, color, thickness)
    cv2.ellipse(frame, (x2 - r, y1 + r), (r, r), 270,  0, 90, color, thickness)
    cv2.ellipse(frame, (x1 + r, y2 - r), (r, r),  90,  0, 90, color, thickness)
    cv2.ellipse(frame, (x2 - r, y2 - r), (r, r),   0,  0, 90, color, thickness)


def draw_person(frame, x1, y1, x2, y2, track: PersonTrack, H, W, cfg: dict):
    """Draw premium PPE person box — workforce-consistent visual style."""
    import math as _math
    state = track.state
    FONT  = cv2.FONT_HERSHEY_SIMPLEX
    FONTB = cv2.FONT_HERSHEY_DUPLEX

    scale = max(0.75, min(2.0, W / 1280.0))

    # ── State colour + compliance text ───────────────────────────────────────
    if state == ST_COMPLIANT:
        color          = (50, 210, 80)
        compliance_txt = "COMPLIANT"
    elif state == ST_VIOLATION:
        color  = (40, 40, 220)
        parts  = []
        if not track.has_helmet: parts.append("NO HELMET")
        if not track.has_vest:   parts.append("NO VEST")
        compliance_txt = " | ".join(parts) if parts else "VIOLATION"
    elif state == ST_UNCERTAIN:
        color          = (20, 160, 255)
        compliance_txt = "UNCERTAIN"
    else:
        color          = (160, 160, 160)
        compliance_txt = "CHECKING..."

    # ── Aura glow at feet ────────────────────────────────────────────────────
    aura_ov = frame.copy()
    aura_r  = max(24, int(34 * scale))
    cx_foot = (x1 + x2) // 2
    cy_foot = min(y2 + 4, H - 1)
    cv2.circle(aura_ov, (cx_foot, cy_foot), aura_r + 10, color, -1)
    cv2.circle(aura_ov, (cx_foot, cy_foot), aura_r,      color, -1)
    cv2.addWeighted(aura_ov, 0.09, frame, 0.91, 0, frame)

    # ── Rounded bounding box ─────────────────────────────────────────────────
    bbox_thick = max(2, int(3 * scale))
    _ppe_rounded_rect(frame, x1, y1, x2, y2, color, bbox_thick, radius=6)
    bar_h = max(4, int(5 * scale))
    _ppe_blend_rect(frame, x1 + 2, y1 + 2, x2 - 2, y1 + bar_h + 2, color, alpha=0.55)

    # ── Floating dark tag above the person ───────────────────────────────────
    line1   = (f"P-{track.track_id:02d}  G-{track.global_id}"
               if track.global_id is not None
               else f"P-{track.track_id:02d}")
    line2   = compliance_txt

    fs1 = 0.62 * scale
    fs2 = 0.50 * scale
    th1 = max(1, int(scale))
    th2 = max(1, int(scale))

    (tw1, th1_sz), _ = cv2.getTextSize(line1, FONTB, fs1, th1)
    (tw2, th2_sz), _ = cv2.getTextSize(line2, FONT,  fs2, th2)

    pad_x, pad_y = int(10 * scale), int(7 * scale)
    tag_w = max(tw1, tw2) + pad_x * 2
    tag_h = th1_sz + th2_sz + pad_y * 2 + int(4 * scale)
    tag_x = max(0, min(x1, W - tag_w - 2))
    tag_y = max(tag_h + 2, y1 - int(6 * scale))

    _ppe_blend_rect(frame, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y, (8, 12, 20), alpha=0.88)
    _ppe_blend_rect(frame, tag_x, tag_y - tag_h,
                    tag_x + max(3, int(4 * scale)), tag_y, color, alpha=0.95)
    _ppe_rounded_rect(frame, tag_x, tag_y - tag_h, tag_x + tag_w, tag_y, color, 1, radius=4)

    line_y1 = tag_y - pad_y - th2_sz - int(4 * scale)
    line_y2 = tag_y - pad_y
    cv2.putText(frame, line1, (tag_x + pad_x, line_y1),
                FONTB, fs1, (240, 245, 255), th1, cv2.LINE_AA)
    cv2.putText(frame, line2, (tag_x + pad_x, line_y2),
                FONT,  fs2, color,           th2, cv2.LINE_AA)

    # ── Helmet / Vest pill badges (inside bbox, bottom-right) ────────────────
    pill_h   = max(16, int(22 * scale))
    pill_w   = max(28, int(36 * scale))
    pill_gap = max(3,  int(4 * scale))
    total_pw = pill_w * 2 + pill_gap
    pill_x   = max(x1, min(x2 - total_pw - 4, W - total_pw - 4))
    pill_y1  = max(y1, min(y2 - pill_h - 6, H - pill_h - 4))
    pill_y2  = pill_y1 + pill_h

    for i, (has_item, label_txt) in enumerate([(track.has_helmet, "H"), (track.has_vest, "V")]):
        px1 = pill_x + i * (pill_w + pill_gap)
        px2 = px1 + pill_w
        pc  = (50, 200, 70) if has_item else (40, 40, 200)
        _ppe_blend_rect(frame, px1, pill_y1, px2, pill_y2, pc, alpha=0.75)
        _ppe_rounded_rect(frame, px1, pill_y1, px2, pill_y2, pc, 1, radius=4)
        pill_label = f"{label_txt}:OK" if has_item else f"{label_txt}:NO"
        (ptw, pth), _ = cv2.getTextSize(pill_label, FONT, 0.40 * scale, 1)
        cv2.putText(frame, pill_label,
                    (px1 + (pill_w - ptw) // 2, pill_y1 + (pill_h + pth) // 2),
                    FONT, 0.40 * scale, (240, 245, 255), 1, cv2.LINE_AA)

    # ── Styled confidence / progress bar ─────────────────────────────────────
    bar_y = y2 + 4
    if bar_y < H - 10:
        bw     = x2 - x1
        bar_hh = max(6, int(8 * scale))
        _ppe_blend_rect(frame, x1, bar_y, x2, bar_y + bar_hh, (30, 30, 30), alpha=0.70)
        if track.uncertain_streak > 0 and state in (ST_COMPLIANT, ST_VIOLATION):
            frac   = min(track.uncertain_streak / max(cfg.get("uncertain_frames_to_fallback", 8), 1), 1.0)
            bcolor = (20, 140, 255)
        elif state in (ST_COMPLIANT, ST_CHECKING):
            frac   = min(track.compliant_streak  / max(cfg.get("confirm_frames", 8), 1), 1.0)
            bcolor = (50, 200, 70)
        else:
            frac   = min(track.violation_streak  / max(cfg.get("violation_frames", 8), 1), 1.0)
            bcolor = (40, 40, 200)
        bx2 = x1 + int(bw * frac)
        if bx2 > x1:
            _ppe_blend_rect(frame, x1, bar_y, bx2, bar_y + bar_hh, bcolor, alpha=0.85)


def _draw_ppe_summary_panel(frame: np.ndarray, track_registry: dict, H: int, W: int,
                             ppe_sparkline: list) -> None:
    """Draw PPE Site Summary Panel (top-right), workforce-panel style."""
    import math as _math
    if not track_registry:
        return

    scale = max(0.75, min(2.0, W / 1280.0))
    FONT  = cv2.FONT_HERSHEY_SIMPLEX
    FONTB = cv2.FONT_HERSHEY_DUPLEX

    total      = len(track_registry)
    compliant  = sum(1 for t in track_registry.values() if t.state == ST_COMPLIANT)
    violations = sum(1 for t in track_registry.values() if t.state == ST_VIOLATION)
    checking   = sum(1 for t in track_registry.values() if t.state == ST_CHECKING)
    comp_rate  = int(100 * compliant / total) if total > 0 else 100
    rate_color = (50, 210, 80) if comp_rate >= 90 else (20, 160, 255) if comp_rate >= 70 else (40, 40, 220)

    panel_w = int(265 * scale)
    panel_h = int(230 * scale)
    margin  = int(14 * scale)
    pad     = int(12 * scale)
    lh      = int(22 * scale)
    px      = W - panel_w - margin
    py      = margin
    px2     = px + panel_w
    py2     = py + panel_h

    # Dark background + blue top accent strip + rounded border (matches workforce/activity)
    _ppe_blend_rect(frame, px, py, px2, py2, (6, 10, 18), alpha=0.88)
    _ppe_blend_rect(frame, px, py, px2, py + max(3, int(3 * scale)), (80, 140, 220), alpha=0.95)
    _ppe_rounded_rect(frame, px, py, px2, py2, (70, 100, 140), max(1, int(scale)), radius=6)

    cy = py + int(20 * scale)

    # Title row (FONTB, light blue — matches "WORKFORCE STATUS" / "ACTIVITY STATUS")
    cv2.putText(frame, "PPE COMPLIANCE",
                (px + pad, cy), FONTB, 0.48 * scale, (120, 185, 255),
                max(1, int(scale)), cv2.LINE_AA)
    cy += int(4 * scale)
    cv2.line(frame,
             (px + pad, cy + int(3 * scale)),
             (px2 - pad, cy + int(3 * scale)),
             (50, 70, 100), 1)
    cy += int(10 * scale)

    # Big compliance rate (matches workforce big worker count)
    rate_txt = f"{comp_rate}%"
    (rw, rh), _ = cv2.getTextSize(rate_txt, FONTB, 1.1 * scale, max(1, int(scale + 0.5)))
    cv2.putText(frame, rate_txt,
                (px + pad, cy + int(lh * 0.9)),
                FONTB, 1.1 * scale, rate_color,
                max(1, int(scale + 0.5)), cv2.LINE_AA)
    cv2.putText(frame, "Compliance",
                (px + pad + rw + int(8 * scale), cy + int(lh * 0.9)),
                FONT, 0.45 * scale, (160, 175, 200),
                max(1, int(scale)), cv2.LINE_AA)
    cy += lh + int(4 * scale)

    # Worker count line
    cv2.putText(frame, f"Workers: {total}",
                (px + pad, cy + int(12 * scale)),
                FONT, 0.40 * scale, (160, 175, 200),
                max(1, int(scale)), cv2.LINE_AA)
    cy += int(18 * scale)

    # Vertical stat pills — compliant / violations / checking
    for lbl, val, col in [
        ("Compliant",  compliant,  (50, 200, 70)),
        ("Violations", violations, (40, 40, 200)),
        ("Checking",   checking,   (20, 160, 255)),
    ]:
        _ppe_blend_rect(frame, px + pad, cy,
                        px + pad + int(110 * scale), cy + int(18 * scale),
                        (int(col[0]*0.15), int(col[1]*0.15), int(col[2]*0.15)), alpha=0.80)
        cv2.putText(frame, f"  {val}  {lbl}",
                    (px + pad + int(4 * scale), cy + int(13 * scale)),
                    FONT, 0.40 * scale, col, max(1, int(scale)), cv2.LINE_AA)
        cy += int(20 * scale)

    # Compliance progress bar
    cy += int(4 * scale)
    bar_w2 = int(panel_w - pad * 2)
    bar_h2 = int(10 * scale)
    _ppe_blend_rect(frame, px + pad, cy, px + pad + bar_w2, cy + bar_h2, (30, 35, 45), alpha=0.90)
    fill_w = int(bar_w2 * comp_rate / 100)
    if fill_w > 0:
        _ppe_blend_rect(frame, px + pad, cy, px + pad + fill_w, cy + bar_h2, rate_color, alpha=0.85)
    cy += bar_h2

    # Sparkline (last 20 compliance readings)
    if len(ppe_sparkline) > 1:
        sl_x1 = px + pad
        sl_x2 = px2 - pad
        sl_y2 = py2 - int(8 * scale)
        sl_y1 = sl_y2 - max(20, int(24 * scale))
        sl_w  = sl_x2 - sl_x1
        sl_h  = sl_y2 - sl_y1
        pts   = ppe_sparkline[-20:]
        mn, mx = min(pts), max(pts)
        rng = max(mx - mn, 1)
        coords = []
        for i, v in enumerate(pts):
            sx = sl_x1 + int(i * sl_w / max(len(pts) - 1, 1))
            sy = sl_y2 - int((v - mn) / rng * sl_h)
            coords.append((sx, sy))
        for i in range(len(coords) - 1):
            cv2.line(frame, coords[i], coords[i + 1], rate_color, max(1, int(scale)), cv2.LINE_AA)


def _draw_ppe_status_banner(frame: np.ndarray, track_registry: dict, H: int, W: int) -> None:
    """Draw PPE status banner at the bottom, workforce-banner style."""
    if not track_registry:
        return

    scale      = max(0.75, min(2.0, W / 1280.0))
    FONT       = cv2.FONT_HERSHEY_SIMPLEX
    violations = sum(1 for t in track_registry.values() if t.state == ST_VIOLATION)
    checking   = sum(1 for t in track_registry.values() if t.state == ST_CHECKING)

    if violations > 0:
        banner_color = (40, 40, 200)
        banner_txt   = f"{violations} Active Violation{'s' if violations != 1 else ''}"
        flash = (int(time.time() * 2) % 2 == 0)
    elif checking > 0:
        banner_color = (20, 160, 255)
        banner_txt   = "Checking Workers..."
        flash        = False
    else:
        banner_color = (50, 200, 70)
        banner_txt   = "Site PPE Compliant"
        flash        = False

    bh  = max(28, int(34 * scale))
    by1 = H - bh - 4
    by2 = H - 4
    _ppe_blend_rect(frame, 0, by1, W, by2, (8, 12, 20), alpha=0.82)
    stripe_w = max(4, int(5 * scale))
    if flash:
        _ppe_blend_rect(frame, 0, by1, stripe_w, by2, banner_color, alpha=0.95)
        _ppe_blend_rect(frame, W - stripe_w, by1, W, by2, banner_color, alpha=0.95)
    else:
        _ppe_blend_rect(frame, 0, by1, stripe_w, by2, banner_color, alpha=0.75)

    (tw, th), _ = cv2.getTextSize(banner_txt, FONT, 0.55 * scale, max(1, int(scale)))
    cv2.putText(frame, banner_txt,
                ((W - tw) // 2, by1 + (bh + th) // 2),
                FONT, 0.55 * scale, (240, 245, 255), max(1, int(scale)), cv2.LINE_AA)

def _get_or_create_capture(camera_id: int, rtsp_url: str, transport: str = "tcp"):
    """Reuse capture across requests; evict and recreate if existing cap is no longer open."""
    existing = _camera_captures.get(camera_id)
    if existing is not None:
        if existing.isOpened():
            return existing
        # Cap present but dead — release and fall through to recreate
        logger.warning(f"Stale VideoCapture for camera {camera_id} — recreating")
        existing.release()
        del _camera_captures[camera_id]

    try:
        cap = _FFmpegMJPEGCapture(rtsp_url, transport)
        if not cap.isOpened():
            logger.error(f"ffmpeg_mjpeg isOpened() returned False for camera {camera_id}")
            return None
        logger.info(f"✅ Opened camera {camera_id}: ffmpeg_mjpeg ({transport})")
        _camera_captures[camera_id] = cap
    except Exception as e:
        logger.error(f"Exception opening RTSP for camera {camera_id}: {type(e).__name__}: {e}")
        return None
    return _camera_captures[camera_id]

# ─────────────────────────────────────────────────────────────
# PER-CAMERA PIPELINE SINGLETONS (reader + inferencer threads)
# ─────────────────────────────────────────────────────────────
_camera_pipelines: dict = {}          # camera_id -> pipeline dict
_camera_pipelines_lock = threading.Lock()

# Last fatal error per camera pipeline — surfaced via /stream/{camera_id}/diag.
_pipeline_last_error: dict = {}       # camera_id -> str | None
_pipeline_last_error_lock = threading.Lock()


def _set_pipeline_error(camera_id: int, msg: str | None) -> None:
    with _pipeline_last_error_lock:
        if msg is None:
            _pipeline_last_error.pop(camera_id, None)
        else:
            _pipeline_last_error[camera_id] = msg


def _get_pipeline_error(camera_id: int) -> str | None:
    with _pipeline_last_error_lock:
        return _pipeline_last_error.get(camera_id)


def _start_camera_pipeline(camera_id: int, cap, track_registry: dict,
                            faiss_manager, state_memory, cfg: dict,
                            reid_lock: threading.Lock | None = None,
                            active_ids: dict | None = None,
                            project_id: int | None = None,
                            rtsp_url: str | None = None,
                            transport: str = "tcp") -> dict:
    """
    Spawn one reader thread + one inferencer thread per camera.
    Returns a pipeline dict with shared frame holders and stop event.
    All HTTP consumers share this pipeline — no duplicate cap.read() calls.
    """
    fresh     = {"frame": None, "seq": 0, "lock": threading.Lock()}
    annotated = {"frame": None, "seq": 0, "lock": threading.Lock()}
    stop      = threading.Event()

    def _reader():
        nonlocal cap
        consecutive_failures = 0
        reconnect_attempt = 0
        while not stop.is_set():
            ret, frame = cap.read()
            if not ret or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 10:
                    release_capture(camera_id)
                    if camera_id in _camera_bytetrackers:
                        del _camera_bytetrackers[camera_id]
                    _camera_reconnect_timestamps[camera_id] = time.time()

                    if rtsp_url:
                        # Exponential backoff: 5s → 10s → 20s → … cap at 60s
                        backoff = min(5 * (2 ** reconnect_attempt), 60)
                        reconnect_attempt += 1
                        logger.warning(
                            f"Camera {camera_id} disconnected — reconnecting in {backoff}s "
                            f"(attempt {reconnect_attempt})"
                        )
                        # Update worker_status to 'reconnecting' so live view reflects this
                        try:
                            _db = SessionLocal()
                            try:
                                _cam = _db.query(Camera).filter(Camera.id == camera_id).first()
                                if _cam:
                                    _cam.worker_status = "reconnecting"
                                    _db.commit()
                            finally:
                                _db.close()
                        except Exception as _e:
                            logger.warning(f"[ppe_bg] worker_status update failed: {_e}")

                        time.sleep(backoff)
                        if stop.is_set():
                            break

                        new_cap = _get_or_create_capture(camera_id, rtsp_url, transport)
                        if new_cap is not None:
                            cap = new_cap
                            consecutive_failures = 0
                            logger.info(f"Camera {camera_id} reconnected successfully")
                        # else: loop continues, next 10 failures trigger another attempt
                    else:
                        # No RTSP URL available — cannot reconnect, stop pipeline
                        logger.error(f"Camera {camera_id} disconnected — no rtsp_url for reconnect, pipeline stopping")
                        with _camera_pipelines_lock:
                            _camera_pipelines.pop(camera_id, None)
                        stop.set()
                        try:
                            _db = SessionLocal()
                            try:
                                _cam = _db.query(Camera).filter(Camera.id == camera_id).first()
                                if _cam:
                                    _cam.worker_status = "error"
                                    _db.commit()
                            finally:
                                _db.close()
                        except Exception as _e:
                            logger.warning(f"[ppe_bg] Failed to update worker_status on disconnect for camera {camera_id}: {_e}")
                        break
                time.sleep(0.1)
                continue
            consecutive_failures = 0
            reconnect_attempt = 0  # reset backoff on successful read
            with fresh["lock"]:
                fresh["frame"] = frame
                fresh["seq"] += 1

    def _inferencer():
        import gc
        last_seq    = -1
        frame_count = 0  # For periodic memory cleanup
        _ppe_sparkline: list = []  # compliance rate history for summary panel
        while not stop.is_set():
            with fresh["lock"]:
                frame = fresh["frame"]
                seq   = fresh["seq"]
            if frame is None or seq == last_seq:
                time.sleep(0.005)
                continue
            last_seq = seq
            frame = frame.copy()
            H, W = frame.shape[:2]
            frame_count += 1  # Track frames for cleanup

            if _stage1 is not None and _stage2 is not None:
                try:
                    if is_frame_blurry(frame, cfg.get("blur_laplacian_thresh", 40.0)):
                        logger.debug(f"Camera {camera_id} frame blurry, skipped")
                    else:
                        try:
                            # Use predict() (stateless GPU call) + per-camera
                            # BYTETracker so multiple cameras never share tracker
                            # state inside the model singleton.
                            r1 = _stage1.predict(
                                source=frame,
                                classes=[0],
                                conf=cfg.get("stage1_conf", 0.30),
                                imgsz=cfg.get("imgsz_stage1", 960),
                                device=DEVICE,
                                half=USE_HALF,
                                verbose=False
                            )
                            bt = _get_or_create_bytetracker(camera_id)
                            tracked = bt.update(r1[0].boxes.cpu(), frame)
                        except Exception as e:
                            logger.warning(f"Stage 1 error for camera {camera_id}: {e}")
                            r1 = None
                            tracked = []

                        if r1 is not None:
                            # ── Post detections to workforce inbox (zero extra GPU work) ──
                            # Only copy the frame when a workforce consumer is actually active;
                            # avoids a full-res frame.copy() every inference cycle when unused.
                            _wf_has_consumer = (camera_id in _workforce_annotated or
                                                camera_id in _workforce_standalone_pipelines)
                            _wf_frame = frame.copy() if _wf_has_consumer else None
                            if tracked is not None and len(tracked) > 0:
                                _wf_dets = []
                                for _wf_row in tracked:
                                    _wx1, _wy1, _wx2, _wy2 = int(_wf_row[0]), int(_wf_row[1]), int(_wf_row[2]), int(_wf_row[3])
                                    _wtid = int(_wf_row[4]) if len(_wf_row) > 4 else -1
                                    _wf_dets.append({
                                        "track_id": _wtid,
                                        "x1": _wx1, "y1": _wy1, "x2": _wx2, "y2": _wy2,
                                        "cx": (_wx1 + _wx2) / 2.0,
                                        "cy": (_wy1 + _wy2) / 2.0,
                                    })
                                _post_workforce_detections(camera_id, _wf_dets, _wf_frame, seq)
                            else:
                                _post_workforce_detections(camera_id, [], _wf_frame, seq)

                            # Skip PPE Stage 2 entirely when PPE detection is disabled
                            # (workforce-only mode). Stage 1 + workforce detections are
                            # already posted above — just write the raw frame to annotated
                            # and continue to the next frame. Workforce overlays are
                            # drawn by WorkforceProcessor independently.
                            if not cfg.get("ppe_inference_on", True):
                                with annotated["lock"]:
                                    annotated["frame"] = frame
                                    annotated["seq"]   = seq
                                continue

                            # Build a boxes1-compatible list from tracker output.
                            # tracked rows: [x1, y1, x2, y2, track_id, score, cls, idx]
                            boxes1 = tracked
                            seen_ids = set()

                            if boxes1 is not None and len(boxes1) > 0:
                                all_boxes = []
                                for row in boxes1:
                                    # row: [x1, y1, x2, y2, track_id, score, cls, idx]
                                    bx1, by1, bx2, by2 = int(row[0]), int(row[1]), int(row[2]), int(row[3])
                                    all_boxes.append(clamp_box(bx1, by1, bx2, by2, W, H))

                                overlapping = find_overlapping_indices(
                                    all_boxes, cfg.get("overlap_iou_thresh", 0.60))

                                # ── Phase 1: Prepare all crops (CPU only) ──
                                persons = []
                                for i, row in enumerate(boxes1):
                                    x1, y1, x2, y2 = all_boxes[i]
                                    # track_id is always assigned by BYTETracker.update()
                                    # — it only returns confirmed/active tracks, so id is
                                    # never None here. The negative-ID fallback is kept as
                                    # a safety net only.
                                    track_id = int(row[4]) if len(row) > 4 else -(i + 1)
                                    seen_ids.add(track_id)
                                    if track_id not in track_registry:
                                        track_registry[track_id] = PersonTrack(track_id)
                                    track = track_registry[track_id]

                                    if i in overlapping:
                                        track.overlap_streak += 1
                                        grace = cfg.get("overlap_grace_frames", 10)
                                        # Hold last known compliant/violation state for
                                        # grace frames so workers crossing paths don't
                                        # instantly flash to uncertain mid-crossing
                                        if (track.state in (ST_COMPLIANT, ST_VIOLATION)
                                                and track.overlap_streak <= grace):
                                            raw_overlap = {
                                                "has_helmet": track.has_helmet,
                                                "has_vest":   track.has_vest,
                                                "is_uncertain": False,
                                                "reason": "overlap_grace", "crop": None,
                                            }
                                        else:
                                            raw_overlap = {
                                                "has_helmet": False, "has_vest": False,
                                                "is_uncertain": True, "reason": "overlapping",
                                                "crop": None,
                                            }
                                        persons.append({
                                            "track": track, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                            "meta": None, "raw": raw_overlap,
                                        })
                                    else:
                                        track.overlap_streak = 0
                                        meta = _prepare_ppe_crop(frame, x1, y1, x2, y2, cfg)
                                        persons.append({
                                            "track": track, "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                                            "meta": meta, "raw": None
                                        })

                                # ── Phase 2: Batch Stage 2 (one GPU call) ──
                                stage2_indices = [k for k, p in enumerate(persons)
                                                  if p["meta"] is not None and not p["meta"]["skip"]]
                                if stage2_indices:
                                    batch_crops = [persons[k]["meta"]["crop"] for k in stage2_indices]
                                    run_conf    = min(persons[k]["meta"]["run_conf"]
                                                      for k in stage2_indices)
                                    try:
                                        batch_r2 = _stage2.predict(
                                            source=batch_crops,
                                            conf=run_conf,
                                            imgsz=cfg.get("imgsz_stage2", 224),
                                            device=DEVICE,
                                            half=USE_HALF,
                                            verbose=False
                                        )
                                        for j, k in enumerate(stage2_indices):
                                            persons[k]["raw"] = _parse_ppe_result(
                                                batch_r2[j].boxes, persons[k]["meta"], cfg)
                                    except Exception as e:
                                        logger.warning(f"Batch Stage 2 error: {e}")
                                        for k in stage2_indices:
                                            persons[k]["raw"] = {
                                                "has_helmet": False, "has_vest": False,
                                                "is_uncertain": True, "reason": "stage2_error",
                                                "crop": persons[k]["meta"]["crop"]
                                            }

                                # Fallback raw for skipped crops
                                for p in persons:
                                    if p["raw"] is None:
                                        p["raw"] = {
                                            "has_helmet": False, "has_vest": False,
                                            "is_uncertain": True,
                                            "reason": p["meta"]["reason"] if p["meta"] else "unknown",
                                            "crop": None
                                        }

                                # ── Phase 3: Update state machines ──
                                _triggered_tracks = []  # collect here, dispatch after ReID
                                for p in persons:
                                    triggered = p["track"].update(
                                        p["raw"]["has_helmet"], p["raw"]["has_vest"],
                                        p["raw"]["is_uncertain"], cfg
                                    )
                                    if triggered:
                                        _triggered_tracks.append(p)

                                # ── Phase 4: Batch ReID (one OSNet call) ──
                                # Rules:
                                #   - id_locked tracks: skip entirely (identity fixed for this local track)
                                #   - Quality gate: _compute_reid_quality must pass reid_quality_min
                                #   - Delayed assignment: buffer reid_min_pending_frames quality frames
                                #     then average and assign once (strict assign_thresh)
                                #   - Re-match: use lenient match_thresh for returning persons
                                if faiss_manager is not None and _reid_available:
                                    reid_quality_min   = cfg.get("reid_quality_min", 0.55)
                                    min_pending        = cfg.get("reid_min_pending_frames", 4)
                                    reid_persons = []
                                    reid_crops   = []
                                    reid_metas   = []
                                    for p in persons:
                                        track = p["track"]
                                        # Skip locked identities entirely
                                        if track.id_locked:
                                            continue
                                        # Quality gate using meta from Phase 1
                                        meta = p.get("meta")
                                        quality = _compute_reid_quality(meta, track)
                                        track.reid_quality_score = quality
                                        if quality < reid_quality_min:
                                            continue
                                        # Only include if in a state where ReID makes sense
                                        if track.state not in (ST_COMPLIANT, ST_VIOLATION, ST_CHECKING):
                                            continue
                                        crop = p["raw"].get("crop")
                                        if crop is None:
                                            continue
                                        reid_persons.append(p)
                                        reid_crops.append(crop)
                                        reid_metas.append((meta, quality))

                                    if reid_crops:
                                        embeddings = extract_embeddings_batch(reid_crops)
                                        _new_ids_created = 0
                                        _proj_lock = reid_lock if reid_lock is not None else threading.Lock()
                                        _proj_active = active_ids if active_ids is not None else {}
                                        with _proj_lock:
                                            now_s = time.time()
                                            active_ttl_s = float(cfg.get("reid_active_ttl_s", 3.0))
                                            reid_lock_quality_min = float(cfg.get("reid_lock_quality_min", 0.60))
                                            _purge_stale_active_global_ids(_proj_active, now_s, active_ttl_s)
                                            _release_missing_camera_tracks_for_reid(
                                                _proj_active,
                                                state_memory,
                                                track_registry,
                                                camera_id,
                                                seen_ids,
                                            )

                                            # Detect reconnect session — use lower threshold
                                            reconnect_grace_s = float(cfg.get("reid_reconnect_grace_s", 30.0))
                                            is_reconnect = (
                                                camera_id in _camera_reconnect_timestamps and
                                                (now_s - _camera_reconnect_timestamps[camera_id]) < reconnect_grace_s
                                            )
                                            override_thresh = (
                                                max(faiss_manager.match_thresh - 0.08, 0.45)
                                                if is_reconnect else None
                                            )

                                            for p, emb, (meta, quality) in zip(
                                                    reid_persons, embeddings, reid_metas):
                                                if emb is None:
                                                    continue
                                                track = p["track"]
                                                track_key = (camera_id, track.track_id)

                                                if track.global_id is None:
                                                    # ── Delayed assignment: buffer quality frames ──
                                                    track._pending_embeddings.append(emb)
                                                    track._pending_qualities.append(quality)
                                                    if len(track._pending_embeddings) >= min_pending:
                                                        raw_q   = np.array(track._pending_qualities,
                                                                           dtype=np.float32)
                                                        weights = raw_q / raw_q.sum()
                                                        avg_emb = np.average(
                                                            np.stack(track._pending_embeddings),
                                                            axis=0, weights=weights
                                                        )
                                                        avg_quality = float(raw_q.mean())
                                                        track.global_id = faiss_manager.assign(
                                                            avg_emb,
                                                            quality=avg_quality,
                                                            state_memory=state_memory,
                                                            active_tracks=_proj_active,
                                                            track_key=track_key,
                                                            now_s=now_s,
                                                            active_ttl_s=active_ttl_s,
                                                            override_assign_thresh=override_thresh,
                                                        )
                                                        faiss_manager.flush_if_dirty()
                                                        # Multi-camera active tracking structure:
                                                        # allow same global_id on multiple cameras simultaneously
                                                        _update_active_ids(_proj_active, track.global_id, camera_id, track.track_id, now_s)
                                                        track._pending_embeddings.clear()
                                                        track._pending_qualities.clear()
                                                        track.embedding_frame_count = 1
                                                        track.embedding_assigned = False
                                                        if state_memory:
                                                            state_memory.restore(
                                                                track.global_id, track)
                                                        _new_ids_created += 1
                                                else:
                                                    # ── Already has global_id: top-K gallery update ──
                                                    # Only update until identity is locked (quality-gated)
                                                    track.embedding_frame_count += 1
                                                    reid_ema_frames = cfg.get("reid_ema_frames", 5)
                                                    if track.embedding_frame_count <= reid_ema_frames:
                                                        faiss_manager._add_to_identity(
                                                            track.global_id, emb, quality)
                                                        if track.embedding_frame_count >= reid_ema_frames:
                                                            track.embedding_assigned = True
                                                            # Lock only when average embedding quality is good
                                                            bucket = faiss_manager._identity_embeddings.get(track.global_id, [])
                                                            if bucket:
                                                                avg_q = sum(q for q, _ in bucket) / len(bucket)
                                                                if avg_q >= reid_lock_quality_min:
                                                                    track.id_locked = True
                                                            # If quality too low: don't lock — keep accumulating
                                                if track.global_id is not None:
                                                    _update_active_ids(_proj_active, track.global_id, camera_id, track.track_id, now_s)

                                            # Final refresh for all persons with global_id
                                            for p in persons:
                                                t = p["track"]
                                                if t.global_id is not None:
                                                    _update_active_ids(_proj_active, int(t.global_id), camera_id, t.track_id, now_s)

                                        # One FAISS rebuild per inference cycle (not per person)
                                        faiss_manager.flush_if_dirty()

                                        # Trigger save every 5 new IDs to limit disk I/O
                                        if _new_ids_created > 0:
                                            ids_so_far = faiss_manager.total_identities
                                            if ids_so_far > 0 and ids_so_far % 5 == 0:
                                                try:
                                                    from ...services.reid_persistence import save_gallery
                                                    save_gallery(faiss_manager, state_memory,
                                                                 project_id=project_id)
                                                except Exception:
                                                    pass

                                # ── Phase 5: Draw annotations ──
                                for p in persons:
                                    draw_person(frame, p["x1"], p["y1"], p["x2"], p["y2"],
                                                p["track"], H, W, cfg)

                                # ── PPE Site Summary Panel + Status Banner ──
                                total_tracked = len(track_registry)
                                if total_tracked > 0:
                                    compliant_cnt = sum(
                                        1 for t in track_registry.values()
                                        if t.state == ST_COMPLIANT
                                    )
                                    _ppe_sparkline.append(
                                        int(100 * compliant_cnt / total_tracked)
                                    )
                                    if len(_ppe_sparkline) > 60:
                                        _ppe_sparkline = _ppe_sparkline[-60:]
                                try:
                                    _draw_ppe_summary_panel(frame, track_registry, H, W, _ppe_sparkline)
                                    _draw_ppe_status_banner(frame, track_registry, H, W)
                                except Exception:
                                    pass

                                # ── Dispatch violation events (after ReID so global_id is set) ──
                                if _triggered_tracks:
                                    for p in _triggered_tracks:
                                        track = p["track"]
                                        queued = _try_enqueue_incident({
                                            "camera_id":      camera_id,
                                            "track_id":       track.track_id,
                                            "global_id":      track.global_id,
                                            "has_helmet":     track.has_helmet,
                                            "has_vest":       track.has_vest,
                                            "snapshot_frame": frame,  # already a copy (line 642)
                                            "bbox":           (p["x1"], p["y1"], p["x2"], p["y2"]),
                                            "timestamp":      datetime.now(timezone.utc),
                                        })
                                        if queued:
                                            logger.info(f"[ml_stream] Queueing violation: camera={camera_id}, track={track.track_id}, helmet={track.has_helmet}, vest={track.has_vest}")
                                        # Start collecting post-violation frames for clip (~5s at 15fps).
                                        # Only start a new collector if one isn't already in progress for
                                        # this (camera, track) — never reset mid-collection or the clip
                                        # never completes for continuous violators.
                                        _clip_key = (camera_id, track.track_id)
                                        if _clip_key not in _clip_collectors:
                                            _clip_collectors[_clip_key] = {"frames": [_scale_frame_for_clip(frame)], "remaining": 74, "camera_id": camera_id, "track_id": track.track_id}

                                # Cleanup lost tracks (with state save)
                                to_remove = []
                                for tid, t in list(track_registry.items()):
                                    if tid not in seen_ids:
                                        t.frames_lost += 1
                                        if t.frames_lost >= cfg.get("lost_frames", 30):
                                            if t.global_id is not None:
                                                _lost_lock = reid_lock if reid_lock is not None else threading.Lock()
                                                _lost_active = active_ids if active_ids is not None else {}
                                                with _lost_lock:
                                                    if state_memory:
                                                        state_memory.save(t.global_id, t)
                                                    # Remove this camera's entry from active tracking
                                                    entry = _lost_active.get(int(t.global_id))
                                                    if entry is not None:
                                                        entry.get("cameras", {}).pop(camera_id, None)
                                                        if not entry.get("cameras"):
                                                            del _lost_active[int(t.global_id)]
                                            to_remove.append(tid)
                                for tid in to_remove:
                                    del track_registry[tid]

                except Exception as e:
                    logger.warning(f"PPE detection error for camera {camera_id}: {e}")

            # ── Collect post-violation frames for clip (outside try/except so it
            #    always runs even on detection error, draining the collector) ──
            # Iterate all collectors belonging to this camera (keyed by (camera_id, track_id)).
            _finished_keys = []
            for _ckey, col in list(_clip_collectors.items()):
                if col["camera_id"] != camera_id:
                    continue
                col["frames"].append(_scale_frame_for_clip(frame))
                col["remaining"] -= 1
                if col["remaining"] <= 0:
                    _finished_keys.append(_ckey)
            for _ckey in _finished_keys:
                col = _clip_collectors.pop(_ckey)
                clip_frames = col["frames"]
                _cq = _get_clip_queue()
                if _cq is not None:
                    # Read incident_id from registry — keyed by (camera_id, track_id)
                    # for exact per-person lookup when multiple violations fire on one camera.
                    _col_track_id = col.get("track_id")
                    try:
                        from ...services.incident_event_queue import (
                            _recent_incident_ids as _rid,
                            _recent_incident_lock as _ril,
                        )
                        with _ril:
                            _inc_id = _rid.get((camera_id, _col_track_id)) or _rid.get(camera_id)
                    except Exception:
                        _inc_id = None
                    try:
                        _cq.put_nowait({
                            "camera_id":   camera_id,
                            "frames":      clip_frames,
                            "incident_id": _inc_id,
                            "track_id":    _col_track_id,
                        })
                    except Exception:
                        logger.warning(f"[ml_stream] Clip queue full; dropping clip for camera={camera_id} track={col['track_id']}")

            with annotated["lock"]:
                annotated["frame"] = frame
                annotated["seq"]   = last_seq

            # Periodic memory cleanup (every 100 frames ≈ 3s @ 30fps)
            if frame_count % 100 == 0 and frame_count > 0:
                _periodic_lock = reid_lock if reid_lock is not None else threading.Lock()
                with _periodic_lock:
                    # ── State memory expiry ──
                    if state_memory:
                        now = time.time()
                        state_ttl = float(cfg.get("reid_state_memory_ttl_s", 90.0))
                        expired = [gid for gid, snap in list(state_memory._memory.items())
                                   if now - snap.get("saved_at", 0) > state_ttl]
                        for gid in expired:
                            del state_memory._memory[gid]
                        if expired:
                            logger.debug(f"Cleaned {len(expired)} expired state snapshots")

                    # ── Gallery eviction: remove weak + stale identities when gallery is large ──
                    if faiss_manager is not None:
                        max_gallery    = cfg.get("reid_max_gallery_size", 500)
                        min_trusted    = cfg.get("reid_min_trusted_embeddings", 2)
                        max_age_days   = float(cfg.get("reid_gallery_max_age_days", 7.0))
                        if faiss_manager.total_identities > max_gallery:
                            faiss_manager.evict_weak_identities(min_trusted=min_trusted)
                            faiss_manager.evict_stale_identities(max_age_days=max_age_days)

                    # ── Periodic gallery save (crash-safe) ──
                    if faiss_manager is not None:
                        try:
                            from ...services.reid_persistence import save_gallery
                            save_gallery(faiss_manager, state_memory, project_id=project_id)
                        except Exception as _se:
                            logger.debug(f"[reid] Periodic save error: {_se}")

                gc.collect()  # Garbage collection to prevent RAM from hitting 90%

    reader     = threading.Thread(target=_reader,     daemon=True)
    inferencer = threading.Thread(target=_inferencer, daemon=True)
    reader.start()
    inferencer.start()

    return {"fresh": fresh, "annotated": annotated, "stop": stop,
            "reader": reader, "inferencer": inferencer}


def _get_or_create_pipeline(camera_id: int, cap, track_registry: dict,
                             faiss_manager, state_memory, cfg: dict,
                             reid_lock: threading.Lock | None = None,
                             active_ids: dict | None = None,
                             project_id: int | None = None,
                             rtsp_url: str | None = None,
                             transport: str = "tcp") -> dict:
    """Return the running per-camera pipeline, creating it if needed."""
    with _camera_pipelines_lock:
        pipeline = _camera_pipelines.get(camera_id)
        if pipeline is not None and not pipeline["stop"].is_set():
            return pipeline
        pipeline = _start_camera_pipeline(
            camera_id, cap, track_registry, faiss_manager, state_memory, cfg,
            reid_lock=reid_lock, active_ids=active_ids, project_id=project_id,
            rtsp_url=rtsp_url, transport=transport)
        _camera_pipelines[camera_id] = pipeline
        return pipeline


# ─────────────────────────────────────────────────────────────
# MAIN STREAM ENDPOINT
# ─────────────────────────────────────────────────────────────

@router.get("/{camera_id}")
def stream_camera(camera_id: int, db: Session = Depends(get_db)):
    """
    Stream live MJPEG with PPE detection + ReID.

    Returns annotated frames with:
      - Person detection + ByteTrack tracking
      - PPE detection (helmet/vest)
      - Global identity via ReID+FAISS (if available)
      - Compliance state machine
    """

    # ── 1. Fetch camera + credentials ───────────────────────────────────
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    if camera.registry_status != "verified":
        raise HTTPException(
            status_code=400,
            detail=f"Camera not verified (status: {camera.registry_status})"
        )

    credentials = (
        db.query(CameraCredential)
        .filter(CameraCredential.camera_id == camera_id)
        .first()
    )
    if not credentials:
        raise HTTPException(
            status_code=400,
            detail="Camera has no credentials configured"
        )

    # ── 2. Decrypt RTSP URLs ───────────────────────────────────────────
    rtsp_url_sub = None
    rtsp_url_main = None
    username = None
    password = None

    try:
        if credentials.username_enc:
            try:
                username = decrypt_credential(credentials.username_enc)
            except Exception as e:
                logger.error(f"Failed to decrypt username: {type(e).__name__}: {e}")

        if credentials.password_enc:
            try:
                password = decrypt_credential(credentials.password_enc)
            except Exception as e:
                logger.error(f"Failed to decrypt password: {type(e).__name__}: {e}")

        if credentials.rtsp_url_sub_enc:
            try:
                rtsp_url_sub = decrypt_credential(credentials.rtsp_url_sub_enc)
            except Exception as e:
                logger.error(f"Failed to decrypt rtsp_url_sub: {type(e).__name__}: {e}")

        if credentials.rtsp_url_enc:
            try:
                rtsp_url_main = decrypt_credential(credentials.rtsp_url_enc)
            except Exception as e:
                logger.error(f"Failed to decrypt rtsp_url_enc: {type(e).__name__}: {e}")
    except Exception as e:
        logger.error(f"Unexpected decryption error for camera {camera_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Decryption error: {str(e)}")

    # ── 2b. Embed credentials ──────────────────────────────────────────
    def _embed_credentials(url: str, user: str, pwd: str) -> str:
        if not url or not user or not pwd:
            return url
        if url.startswith("rtsp://"):
            return f"rtsp://{user}:{pwd}@{url[7:]}"
        elif url.startswith("rtsps://"):
            return f"rtsps://{user}:{pwd}@{url[8:]}"
        else:
            return url

    if rtsp_url_sub:
        rtsp_url_sub = _embed_credentials(rtsp_url_sub, username, password)
    if rtsp_url_main:
        rtsp_url_main = _embed_credentials(rtsp_url_main, username, password)

    rtsp_url = rtsp_url_main or rtsp_url_sub
    if not rtsp_url:
        raise HTTPException(
            status_code=400,
            detail="Camera has no RTSP stream URL configured"
        )

    url_display = rtsp_url
    if "@" in rtsp_url:
        parts = rtsp_url.split("@")
        scheme_and_user = parts[0].rsplit(":", 1)
        url_display = f"{scheme_and_user[0]}:****@{parts[1]}"
    logger.info(f"Streaming camera {camera_id} ({camera.name})")

    transport = credentials.transport_preference or "tcp"
    cap = _get_or_create_capture(camera_id, rtsp_url, transport=transport)
    if cap is None or not cap.isOpened():
        logger.error(f"Failed to open RTSP stream for camera {camera_id}")
        raise HTTPException(
            status_code=500,
            detail="Failed to open RTSP stream - check camera is online and URL is valid"
        )

    # ── 4. Check whether PPE inference is enabled for this camera ──────
    # If PPE feature is OFF we must NOT start the ML pipeline — serve raw
    # frames instead so the GPU stays idle.
    try:
        from ...models.project_camera import ProjectCamera
        from ...models.project_camera_analytics import ProjectCameraAnalytics
        _pc = (
            db.query(ProjectCamera)
            .filter(ProjectCamera.camera_id == camera_id)
            .first()
        )
        _analytics = (
            db.query(ProjectCameraAnalytics)
            .filter(ProjectCameraAnalytics.project_camera_id == _pc.id)
            .first()
        ) if _pc else None
        ppe_inference_on       = (_analytics.ppe_enabled       if _analytics else False)
        workforce_inference_on = (_analytics.workforce_enabled if _analytics else False)
        equipment_inference_on = (_analytics.equipment_enabled if _analytics else False)
    except Exception:
        ppe_inference_on       = False
        workforce_inference_on = False
        equipment_inference_on = False

    # ── 5. Load ML config (with cache) then release DB connection ──────
    try:
        cfg = load_config(db)
    except Exception as e:
        logger.warning(f"ML config load failed: {e}, using defaults")
        cfg = DEFAULTS.copy()
    finally:
        # All DB work is done. Close the session now so the connection is
        # returned to the pool before the long-lived stream begins.
        db.close()

    # ── 6a. No inference features ON → raw passthrough, zero GPU usage ─
    if not ppe_inference_on and not workforce_inference_on and not equipment_inference_on:
        logger.info(f"[ml_stream] Camera {camera_id} PPE disabled — serving raw frames (no inference)")

        def frame_generator():
            """Serve raw RTSP frames without any ML inference."""
            connect_deadline = time.time() + 8.0
            while True:
                if not cap.isOpened():
                    break
                ok, frame = cap.read()
                if not ok or frame is None:
                    if time.time() > connect_deadline:
                        break
                    time.sleep(0.05)
                    continue
                connect_deadline = time.time() + 8.0
                try:
                    _, buffer = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    frame_bytes = buffer.tobytes()
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n"
                        b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n"
                        + frame_bytes + b"\r\n"
                    )
                except Exception:
                    continue

        return StreamingResponse(
            frame_generator(),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
                "X-Accel-Buffering": "no",
            },
        )

    # ── 6b-wf. WORKFORCE ONLY (PPE off) → serve _workforce_annotated frames ──
    # WorkforceProcessor already computed the premium overlays (heatmap, ring gauge,
    # W-01 tags, flow arrow, summary panel, banner) and wrote them to
    # _workforce_annotated[camera_id].  We just read and stream from there.
    if workforce_inference_on and not ppe_inference_on:
        logger.info(f"[ml_stream] Camera {camera_id} workforce-only — serving workforce overlay frames")

        def frame_generator():
            last_sent_seq = -1
            connect_deadline = time.time() + 8.0
            while True:
                ann = _workforce_annotated.get(camera_id)
                if ann is None:
                    # Processor not started yet — serve raw frame as fallback
                    if not cap.isOpened():
                        break
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        try:
                            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                            fb = buf.tobytes()
                            connect_deadline = time.time() + 8.0
                            yield (
                                b"--frame\r\n"
                                b"Content-Type: image/jpeg\r\n"
                                b"Content-Length: " + str(len(fb)).encode() + b"\r\n\r\n"
                                + fb + b"\r\n"
                            )
                        except Exception:
                            pass
                    else:
                        if time.time() > connect_deadline:
                            break
                    time.sleep(0.04)
                    continue
                with ann["lock"]:
                    frame = ann.get("frame")
                    seq   = ann.get("seq", -1)
                if frame is None or seq == last_sent_seq:
                    if time.time() > connect_deadline:
                        break
                    time.sleep(0.005)
                    continue
                connect_deadline = time.time() + 8.0
                last_sent_seq = seq
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
            frame_generator(),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
                "X-Accel-Buffering": "no",
            },
        )

    # ── 6b-eq. EQUIPMENT ONLY (PPE and workforce off) → serve _equipment_annotated frames ──
    # EquipmentProcessor already computed the overlays (bounding boxes, glow blobs, motion
    # trails, heatmap, summary panel) and wrote them to _equipment_annotated[camera_id].
    if equipment_inference_on and not ppe_inference_on and not workforce_inference_on:
        logger.info(f"[ml_stream] Camera {camera_id} equipment-only — serving equipment overlay frames")

        def frame_generator():
            last_sent_seq = -1
            connect_deadline = time.time() + 8.0
            while True:
                ann = _equipment_annotated.get(camera_id)
                if ann is None:
                    # Processor not started yet — serve raw frame as fallback
                    if not cap.isOpened():
                        break
                    ok, frame = cap.read()
                    if ok and frame is not None:
                        try:
                            _, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                            fb = buf.tobytes()
                            connect_deadline = time.time() + 8.0
                            yield (
                                b"--frame\r\n"
                                b"Content-Type: image/jpeg\r\n"
                                b"Content-Length: " + str(len(fb)).encode() + b"\r\n\r\n"
                                + fb + b"\r\n"
                            )
                        except Exception:
                            pass
                    else:
                        if time.time() > connect_deadline:
                            break
                    time.sleep(0.04)
                    continue
                with ann["lock"]:
                    frame = ann.get("frame")
                    seq   = ann.get("seq", -1)
                if frame is None or seq == last_sent_seq:
                    if time.time() > connect_deadline:
                        break
                    time.sleep(0.005)
                    continue
                connect_deadline = time.time() + 8.0
                last_sent_seq = seq
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
            frame_generator(),
            media_type="multipart/x-mixed-replace; boundary=frame",
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
                "Pragma": "no-cache",
                "Expires": "0",
                "X-Accel-Buffering": "no",
            },
        )

    # ── 6b. PPE ON → full ML inference pipeline ────────────────────────
    if camera_id not in _camera_track_registries:
        _camera_track_registries[camera_id] = {}
    track_registry = _camera_track_registries[camera_id]

    # Inject PPE on/off flag so the inferencer can skip Stage 2 when workforce-only
    cfg = dict(cfg)  # shallow copy so we don't mutate the shared cache
    cfg["ppe_inference_on"] = ppe_inference_on

    # Resolve project_id for per-project FAISS isolation
    _stream_project_id = _pc.project_id if _pc else None
    _camera_project_ids[camera_id] = _stream_project_id

    faiss_manager = None
    state_memory  = None
    reid_lock     = None
    active_ids    = None
    if _reid_available and cfg.get("reid_enabled") and _stream_project_id:
        faiss_manager, state_memory, reid_lock, active_ids = _get_project_reid_context(
            _stream_project_id, cfg)

    pipeline = _get_or_create_pipeline(
        camera_id, cap, track_registry, faiss_manager, state_memory, cfg,
        reid_lock=reid_lock, active_ids=active_ids, project_id=_stream_project_id,
        rtsp_url=rtsp_url, transport=transport)

    def frame_generator():
        """Stream new annotated frames from shared pipeline. No threads started here.

        Watchdog: if no frame is yielded within 8s the generator returns so the
        browser fires onerror and the frontend can surface a diagnostic. Without
        this, a stalled pipeline (RTSP conflict, GPU OOM, dead inferencer thread)
        leaves <img> hanging on "loading" forever.
        """
        annotated          = pipeline["annotated"]
        fresh              = pipeline["fresh"]
        last_sent_seq      = -1
        inference_started  = False   # True once first annotated frame received
        gen_start          = time.time()
        any_frame_yielded  = False
        # Cold-start budget: RTSP connect (5-10s) + FFmpeg subprocess + first
        # frame can take ~20-30s on the first request after toggle. Only fail
        # the request if NOTHING (annotated or raw) has surfaced after that.
        WARMUP_BUDGET_S    = 30.0

        while not pipeline["stop"].is_set():
            if not any_frame_yielded and (time.time() - gen_start) > WARMUP_BUDGET_S:
                with annotated["lock"]:
                    ann_present = annotated["frame"] is not None
                with fresh["lock"]:
                    fresh_present = fresh.get("frame") is not None
                logger.warning(
                    f"[stream] camera={camera_id} no frame after {WARMUP_BUDGET_S}s "
                    f"(annotated={ann_present}, fresh={fresh_present}, "
                    f"last_error={_get_pipeline_error(camera_id)!r})"
                )
                return

            with annotated["lock"]:
                ann_frame = annotated["frame"]
                seq       = annotated["seq"]

            if ann_frame is not None and seq != last_sent_seq:
                # Annotated frame ready — stream it
                try:
                    _, buffer = cv2.imencode(".jpg", ann_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                    frame_bytes = buffer.tobytes()
                except Exception as e:
                    logger.error(f"JPEG encode failed for camera {camera_id}: {e}")
                    time.sleep(0.01)
                    continue
                last_sent_seq     = seq
                inference_started = True
                any_frame_yielded = True
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n"
                    + frame_bytes + b"\r\n"
                )
                time.sleep(0.01)
            elif not inference_started:
                # Inference hasn't produced its first frame yet — show raw feed
                # so the stream isn't black while PPE warms up. Once inference
                # starts we never come back here, eliminating flicker.
                with fresh["lock"]:
                    raw_frame = fresh.get("frame")
                if raw_frame is not None:
                    try:
                        _, buffer = cv2.imencode(".jpg", raw_frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
                        frame_bytes = buffer.tobytes()
                        any_frame_yielded = True
                        yield (
                            b"--frame\r\n"
                            b"Content-Type: image/jpeg\r\n"
                            b"Content-Length: " + str(len(frame_bytes)).encode() + b"\r\n\r\n"
                            + frame_bytes + b"\r\n"
                        )
                    except Exception:
                        pass
                time.sleep(0.033)
            else:
                # Inference running, waiting for next annotated frame
                time.sleep(0.01)

    return StreamingResponse(
        frame_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
            "X-Accel-Buffering": "no",
        },
    )


# ─────────────────────────────────────────────────────────────
# DIAGNOSTIC ENDPOINT — surfaces stream pipeline state to the frontend
# so the operator gets a real reason instead of an indefinite spinner.
# ─────────────────────────────────────────────────────────────

@router.get("/{camera_id}/diag")
def stream_diag(camera_id: int, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    with _camera_pipelines_lock:
        pipeline = _camera_pipelines.get(camera_id)

    ppe_running       = pipeline is not None and not pipeline["stop"].is_set()
    ppe_fresh_seq     = 0
    ppe_annotated_seq = 0
    if pipeline is not None:
        with pipeline["fresh"]["lock"]:
            ppe_fresh_seq = pipeline["fresh"].get("seq", 0)
        with pipeline["annotated"]["lock"]:
            ppe_annotated_seq = pipeline["annotated"].get("seq", 0)

    wf_entry = _workforce_annotated.get(camera_id)
    wf_running = wf_entry is not None and wf_entry.get("frame") is not None
    wf_seq = wf_entry.get("seq", 0) if wf_entry else 0

    act_entry = _activity_annotated.get(camera_id)
    act_running = act_entry is not None and act_entry.get("frame") is not None
    act_seq = act_entry.get("seq", 0) if act_entry else 0

    cap = _camera_captures.get(camera_id)
    rtsp_open = cap is not None and cap.isOpened()

    return {
        "camera_id":              camera_id,
        "registry_status":        getattr(camera.registry_status, "value", str(camera.registry_status)),
        "worker_status":          camera.worker_status,
        "rtsp_capture_open":      rtsp_open,
        "ppe_pipeline_running":   ppe_running,
        "ppe_fresh_seq":          ppe_fresh_seq,
        "ppe_annotated_seq":      ppe_annotated_seq,
        "workforce_pipeline_running": wf_running,
        "workforce_seq":              wf_seq,
        "activity_pipeline_running":  act_running,
        "activity_seq":               act_seq,
        "last_error":             _get_pipeline_error(camera_id),
    }


def start_camera_background(camera_id: int, db) -> bool:
    """
    Start background inference pipeline for a camera without an HTTP client.
    Called by ppe_stream_manager on project activation and server startup.
    Returns True if started (or already running), False on failure.

    IMPORTANT: Session is closed before pipeline startup to avoid connection pool exhaustion.
    """
    # Already running?
    with _camera_pipelines_lock:
        existing = _camera_pipelines.get(camera_id)
        if existing and not existing["stop"].is_set():
            return True

    # Check model availability before loading anything from DB
    if not _models_loaded:
        logger.warning(f"[ppe_bg] YOLO models not yet loaded for camera {camera_id}")
        return False
    if _stage1 is None or _stage2 is None:
        logger.error(f"[ppe_bg] YOLO models not available for camera {camera_id}")
        return False

    session_to_close = False
    if db is None:
        db = SessionLocal()
        session_to_close = True

    try:
        camera = db.query(Camera).filter(Camera.id == camera_id).first()
        if not camera or camera.registry_status != "verified":
            return False

        credentials = (
            db.query(CameraCredential)
            .filter(CameraCredential.camera_id == camera_id)
            .first()
        )
        if not credentials:
            return False

        rtsp_url_sub = None
        rtsp_url_main = None
        username = None
        password = None

        if credentials.username_enc:
            try: username = decrypt_credential(credentials.username_enc)
            except Exception: pass
        if credentials.password_enc:
            try: password = decrypt_credential(credentials.password_enc)
            except Exception: pass
        if credentials.rtsp_url_sub_enc:
            try: rtsp_url_sub = decrypt_credential(credentials.rtsp_url_sub_enc)
            except Exception: pass
        if credentials.rtsp_url_enc:
            try: rtsp_url_main = decrypt_credential(credentials.rtsp_url_enc)
            except Exception: pass

        def _embed(url, user, pwd):
            if not url or not user or not pwd:
                return url
            if url.startswith("rtsp://"):
                return f"rtsp://{user}:{pwd}@{url[7:]}"
            elif url.startswith("rtsps://"):
                return f"rtsps://{user}:{pwd}@{url[8:]}"
            return url

        if rtsp_url_sub:
            rtsp_url_sub = _embed(rtsp_url_sub, username, password)
        if rtsp_url_main:
            rtsp_url_main = _embed(rtsp_url_main, username, password)

        rtsp_url = rtsp_url_main or rtsp_url_sub
        if not rtsp_url:
            return False

        try:
            cfg = load_config(db)
        except Exception:
            cfg = DEFAULTS.copy()

        transport = credentials.transport_preference or "tcp"

        # ── CRITICAL: Close DB session before starting pipeline ────────────────
        # Session held open during credential load only, not RTSP connect (10-30s)
        try:
            camera.worker_status = "running"
            db.commit()
        except Exception:
            pass
        finally:
            if session_to_close:
                db.close()
        # ────────────────────────────────────────────────────────────────────────

        # Start RTSP capture AFTER session is closed (ref-counted so workforce can share)
        cap = acquire_capture(camera_id, rtsp_url, transport=transport)
        if cap is None or not cap.isOpened():
            logger.warning(f"[ppe_bg] Camera {camera_id} RTSP not reachable — will retry later")
            return False

        if camera_id not in _camera_track_registries:
            _camera_track_registries[camera_id] = {}
        track_registry = _camera_track_registries[camera_id]

        # Resolve project_id for per-project FAISS isolation
        try:
            from ...models.project_camera import ProjectCamera as _PC
            _bg_pc = db.query(_PC).filter(_PC.camera_id == camera_id).first()
            _bg_project_id = _bg_pc.project_id if _bg_pc else None
        except Exception:
            _bg_project_id = None
        _camera_project_ids[camera_id] = _bg_project_id

        faiss_manager = None
        state_memory  = None
        reid_lock     = None
        active_ids    = None
        if _reid_available and cfg.get("reid_enabled") and _bg_project_id:
            faiss_manager, state_memory, reid_lock, active_ids = _get_project_reid_context(
                _bg_project_id, cfg)

        _get_or_create_pipeline(camera_id, cap, track_registry, faiss_manager, state_memory, cfg,
                                reid_lock=reid_lock, active_ids=active_ids, project_id=_bg_project_id)
        logger.info(f"[ppe_bg] Background inference started for camera {camera_id}")

        return True

    except Exception as e:
        logger.error(f"[ppe_bg] Failed to start camera {camera_id}: {e}", exc_info=True)
        return False
    finally:
        if session_to_close and db:
            try:
                db.close()
            except Exception:
                pass


def stop_camera_background(camera_id: int) -> None:
    """Stop background inference pipeline for a camera."""
    pipeline = None
    with _camera_pipelines_lock:
        pipeline = _camera_pipelines.pop(camera_id, None)
    if pipeline:
        try:
            pipeline["stop"].set()
        except Exception:
            pass

        try:
            reader = pipeline.get("reader")
            inferencer = pipeline.get("inferencer")
            if reader:
                reader.join(timeout=1.0)
            if inferencer:
                inferencer.join(timeout=1.0)
        except Exception:
            pass

        try:
            # Use ref-counted release so workforce still using this capture isn't affected
            release_capture(camera_id)
        except Exception:
            pass

        try:
            if camera_id in _camera_track_registries:
                _camera_track_registries[camera_id].clear()
        except Exception:
            pass

        logger.info(f"[ppe_bg] Background inference stopped for camera {camera_id}")

    # Update worker_status to 'idle' regardless of whether pipeline existed
    # Create new session so we don't hold connection pool
    _db = SessionLocal()
    try:
        _cam = _db.query(Camera).filter(Camera.id == camera_id).first()
        if _cam:
            _cam.worker_status = "idle"
            _db.commit()
    except Exception as _e:
        logger.warning(f"[ppe_bg] Failed to update worker_status on stop for camera {camera_id}: {_e}")
        _db.rollback()
    finally:
        _db.close()

    # Save ReID gallery when pipeline stops (preserves recent identities)
    try:
        from ...services.reid_persistence import save_gallery
        _stop_project_id = _camera_project_ids.get(camera_id)
        if (_stop_project_id and
                _stop_project_id in _project_faiss_managers and
                _stop_project_id in _project_reid_locks):
            with _project_reid_locks[_stop_project_id]:
                save_gallery(
                    _project_faiss_managers[_stop_project_id],
                    _project_state_memories.get(_stop_project_id),
                    project_id=_stop_project_id,
                )
            logger.info(f"[ppe_bg] ReID gallery saved on stop for camera {camera_id} (project {_stop_project_id})")
    except Exception as _e:
        logger.debug(f"[ppe_bg] ReID gallery save on stop failed: {_e}")


__all__ = ["router", "start_camera_background", "stop_camera_background"]
