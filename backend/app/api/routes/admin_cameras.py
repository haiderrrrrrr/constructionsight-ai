import json
import base64
import subprocess
import tempfile
import os
import shutil


def _find_ffmpeg() -> str:
    """
    Locate the ffmpeg executable.
    Checks PATH first, then common Windows install locations including Agent DVR.
    Raises FileNotFoundError if not found anywhere.
    """
    found = shutil.which("ffmpeg")
    if found:
        return found
    candidates = [
        # Agent DVR bundles its own ffmpeg
        r"C:\Program Files\Agent\dlls\x64\ffmpeg.exe",
        r"C:\Program Files\Agent DVR\ffmpeg.exe",
        r"C:\Program Files (x86)\Agent DVR\ffmpeg.exe",
        r"C:\Agent DVR\ffmpeg.exe",
        # Standalone ffmpeg installs
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        r"C:\tools\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
        r"C:\ProgramData\scoop\apps\ffmpeg\current\bin\ffmpeg.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    raise FileNotFoundError("ffmpeg not found in PATH or common install locations")


def _normalize_rtsp_url(url: str) -> str:
    """
    Normalize RTSP URLs for reliable duplicate detection.

    Handles:
    - Trailing slashes: rtsp://cam/stream == rtsp://cam/stream/
    - Implicit vs explicit ports: rtsp://cam == rtsp://cam:554
    - Case sensitivity: RTSP:// == rtsp://
    - Whitespace: strips leading/trailing spaces

    Returns lowercase normalized URL for comparison.
    """
    if not url:
        return ""

    url = url.strip().lower()

    # Remove trailing slashes from path
    while url.endswith("/"):
        url = url[:-1]

    # Handle implicit port: rtsp://host == rtsp://host:554, rtsps://host == rtsps://host:322
    if "://" in url:
        protocol, rest = url.split("://", 1)
        if "/" in rest:
            host_part, path_part = rest.split("/", 1)
        else:
            host_part = rest
            path_part = ""

        # Add default port if not present
        if ":" not in host_part:
            if protocol == "rtsps":
                host_part += ":322"
            else:  # rtsp
                host_part += ":554"

        url = f"{protocol}://{host_part}/{path_part}" if path_part else f"{protocol}://{host_part}"

    return url
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ...core.db import get_db, SessionLocal
from ...core.crypto import encrypt_credential, decrypt_credential
from ...services.rtsp_probe import probe_rtsp, probe_rtsp_health, probe_onvif
from ...services.cloudinary import upload_image, delete_asset
from ...api.deps import require_admin, log_event, get_current_user
from ...models.user import User, PlatformRole
from ...models.site import Site
from ...models.camera import Camera, CameraCredential, CameraVerification, CameraHealthLog, RegistryStatus, CameraHealthStatus
from ...models.zone import Zone, CameraZonePolygon
from ...models.notification import Notification
from ...models.project_camera import ProjectCamera
from ...models.project import Project
from ...schemas.camera import (
    CameraCreate, CameraUpdate, CameraCredentialsUpdate,
    CameraOut, CameraDetailOut, CameraHealthSummaryOut, CameraHealthRowOut, CameraVerificationOut,
    CameraCredentialsOut, PTZMoveRequest, PTZGotoPresetRequest,
)
from ...schemas.zone import CameraZonePolygonCreate, CameraZonePolygonUpdate, CameraZonePolygonOut
from ...schemas.scheduler import SchedulerConfigUpdate
from ...schemas.ml_config import MLConfigUpdate
from ...services import camera_scheduler as sched

router = APIRouter(prefix="/admin/cameras", tags=["admin-cameras"])


# ── SSE stream — real-time camera health/verification events ──────────────────

def _admin_from_token(token: str, db: Session) -> User:
    """Decode JWT query param and return admin User — EventSource can't send headers."""
    from ...core.security import decode_access_token
    payload = decode_access_token(token)
    if not payload:
        try:
            log_event(db, "sse_admin_cameras_auth_denied", None, {"cause": "invalid_token"})
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("platform_role") != "admin":
        try:
            uid = int(payload.get("sub", 0) or 0) or None
            log_event(db, "sse_admin_cameras_auth_denied", uid, {"cause": "not_admin"})
        except Exception:
            pass
        raise HTTPException(status_code=403, detail="Admin access required")
    user_id = int(payload.get("sub", 0))
    user = db.get(User, user_id)
    if not user or not user.is_active:
        try:
            log_event(db, "sse_admin_cameras_auth_denied", user_id, {"cause": "user_inactive_or_missing"})
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not user.is_approved:
        try:
            log_event(db, "sse_admin_cameras_auth_denied", user_id, {"cause": "account_pending_approval"})
        except Exception:
            pass
        raise HTTPException(status_code=403, detail="Account pending approval")
    token_ver = int(payload.get("ver", 1) or 1)
    user_ver = int(user.token_version or 1)
    if token_ver != user_ver:
        try:
            log_event(db, "sse_admin_cameras_auth_denied", user_id, {"cause": "session_invalidated"})
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Session invalidated")
    return user


@router.get("/stream")
async def camera_health_stream(
    token: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    SSE stream — pushes camera_health_update and camera_verification_update events
    to all connected admin clients in real time.
    Auth via ?token= query param because EventSource cannot send Authorization headers.
    Heartbeat comment every 25s keeps the connection alive through proxies.
    """
    import asyncio as _asyncio
    from fastapi.responses import StreamingResponse
    from ...services.camera_health_broker import register as _reg, unregister as _unreg

    if not token:
        raise HTTPException(status_code=401, detail="token query param required")
    _admin_from_token(token, db)
    db.close()  # release DB connection before long-lived stream

    q = _reg()

    async def event_generator():
        try:
            while True:
                try:
                    payload = await _asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(payload)}\n\n"
                except _asyncio.TimeoutError:
                    yield ": heartbeat\n\n"
        finally:
            _unreg(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


# ── ONVIF stream discovery ────────────────────────────────────────────────────

class OnvifProbeRequest(BaseModel):
    host: str
    port: int = 80
    username: str
    password: Optional[str] = None
    camera_id: Optional[int] = None


class OnvifStreamOption(BaseModel):
    profile_name: str
    rtsp_url: str
    encoding: Optional[str] = None
    resolution: Optional[str] = None


class OnvifProbeResponse(BaseModel):
    streams: List[OnvifStreamOption]
    device_info: Optional[dict] = None


@router.post("/onvif-streams", response_model=OnvifProbeResponse)
def fetch_onvif_streams(
    payload: OnvifProbeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Connect to an ONVIF-capable camera with the supplied credentials and return
    all available media profile stream URIs (RTSP URLs).

    This mirrors Agent DVR's "Get Video URLs" button — the frontend calls this
    endpoint after the user enters host/port/username/password and lets the user
    pick which stream to use as the RTSP URL.

    Requires: pip install onvif-zeep
    """
    try:
        from onvif import ONVIFCamera  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="onvif-zeep is not installed on the server. Run: pip install onvif-zeep",
        )

    # If password not provided (edit mode, hidden for security), fall back to stored password
    password = payload.password
    if not password and payload.camera_id:
        cred = db.query(CameraCredential).filter(CameraCredential.camera_id == payload.camera_id).first()
        if cred and cred.password_enc:
            try:
                password = decrypt_credential(cred.password_enc)
            except Exception:
                pass

    if not password:
        raise HTTPException(status_code=422, detail="Password is required. Enter it in the Connection tab.")

    try:
        cam = ONVIFCamera(
            host=payload.host,
            port=payload.port,
            user=payload.username,
            passwd=password,
        )

        # ── Device info (optional, best-effort) ──────────────────────────────
        device_info: Optional[dict] = None
        try:
            info = cam.devicemgmt.GetDeviceInformation()
            device_info = {
                "manufacturer": getattr(info, "Manufacturer", None),
                "model": getattr(info, "Model", None),
                "firmware": getattr(info, "FirmwareVersion", None),
                "serial": getattr(info, "SerialNumber", None),
            }
        except Exception:
            pass

        # ── Media profiles + stream URIs ──────────────────────────────────────
        media_service = cam.create_media_service()
        profiles = media_service.GetProfiles()

        streams: List[OnvifStreamOption] = []
        for profile in profiles:
            try:
                stream_setup = {
                    "Stream": "RTP-Unicast",
                    "Transport": {"Protocol": "RTSP"},
                }
                uri_resp = media_service.GetStreamUri(
                    {"StreamSetup": stream_setup, "ProfileToken": profile.token}
                )
                rtsp_url = getattr(uri_resp, "Uri", None)
                if not rtsp_url:
                    continue

                # Resolution from video encoder config
                resolution: Optional[str] = None
                encoding: Optional[str] = None
                try:
                    vec = getattr(profile, "VideoEncoderConfiguration", None)
                    if vec:
                        res = getattr(vec, "Resolution", None)
                        if res:
                            resolution = f"{res.Width}x{res.Height}"
                        encoding = getattr(vec, "Encoding", None)
                except Exception:
                    pass

                streams.append(OnvifStreamOption(
                    profile_name=getattr(profile, "Name", profile.token),
                    rtsp_url=rtsp_url,
                    encoding=str(encoding) if encoding else None,
                    resolution=resolution,
                ))
            except Exception:
                continue

        if not streams:
            raise HTTPException(
                status_code=422,
                detail="ONVIF device responded but returned no media profiles. "
                       "Check username/password or try a different ONVIF port.",
            )

        return OnvifProbeResponse(streams=streams, device_info=device_info)

    except HTTPException:
        raise
    except Exception as exc:
        err = str(exc)
        if "Connection refused" in err or "timed out" in err.lower():
            raise HTTPException(
                status_code=502,
                detail=f"Cannot reach ONVIF device at {payload.host}:{payload.port}. "
                       "Check host, port, and network access.",
            )
        raise HTTPException(
            status_code=502,
            detail=f"ONVIF probe failed: {err[:300]}",
        )


@router.get("/discover")
def discover_cameras(current_user: User = Depends(require_admin)):
    """
    WS-Discovery UDP multicast scan — returns ONVIF devices found on the local network.
    Sends a Probe to 239.255.255.250:3702 and collects ProbeMatch responses for 5 s.
    No credentials required; XAddrs (service URL) and scopes (hardware/name) are parsed
    from each response.
    """
    from ...services.rtsp_probe import discover_onvif_cameras
    return discover_onvif_cameras(timeout=5.0)


@router.post("/upload-logo")
async def upload_camera_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(require_admin),
):
    """Upload a camera logo image to Cloudinary. Returns {url, public_id}."""
    allowed = {"image/png", "image/jpeg", "image/webp", "image/svg+xml"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=422, detail="Only PNG, JPEG, WebP, or SVG images are allowed.")

    contents = await file.read()
    if len(contents) > 2 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="Logo must be under 2 MB.")

    result = upload_image(
        contents,
        folder="constructionsight/camera-logos",
        public_id=f"camera_logo_{current_user.id}_{int(datetime.now(timezone.utc).timestamp())}",
    )
    return {
        "url": result.get("secure_url") or result.get("url"),
        "public_id": result.get("public_id"),
    }


class SnapshotRequest(BaseModel):
    rtsp_url: str
    transport: str = "tcp"


@router.post("/snapshot")
def capture_snapshot(
    payload: SnapshotRequest,
    current_user: User = Depends(require_admin),
):
    """
    Capture a single still frame from an RTSP stream using ffmpeg.
    Returns {image: "data:image/jpeg;base64,..."}.
    Enterprise practice: used during camera setup to confirm stream is live.
    Requires ffmpeg to be installed on the server.
    """
    if not payload.rtsp_url.startswith("rtsp://"):
        raise HTTPException(status_code=422, detail="rtsp_url must start with rtsp://")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cmd = [
            _find_ffmpeg(), "-y",
            "-rtsp_transport", payload.transport,
            "-i", payload.rtsp_url,
            "-frames:v", "1",
            "-q:v", "5",
            "-f", "image2",
            tmp_path,
        ]
        result = subprocess.run(
            cmd,
            timeout=15,
            capture_output=True,
        )
        if result.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            raise HTTPException(
                status_code=502,
                detail="ffmpeg could not capture a frame. Check the RTSP URL is reachable and the stream is live.",
            )
        with open(tmp_path, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode("utf-8")
        return {"image": f"data:image/jpeg;base64,{b64}"}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Stream capture timed out (15 s). Camera may be unreachable.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Snapshot failed: {str(exc)[:200]}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


@router.post("/{camera_id}/live-snapshot")
def camera_live_snapshot(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Capture a live frame from this camera's stored RTSP stream using ffmpeg.
    Decrypts credentials from DB — the frontend never needs to know the RTSP URL.
    Returns {image: "data:image/jpeg;base64,..."}.
    """
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    if not cred or not cred.rtsp_url_enc:
        raise HTTPException(status_code=422, detail="No RTSP URL configured for this camera")

    try:
        rtsp_url = decrypt_credential(cred.rtsp_url_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt camera credentials")

    # Embed credentials into URL if stored separately and not already in URL
    if cred.username_enc and cred.password_enc and "@" not in rtsp_url:
        try:
            username = decrypt_credential(cred.username_enc)
            password = decrypt_credential(cred.password_enc)
            # Insert user:pass@ after rtsp://
            rtsp_url = rtsp_url.replace("rtsp://", f"rtsp://{username}:{password}@", 1)
        except Exception:
            pass  # proceed with URL as-is

    transport = (cred.transport_preference or "tcp")

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        cmd = [
            _find_ffmpeg(), "-y",
            "-rtsp_transport", transport,
            "-i", rtsp_url,
            "-an",                    # skip audio — faster first video frame
            "-frames:v", "1",
            "-q:v", "3",
            "-f", "image2",
            tmp_path,
        ]
        result = subprocess.run(cmd, timeout=15, capture_output=True)
        if result.returncode != 0 or not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            stderr_hint = result.stderr.decode(errors="replace")[-300:] if result.stderr else ""
            raise HTTPException(
                status_code=502,
                detail=f"Could not capture frame: {stderr_hint or 'stream unreachable or auth failed'}",
            )
        with open(tmp_path, "rb") as f:
            raw = f.read()
        b64 = base64.b64encode(raw).decode("utf-8")
        return {"image": f"data:image/jpeg;base64,{b64}"}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Stream capture timed out (15 s).")
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="ffmpeg is not installed or not in PATH on this server. Install ffmpeg to enable live snapshots.",
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Snapshot failed: {str(exc)[:200]}")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


# ── MJPEG live stream ─────────────────────────────────────────────────────────

@router.get("/{camera_id}/mjpeg-stream")
def camera_mjpeg_stream(
    camera_id: int,
    token: str = Query(..., description="JWT access token — passed in URL because <img> cannot set Authorization headers"),
    db: Session = Depends(get_db),
):
    """
    Stream live MJPEG video from a camera's RTSP source.
    Auth via ?token= query param because browser <img> tags cannot send Authorization headers.
    Returns multipart/x-mixed-replace; boundary=frame (renders natively in <img> tags).
    """
    from ...core.security import decode_access_token
    from jose import JWTError
    from fastapi.responses import StreamingResponse as _StreamingResponse

    try:
        payload = decode_access_token(token)
    except (JWTError, Exception):
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = payload.get("sub")
    role = payload.get("platform_role")

    if role != PlatformRole.ADMIN.value:
        from ...models.project_camera import ProjectCamera
        from ...models.project_membership import ProjectMembership, MembershipStatus

        member = (
            db.query(ProjectMembership)
            .join(ProjectCamera, ProjectCamera.project_id == ProjectMembership.project_id)
            .filter(
                ProjectCamera.camera_id == camera_id,
                ProjectMembership.user_id == int(user_id),
                ProjectMembership.status == MembershipStatus.ACTIVE,
            )
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Access denied")

    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    if not cred or not cred.rtsp_url_enc:
        raise HTTPException(status_code=422, detail="No RTSP URL configured for this camera")

    try:
        rtsp_url = decrypt_credential(cred.rtsp_url_enc)
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to decrypt credentials")

    if cred.username_enc and cred.password_enc and "@" not in rtsp_url:
        try:
            username = decrypt_credential(cred.username_enc)
            password = decrypt_credential(cred.password_enc)
            rtsp_url = rtsp_url.replace("rtsp://", f"rtsp://{username}:{password}@", 1)
        except Exception:
            pass

    transport = cred.transport_preference or "tcp"

    try:
        ffmpeg_path = _find_ffmpeg()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    cmd = [
        ffmpeg_path, "-y",
        # Absolute minimum latency input flags — must come before -i
        "-fflags", "nobuffer+discardcorrupt",
        "-flags", "low_delay",
        "-probesize", "32",
        "-analyzeduration", "0",
        "-max_delay", "0",
        "-reorder_queue_size", "0",
        "-rtsp_transport", transport,
        "-i", rtsp_url,
        "-an",
        "-vsync", "passthrough",  # pass frames at camera's exact native rate, no resampling
        "-f", "mjpeg",
        "-q:v", "6",     # slightly lower quality = smaller frames = faster delivery
        "pipe:1",
    ]

    def generate():
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        try:
            buf = b""
            while True:
                chunk = proc.stdout.read(65536)  # 64KB reads — far fewer syscalls per frame
                if not chunk:
                    break
                buf += chunk
                # Parse individual JPEG frames: each starts with FFD8, ends with FFD9
                while True:
                    start = buf.find(b"\xff\xd8")
                    if start == -1:
                        buf = b""
                        break
                    end = buf.find(b"\xff\xd9", start + 2)
                    if end == -1:
                        buf = buf[start:]  # incomplete frame — wait for more data
                        break
                    frame = buf[start:end + 2]
                    buf = buf[end + 2:]
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n"
                        + frame +
                        b"\r\n"
                    )
        finally:
            try:
                proc.kill()
                proc.wait()
            except Exception:
                pass

    return _StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


# ── Helpers ───────────────────────────────────────────────────────────────────

def _camera_to_out(camera: Camera, db: Session) -> CameraOut:
    site = db.get(Site, camera.site_id)
    latest_log = (
        db.query(CameraHealthLog)
        .filter(CameraHealthLog.camera_id == camera.id)
        .order_by(CameraHealthLog.checked_at.desc())
        .first()
    )
    assignment = db.query(ProjectCamera).filter(ProjectCamera.camera_id == camera.id).first()
    project = db.get(Project, assignment.project_id) if assignment else None
    data = CameraOut.model_validate(camera)
    data.site_name = site.name if site else None
    data.latest_health_status = latest_log.health_status if latest_log else None
    data.project_id = project.id if project else None
    data.project_name = project.name if project else None
    return data


# Scheduler config schemas moved to schemas/scheduler.py


# ── List / Create ─────────────────────────────────────────────────────────────

@router.get("", response_model=List[CameraOut])
def list_cameras(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cameras = db.query(Camera).order_by(Camera.created_at.desc()).all()
    return [_camera_to_out(c, db) for c in cameras]


@router.post("", response_model=CameraOut, status_code=201)
def create_camera(
    request: Request,
    payload: CameraCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    site = db.get(Site, payload.site_id)
    if not site:
        raise HTTPException(status_code=404, detail="Site not found")

    # ── Duplicate guards ───────────────────────────────────────────────────────
    # 1. Camera name must be unique per site (primary dedup — catches re-imports)
    name_dup = db.query(Camera).filter(
        Camera.name == payload.name.strip(),
        Camera.site_id == payload.site_id,
        Camera.archived_at.is_(None),
    ).first()
    if name_dup:
        raise HTTPException(
            status_code=409,
            detail=f"A camera named '{payload.name}' already exists at this site. "
                   "Use a unique name or archive the existing camera first.",
        )

    # 2. Serial number unique per site (when provided)
    if payload.serial_number:
        dup = db.query(Camera).filter(
            Camera.serial_number == payload.serial_number,
            Camera.site_id == payload.site_id,
            Camera.archived_at.is_(None),
        ).first()
        if dup:
            raise HTTPException(
                status_code=409,
                detail=f"Camera with serial '{payload.serial_number}' already exists at this site.",
            )

    # 3. ONVIF host unique per site (prevent importing the same physical device twice)
    # Also check RTSP main URL uniqueness (catches re-importing same stream)
    existing_creds = (
        db.query(CameraCredential)
        .join(Camera, CameraCredential.camera_id == Camera.id)
        .filter(Camera.site_id == payload.site_id, Camera.archived_at.is_(None))
        .all()
    )
    for cred in existing_creds:
        # ONVIF host check
        if payload.onvif_host:
            try:
                stored_host = decrypt_credential(cred.onvif_host_enc) if cred.onvif_host_enc else None
            except Exception:
                stored_host = None
            if stored_host and stored_host.strip() == payload.onvif_host.strip():
                cam_name = db.get(Camera, cred.camera_id).name
                raise HTTPException(
                    status_code=409,
                    detail=f"A camera at ONVIF host '{payload.onvif_host}' is already registered "
                           f"at this site ('{cam_name}'). Archive it first or edit its credentials.",
                )
        # RTSP main URL check (with normalization to handle trailing slashes, port defaults, etc.)
        if payload.rtsp_url:
            try:
                stored_rtsp = decrypt_credential(cred.rtsp_url_enc) if cred.rtsp_url_enc else None
            except Exception:
                stored_rtsp = None
            if stored_rtsp and _normalize_rtsp_url(stored_rtsp) == _normalize_rtsp_url(payload.rtsp_url):
                cam_name = db.get(Camera, cred.camera_id).name
                raise HTTPException(
                    status_code=409,
                    detail=f"A camera with this Record RTSP URL is already registered at this site "
                           f"('{cam_name}'). Each camera must have a unique stream URL.",
                )

    camera = Camera(
        site_id=payload.site_id,
        name=payload.name,
        vendor=payload.vendor,
        model=payload.model,
        serial_number=payload.serial_number,
        onvif_supported=payload.onvif_supported,
        ptz_supported=payload.ptz_supported,
        connection_type=payload.connection_type,
        logo_url=payload.logo_url,
        logo_public_id=payload.logo_public_id,
        created_by=current_user.id,
        registry_status=RegistryStatus.draft,
    )
    db.add(camera)
    db.flush()

    cred = CameraCredential(
        camera_id=camera.id,
        rtsp_url_enc=encrypt_credential(payload.rtsp_url) if payload.rtsp_url else None,
        rtsp_url_sub_enc=encrypt_credential(payload.rtsp_url_sub) if payload.rtsp_url_sub else None,
        username_enc=encrypt_credential(payload.username) if payload.username else None,
        password_enc=encrypt_credential(payload.password) if payload.password else None,
        onvif_host_enc=encrypt_credential(payload.onvif_host) if payload.onvif_host else None,
        onvif_port=payload.onvif_port,
        transport_preference=payload.transport_preference or "tcp",
        updated_by=current_user.id,
    )
    db.add(cred)
    log_event(
        db,
        "camera_created",
        current_user.id,
        {"camera_id": camera.id, "camera_name": payload.name, "site_id": payload.site_id},
        request=request,
        target_type="camera",
        target_id=camera.id,
    )
    db.commit()
    db.refresh(camera)
    return _camera_to_out(camera, db)


# ── Health summary (MUST be before /{camera_id}) ─────────────────────────────

@router.get("/health", response_model=CameraHealthSummaryOut)
def camera_health_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    cameras = db.query(Camera).filter(Camera.archived_at.is_(None)).all()
    total = len(cameras)
    counts = {s: 0 for s in CameraHealthStatus}

    rows: List[CameraHealthRowOut] = []
    for cam in cameras:
        latest = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == cam.id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        if latest:
            counts[latest.health_status] += 1
            site = db.get(Site, cam.site_id)
            # FPS/resolution come from the latest successful verification (health checks are TCP-only)
            latest_verify = (
                db.query(CameraVerification)
                .filter(
                    CameraVerification.camera_id == cam.id,
                    CameraVerification.result_status == "verified",
                )
                .order_by(CameraVerification.completed_at.desc())
                .first()
            )
            rows.append(CameraHealthRowOut(
                id=latest.id,
                camera_id=cam.id,
                camera_name=cam.name,
                site_name=site.name if site else None,
                health_status=latest.health_status,
                checked_at=latest.checked_at,
                latency_ms=latest.latency_ms,
                message=latest.message,
                vendor=cam.vendor,
                model=cam.model,
                serial_number=cam.serial_number,
                registry_status=cam.registry_status.value if cam.registry_status else None,
                logo_url=cam.logo_url,
                onvif_supported=cam.onvif_supported,
                fps_detected=latest_verify.fps_detected if latest_verify else None,
                resolution_detected=latest_verify.resolution_detected if latest_verify else None,
            ))

    priority = {
        CameraHealthStatus.offline: 0, CameraHealthStatus.degraded: 1,
        CameraHealthStatus.maintenance: 2, CameraHealthStatus.healthy: 3,
    }
    rows.sort(key=lambda r: priority.get(r.health_status, 99))

    return CameraHealthSummaryOut(
        total=total,
        healthy=counts[CameraHealthStatus.healthy],
        degraded=counts[CameraHealthStatus.degraded],
        offline=counts[CameraHealthStatus.offline],
        maintenance=counts[CameraHealthStatus.maintenance],
        rows=rows,
    )


# ── Scheduler status + control (MUST be before /{camera_id}) ─────────────────

@router.get("/scheduler/status")
def scheduler_status(current_user: User = Depends(require_admin)):
    """Return current scheduler state: enabled, interval, last/next run, summary."""
    return sched.get_status()


@router.get("/scheduler/config")
def get_scheduler_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Get current scheduler configuration from DB."""
    from ...models.scheduler_config import SchedulerConfig

    config = db.query(SchedulerConfig).filter(SchedulerConfig.id == 1).first()
    if not config:
        # Fallback to defaults (shouldn't happen if migration ran)
        return {"enabled": True, "interval_minutes": 5}

    return {
        "enabled": config.enabled,
        "interval_minutes": config.interval_minutes
    }


@router.patch("/scheduler/config")
def update_scheduler_config(
    body: SchedulerConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update scheduler configuration in DB + hot-apply to running scheduler."""
    from ...models.scheduler_config import SchedulerConfig

    config = db.query(SchedulerConfig).filter(SchedulerConfig.id == 1).first()
    if not config:
        # Shouldn't happen (seeded in migration), but handle gracefully
        config = SchedulerConfig(id=1, enabled=True, interval_minutes=5)
        db.add(config)

    if body.enabled is not None:
        config.enabled = body.enabled
    if body.interval_minutes is not None:
        config.interval_minutes = body.interval_minutes

    db.commit()

    # Hot-update running scheduler
    sched.update_config(
        interval_minutes=body.interval_minutes,
        enabled=body.enabled
    )

    log_event(
        db,
        "scheduler_config_updated",
        current_user.id,
        {"enabled": config.enabled, "interval_minutes": config.interval_minutes},
        request=request,
        target_type="scheduler_config",
        target_id=1,
    )

    return sched.get_status()


@router.post("/scheduler/trigger")
def scheduler_trigger(current_user: User = Depends(require_admin)):
    """Immediately trigger one health-check cycle (non-blocking)."""
    if sched.get_status()["is_running"]:
        raise HTTPException(status_code=409, detail="A health-check cycle is already running")
    sched.trigger_now()
    return {"message": "Health-check cycle triggered"}


# ── ML Detection Config (enterprise configuration management) ─────────────────

@router.get("/ml/config")
def get_ml_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Get current ML detection configuration."""
    from ...models.ml_config import MLConfig
    from ...schemas.ml_config import MLConfigOut

    config = db.query(MLConfig).filter(MLConfig.id == 1).first()
    if not config:
        # Fallback to defaults (shouldn't happen if migration ran)
        from ...services.ml_config_service import DEFAULTS
        return DEFAULTS

    return MLConfigOut.from_orm(config)


@router.patch("/ml/config")
def update_ml_config(
    body,  # type: ignore
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update ML detection configuration + hot-apply to running processes."""
    from ...models.ml_config import MLConfig
    from ...schemas.ml_config import MLConfigUpdate, MLConfigOut
    from ...services.ml_config_service import invalidate_cache

    # Parse request with proper type
    if not isinstance(body, dict):
        body = body.dict(exclude_unset=True) if hasattr(body, 'dict') else dict(body)

    config = db.query(MLConfig).filter(MLConfig.id == 1).first()
    if not config:
        # Shouldn't happen (seeded in migration), but handle gracefully
        config = MLConfig(id=1)
        db.add(config)

    # Update only provided fields
    for key, value in body.items():
        if value is not None and hasattr(config, key):
            setattr(config, key, value)

    db.commit()
    db.refresh(config)

    # Invalidate cache so next frame uses new config
    invalidate_cache()

    log_event(
        db,
        "ml_config_updated",
        current_user.id,
        {"changes": body},
        request=request,
        target_type="ml_config",
        target_id=1,
    )

    return MLConfigOut.from_orm(config)


# ── Get / Update ──────────────────────────────────────────────────────────────

@router.get("/{camera_id}", response_model=CameraDetailOut)
def get_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    base = _camera_to_out(camera, db)
    verifications = (
        db.query(CameraVerification)
        .filter(CameraVerification.camera_id == camera_id)
        .order_by(CameraVerification.completed_at.desc().nullslast(), CameraVerification.id.desc())
        .all()
    )
    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    return CameraDetailOut(
        **base.model_dump(),
        verifications=[CameraVerificationOut.model_validate(v) for v in verifications],
        onvif_port=cred.onvif_port if cred else None,
    )


@router.get("/{camera_id}/credentials", response_model=CameraCredentialsOut)
def get_camera_credentials(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    if not cred:
        return CameraCredentialsOut()

    def _dec(v: Optional[str]) -> Optional[str]:
        if not v:
            return None
        try:
            return decrypt_credential(v)
        except Exception:
            return None

    return CameraCredentialsOut(
        rtsp_url=_dec(cred.rtsp_url_enc),
        rtsp_url_sub=_dec(cred.rtsp_url_sub_enc),
        username=_dec(cred.username_enc),
        onvif_host=_dec(cred.onvif_host_enc),
        onvif_port=cred.onvif_port,
        transport_preference=cred.transport_preference,
        has_password=bool(cred.password_enc),
    )


@router.patch("/{camera_id}", response_model=CameraOut)
def update_camera(
    camera_id: int,
    payload: CameraUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot edit an archived camera")

    updates = payload.model_dump(exclude_unset=True)

    # ── Duplicate guard for name changes ───────────────────────────────────
    if 'name' in updates and updates['name'] is not None:
        new_name = updates['name'].strip()
        name_dup = db.query(Camera).filter(
            Camera.name == new_name,
            Camera.site_id == (updates.get('site_id', camera.site_id)),
            Camera.id != camera_id,
            Camera.archived_at.is_(None),
        ).first()
        if name_dup:
            raise HTTPException(
                status_code=409,
                detail=f"Camera named '{new_name}' already exists at this site.",
            )

    # ── Duplicate guard for serial changes ──────────────────────────────────
    if 'serial_number' in updates and updates['serial_number'] is not None:
        serial_dup = db.query(Camera).filter(
            Camera.serial_number == updates['serial_number'],
            Camera.site_id == (updates.get('site_id', camera.site_id)),
            Camera.id != camera_id,
            Camera.archived_at.is_(None),
        ).first()
        if serial_dup:
            raise HTTPException(
                status_code=409,
                detail=f"Camera with serial '{updates['serial_number']}' already exists at this site.",
            )

    # ── Validate site_id exists if being changed ───────────────────────────
    if 'site_id' in updates:
        site = db.get(Site, updates['site_id'])
        if not site:
            raise HTTPException(status_code=404, detail="Site not found")

    for field, value in updates.items():
        setattr(camera, field, value)
    camera.updated_at = datetime.now(timezone.utc)
    log_event(
        db,
        "camera_updated",
        current_user.id,
        {"camera_id": camera_id, "fields": list(updates.keys())},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(camera)
    return _camera_to_out(camera, db)


@router.patch("/{camera_id}/credentials", response_model=CameraOut)
def update_camera_credentials(
    camera_id: int,
    payload: CameraCredentialsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot edit credentials of an archived camera")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    if not cred:
        cred = CameraCredential(camera_id=camera_id)
        db.add(cred)

    updates = payload.model_dump(exclude_unset=True)

    # ── Duplicate guard for RTSP URL changes ───────────────────────────────────
    if 'rtsp_url' in updates and updates['rtsp_url']:
        other_creds = db.query(CameraCredential).join(Camera).filter(
            Camera.site_id == camera.site_id,
            CameraCredential.camera_id != camera_id,
            CameraCredential.rtsp_url_enc.isnot(None),
        ).all()
        for other_cred in other_creds:
            try:
                stored_rtsp = decrypt_credential(other_cred.rtsp_url_enc)
            except Exception:
                stored_rtsp = None
            if stored_rtsp and _normalize_rtsp_url(stored_rtsp) == _normalize_rtsp_url(updates['rtsp_url']):
                other_cam = db.get(Camera, other_cred.camera_id)
                raise HTTPException(
                    status_code=409,
                    detail=f"A camera at this site already has this RTSP URL ('{other_cam.name}'). "
                           f"Each camera must have a unique stream URL.",
                )

    # ── Duplicate guard for ONVIF host changes ──────────────────────────────────
    if 'onvif_host' in updates and updates['onvif_host']:
        other_creds = db.query(CameraCredential).join(Camera).filter(
            Camera.site_id == camera.site_id,
            CameraCredential.camera_id != camera_id,
            CameraCredential.onvif_host_enc.isnot(None),
        ).all()
        for other_cred in other_creds:
            try:
                stored_host = decrypt_credential(other_cred.onvif_host_enc)
            except Exception:
                stored_host = None
            if stored_host and stored_host.strip() == updates['onvif_host'].strip():
                other_cam = db.get(Camera, other_cred.camera_id)
                raise HTTPException(
                    status_code=409,
                    detail=f"A camera at this site already has this ONVIF host ('{other_cam.name}'). "
                           f"Archive that camera first or choose a different host.",
                )
    enc_map = {
        "rtsp_url": "rtsp_url_enc",         # Main stream
        "rtsp_url_sub": "rtsp_url_sub_enc", # Sub-stream
        "username": "username_enc",
        "password": "password_enc",
        "onvif_host": "onvif_host_enc",
    }
    for src, dst in enc_map.items():
        if src in updates:
            setattr(cred, dst, encrypt_credential(updates[src]) if updates[src] else None)
    for field in ("onvif_port", "selected_stream_profile", "transport_preference"):
        if field in updates:
            setattr(cred, field, updates[field])
    cred.updated_by = current_user.id
    cred.updated_at = datetime.now(timezone.utc)

    log_event(
        db,
        "camera_credentials_updated",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(camera)
    return _camera_to_out(camera, db)


# ── Verify (BackgroundTask + real ffprobe) ────────────────────────────────────

def _run_verification(camera_id: int, transport: str, actor_id: int | None) -> None:
    """
    Background task: probe the RTSP stream with ffprobe (or TCP fallback),
    write the result to camera_verifications, and update registry_status.

    Uses its own DB session because the request session is closed by the time
    this runs.
    """
    db = SessionLocal()
    try:
        camera = db.get(Camera, camera_id)
        if not camera:
            return

        # If camera was archived while verification was running, don't update status
        if camera.archived_at:
            return

        cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
        rtsp_url: Optional[str] = None
        if cred and cred.rtsp_url_enc:
            try:
                rtsp_url = decrypt_credential(cred.rtsp_url_enc)
            except Exception:
                pass

        # Embed credentials into URL if stored separately (same as live-snapshot)
        if rtsp_url and cred and cred.username_enc and cred.password_enc and "@" not in rtsp_url:
            try:
                username = decrypt_credential(cred.username_enc)
                password = decrypt_credential(cred.password_enc)
                rtsp_url = rtsp_url.replace("rtsp://", f"rtsp://{username}:{password}@", 1)
            except Exception:
                pass

        started_at = datetime.now(timezone.utc)

        if not rtsp_url:
            success, fps, resolution, err = False, None, None, "No RTSP URL configured. Please enter a Record Stream URL (rtsp://) before verification."
            latency_ms = None
        else:
            success, fps, resolution, err = probe_rtsp(rtsp_url, transport=transport, timeout=10)
            _, latency_ms, _ = probe_rtsp_health(rtsp_url, timeout=5.0)

            # Improve error messages with more context
            if not success and err:
                if "timeout" in err.lower() or "connection refused" in err.lower():
                    err = f"Cannot connect to camera: {err}. Verify network connectivity, IP address, and port number are correct."
                elif "authentication" in err.lower() or "unauthorized" in err.lower():
                    err = f"Authentication failed: {err}. Check username and password credentials."
                elif "stream not found" in err.lower() or "404" in err.lower():
                    err = f"Stream not found: {err}. Verify the RTSP URL path is correct (e.g., /stream, /live, /h264)."
                elif "invalid protocol" in err.lower() or "unknown protocol" in err.lower():
                    err = f"Invalid URL format: {err}. RTSP URL must start with rtsp:// or rtsps://"

        # Optionally check ONVIF if supported and host is set
        onvif_note = ""
        if camera.onvif_supported and cred and cred.onvif_host_enc:
            try:
                onvif_host = decrypt_credential(cred.onvif_host_enc)
                onvif_port = cred.onvif_port or 80
                onvif_ok, onvif_err = probe_onvif(onvif_host, onvif_port)
                if not onvif_ok:
                    onvif_note = f" ONVIF check failed: {onvif_err or 'unreachable'} (check ONVIF host and port)."
            except Exception as e:
                onvif_note = f" ONVIF check error: {str(e)[:100]}"

        completed_at = datetime.now(timezone.utc)

        camera.registry_status = RegistryStatus.verified if success else RegistryStatus.verify_failed
        if success:
            camera.verified_at = completed_at

        failure_reason = err if not success else None
        if onvif_note and not success:
            failure_reason = (failure_reason or "") + onvif_note

        verification = CameraVerification(
            camera_id=camera_id,
            started_at=started_at,
            completed_at=completed_at,
            result_status="verified" if success else "verify_failed",
            failure_reason=failure_reason,
            fps_detected=fps,
            resolution_detected=resolution,
            latency_ms=latency_ms,
        )
        db.add(verification)
        log_event(
            db,
            "camera_verified",
            actor_id,
            {"camera_id": camera_id, "result": "verified" if success else "verify_failed"},
            target_type="camera",
            target_id=camera_id,
        )
        db.commit()
        if success:
            from ...services.notification_service import notify_admins as _notify_admins_verify
            _notify_admins_verify(
                db,
                type="camera_verified",
                title=f"Camera Verified: {camera.name}",
                message=f"Camera successfully verified and ready for use.",
                category="camera",
                priority="medium",
                action_url=f"/admin/cameras/{camera_id}",
                camera_id=camera_id,
            )
            db.commit()
        else:
            from ...services.notification_service import notify_admins as _notify_admins_fail
            _notify_admins_fail(
                db,
                type="camera_verify_failed",
                title=f"Camera Verification Failed: {camera.name}",
                message=f"Camera verification failed. Please check RTSP credentials and network connectivity.",
                category="camera",
                priority="high",
                action_url=f"/admin/cameras/{camera_id}",
                camera_id=camera_id,
            )
            db.commit()
        # Push SSE: verification result (verified or verify_failed)
        try:
            from ...services.camera_health_broker import push as _cam_push_done
            from ...services.project_camera_broker import push as _proj_push_done
            _done_payload = {
                "type": "camera_verification_update",
                "camera_id": camera_id,
                "registry_status": "verified" if success else "verify_failed",
                "fps_detected": fps,
                "resolution_detected": resolution,
                "failure_reason": failure_reason,
            }
            _cam_push_done(_done_payload)
            for _pc in db.query(ProjectCamera).filter(ProjectCamera.camera_id == camera_id).all():
                _proj_push_done(_pc.project_id, _done_payload)
        except Exception:
            pass

        if success:
            # Auto-run health check immediately after first successful verification
            try:
                sched.run_health_check_for_camera(camera, db)
                db.commit()
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning("Auto health-check after verify failed for camera %d: %s", camera_id, exc)

        if success and rtsp_url:
            try:
                from ...services.rtsp_ingestion import ingestion_manager
                from ...services.ai_orchestrator import get_orchestrator
                ingestion_manager.start_camera(camera_id, rtsp_url)
                orch = get_orchestrator()
                orch.start()
                orch.notify_camera_started(camera_id)
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning("AI autostart failed for camera %d: %s", camera_id, exc)
    except Exception as exc:
        # Write a failed verification so the user sees something went wrong
        try:
            cam = db.get(Camera, camera_id)
            if cam:
                cam.registry_status = RegistryStatus.verify_failed
                db.add(CameraVerification(
                    camera_id=camera_id,
                    started_at=datetime.now(timezone.utc),
                    completed_at=datetime.now(timezone.utc),
                    result_status="verify_failed",
                    failure_reason=f"Internal error: {str(exc)[:300]}",
                ))
                db.commit()
                # Push SSE: internal error
                try:
                    from ...services.camera_health_broker import push as _cam_push_err
                    from ...services.project_camera_broker import push as _proj_push_err
                    _err_payload = {
                        "type": "camera_verification_update",
                        "camera_id": camera_id,
                        "registry_status": "verify_failed",
                        "fps_detected": None,
                        "resolution_detected": None,
                        "failure_reason": f"Internal error: {str(exc)[:300]}",
                    }
                    _cam_push_err(_err_payload)
                    for _pc2 in db.query(ProjectCamera).filter(ProjectCamera.camera_id == camera_id).all():
                        _proj_push_err(_pc2.project_id, _err_payload)
                except Exception:
                    pass
        except Exception:
            pass
    finally:
        db.close()


@router.post("/{camera_id}/verify", response_model=CameraOut)
def verify_camera(
    camera_id: int,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Start RTSP stream verification.
    Returns immediately with status='verifying'; the actual ffprobe probe
    runs in a background task.  Poll GET /admin/cameras/{id} to check progress.
    """
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot verify an archived camera")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    transport = (cred.transport_preference if cred else None) or "tcp"

    camera.registry_status = RegistryStatus.verifying
    log_event(
        db,
        "camera_verify_started",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(camera)

    # Push SSE immediately: status changed to verifying
    from ...services.camera_health_broker import push as _cam_push
    from ...services.project_camera_broker import push as _proj_push
    _verifying_payload = {
        "type": "camera_verification_update",
        "camera_id": camera_id,
        "registry_status": "verifying",
        "fps_detected": None,
        "resolution_detected": None,
        "failure_reason": None,
    }
    _cam_push(_verifying_payload)
    for _pc in db.query(ProjectCamera).filter(ProjectCamera.camera_id == camera_id).all():
        _proj_push(_pc.project_id, _verifying_payload)

    background_tasks.add_task(_run_verification, camera_id, transport, current_user.id)
    return _camera_to_out(camera, db)


# ── Health-check (real TCP probe + notification on status change) ─────────────

@router.post("/{camera_id}/health-check", response_model=CameraOut)
def health_check_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """
    Manual health-check: TCP probe via shared camera_scheduler logic.
    Returns 409 if the scheduler is already checking this camera.
    Fires notifications on status change (worsening or recovery).
    """
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot health-check an archived camera")

    if not sched.acquire_check(camera_id):
        raise HTTPException(
            status_code=409,
            detail="Health check already in progress for this camera — try again shortly",
        )
    try:
        result = sched.run_health_check_for_camera(camera, db)
        log_event(
            db, "camera_health_checked", current_user.id,
            {"camera_id": camera_id, "status": result["status"],
             "latency_ms": result["latency_ms"], "source": "manual"},
            request=request,
            target_type="camera",
            target_id=camera_id,
        )
        db.commit()
        db.refresh(camera)
        return _camera_to_out(camera, db)
    finally:
        sched.release_check(camera_id)


# ── Archive ───────────────────────────────────────────────────────────────────

@router.post("/{camera_id}/archive", response_model=CameraOut)
def archive_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Camera is already archived")

    now = datetime.now(timezone.utc)
    camera.archived_at = now
    camera.registry_status = RegistryStatus.archived
    log_event(
        db,
        "camera_archived",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(camera)
    return _camera_to_out(camera, db)


# ── Unarchive ─────────────────────────────────────────────────────────────────

@router.post("/{camera_id}/unarchive", response_model=CameraOut)
def unarchive_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if not camera.archived_at:
        raise HTTPException(status_code=400, detail="Camera is not archived")

    camera.archived_at = None
    # Restore previous status based on verification history
    # If camera has verified status before, restore to verified; otherwise draft
    latest_verification = db.query(CameraVerification).filter(
        CameraVerification.camera_id == camera_id,
        CameraVerification.result_status == "verified"
    ).order_by(CameraVerification.completed_at.desc()).first()

    if latest_verification:
        camera.registry_status = RegistryStatus.verified
    else:
        camera.registry_status = RegistryStatus.draft

    log_event(
        db,
        "camera_unarchived",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(camera)
    if camera.registry_status == RegistryStatus.verified:
        try:
            cred = db.query(CameraCredential).filter_by(camera_id=camera_id).first()
            if cred and cred.rtsp_url_enc:
                from ...core.crypto import decrypt_credential
                rtsp_url = decrypt_credential(cred.rtsp_url_enc)
                if cred.username_enc and cred.password_enc and "@" not in rtsp_url:
                    try:
                        username = decrypt_credential(cred.username_enc)
                        password = decrypt_credential(cred.password_enc)
                        rtsp_url = rtsp_url.replace("rtsp://", f"rtsp://{username}:{password}@", 1)
                    except Exception:
                        pass
                from ...services.rtsp_ingestion import ingestion_manager
                from ...services.ai_orchestrator import get_orchestrator
                ingestion_manager.start_camera(camera_id, rtsp_url)
                orch = get_orchestrator()
                orch.start()
                orch.notify_camera_started(camera_id)
        except Exception:
            pass
    return _camera_to_out(camera, db)


# ── Delete ────────────────────────────────────────────────────────────────────

@router.delete("/{camera_id}", status_code=204)
def delete_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Archived cameras cannot be deleted to maintain compliance and audit trail.")

    camera_name = camera.name

    # Delete Cloudinary logo asset first (best-effort with error logging)
    if camera.logo_public_id:
        try:
            delete_asset(camera.logo_public_id)
            log_event(
                db,
                "camera_logo_deleted",
                current_user.id,
                {"camera_id": camera_id, "logo_public_id": camera.logo_public_id},
                request=request,
                target_type="camera",
                target_id=camera_id,
            )
        except Exception as e:
            # Log error but don't fail - logo cleanup is non-blocking
            import logging
            logging.error(f"Failed to delete logo asset {camera.logo_public_id} for camera {camera_id}: {str(e)}")
            log_event(
                db,
                "camera_logo_delete_failed",
                current_user.id,
                {"camera_id": camera_id, "logo_public_id": camera.logo_public_id, "error": str(e)[:200]},
                request=request,
                target_type="camera",
                target_id=camera_id,
            )

    # Delete all child records (no ORM cascade defined — handle explicitly)
    db.query(CameraZonePolygon).filter(CameraZonePolygon.camera_id == camera_id).delete()
    db.query(CameraHealthLog).filter(CameraHealthLog.camera_id == camera_id).delete()
    db.query(CameraVerification).filter(CameraVerification.camera_id == camera_id).delete()
    db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).delete()
    db.query(Notification).filter(Notification.camera_id == camera_id).delete()

    # Preserve all analytics history — null camera_id so records survive camera deletion
    # Data stays linked to project_id for dashboards; camera reference becomes NULL
    from ...models.activity_snapshot import ActivitySnapshot
    from ...models.activity_alert import ActivityAlert
    from ...models.workforce_snapshot import WorkforceSnapshot
    from ...models.workforce_alert import WorkforceAlert
    from ...models.equipment_snapshot import EquipmentSnapshot
    from ...models.equipment_alert import EquipmentAlert
    from ...models.risk_snapshot import RiskSnapshot
    from ...models.risk_event import RiskEvent
    from ...models.ppe_incident import PpeIncident
    _null = {"camera_id": None}
    db.query(ActivitySnapshot).filter(ActivitySnapshot.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(ActivityAlert).filter(ActivityAlert.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(WorkforceSnapshot).filter(WorkforceSnapshot.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(WorkforceAlert).filter(WorkforceAlert.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(EquipmentSnapshot).filter(EquipmentSnapshot.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(EquipmentAlert).filter(EquipmentAlert.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(RiskSnapshot).filter(RiskSnapshot.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(RiskEvent).filter(RiskEvent.camera_id == camera_id).update(_null, synchronize_session=False)
    db.query(PpeIncident).filter(PpeIncident.camera_id == camera_id).update(_null, synchronize_session=False)

    # Delete ProjectCamera assignments (unassign from all projects)
    # Must delete analytics first — they FK-reference project_cameras rows
    from ...models.project_camera import ProjectCamera
    from ...models.project_camera_analytics import ProjectCameraAnalytics
    pc_ids = [row.id for row in db.query(ProjectCamera.id).filter(ProjectCamera.camera_id == camera_id).all()]
    if pc_ids:
        db.query(ProjectCameraAnalytics).filter(ProjectCameraAnalytics.project_camera_id.in_(pc_ids)).delete(synchronize_session=False)
    db.query(ProjectCamera).filter(ProjectCamera.camera_id == camera_id).delete()

    log_event(
        db,
        "camera_deleted",
        current_user.id,
        {"camera_id": camera_id, "camera_name": camera_name},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.delete(camera)
    db.commit()


# ── Zone-polygon routes ───────────────────────────────────────────────────────
# Each site can have multiple operational zones. Camera-specific zone polygons
# are configured per assigned camera view and may represent all or part of
# those site zones.
#
# One camera can have multiple active zone polygons (one per zone it covers).
# Different cameras in the same site may cover different subsets of the same
# site's zones. Two cameras may define different polygons for the same
# real-world site area. Editing a polygon on one camera never silently
# overwrites polygons on other cameras.

def _polygon_to_out(p: CameraZonePolygon, db: Session) -> CameraZonePolygonOut:
    zone = db.get(Zone, p.zone_id)
    site_name = None
    if zone:
        site = db.get(Site, zone.site_id)
        site_name = site.name if site else None
    points_parsed = None
    if p.points:
        try:
            points_parsed = json.loads(p.points)
        except Exception:
            points_parsed = p.points
    return CameraZonePolygonOut(
        id=p.id,
        camera_id=p.camera_id,
        zone_id=p.zone_id,
        zone_name=zone.name if zone else None,
        site_name=site_name,
        points=points_parsed,
        label=p.label,
        zone_category=p.zone_category,
        is_active=p.is_active,
        version=p.version,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


@router.get("/{camera_id}/zone-polygons", response_model=List[CameraZonePolygonOut])
def list_zone_polygons(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    polygons = (
        db.query(CameraZonePolygon)
        .filter(CameraZonePolygon.camera_id == camera_id)
        .order_by(CameraZonePolygon.created_at.desc())
        .all()
    )
    return [_polygon_to_out(p, db) for p in polygons]


@router.post("/{camera_id}/zone-polygons", response_model=CameraZonePolygonOut, status_code=201)
def add_zone_polygon(
    camera_id: int,
    payload: CameraZonePolygonCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot configure zones on an archived camera")
    zone = db.get(Zone, payload.zone_id)
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    if zone.site_id != camera.site_id:
        raise HTTPException(status_code=400, detail="Zone does not belong to this camera's site")
    points_json = json.dumps([p.model_dump() for p in payload.points]) if payload.points else None
    polygon = CameraZonePolygon(
        camera_id=camera_id,
        zone_id=payload.zone_id,
        points=points_json,
        label=payload.label,
        zone_category=payload.zone_category,
        created_by=current_user.id,
        updated_by=current_user.id,
    )
    db.add(polygon)
    db.flush()
    log_event(
        db,
        "camera_zone_polygon_added",
        current_user.id,
        {"camera_id": camera_id, "zone_id": payload.zone_id, "polygon_id": polygon.id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    db.refresh(polygon)
    return _polygon_to_out(polygon, db)


@router.patch("/{camera_id}/zone-polygons/{polygon_id}", response_model=CameraZonePolygonOut)
def update_zone_polygon(
    camera_id: int,
    polygon_id: int,
    payload: CameraZonePolygonUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    polygon = db.query(CameraZonePolygon).filter(
        CameraZonePolygon.id == polygon_id,
        CameraZonePolygon.camera_id == camera_id,
    ).first()
    if not polygon:
        raise HTTPException(status_code=404, detail="Zone polygon not found")
    updates = payload.model_dump(exclude_unset=True)
    if "points" in updates and updates["points"] is not None:
        polygon.points = json.dumps([p.model_dump() for p in payload.points])
        del updates["points"]
    for field, value in updates.items():
        setattr(polygon, field, value)
    polygon.updated_by = current_user.id
    polygon.version = (polygon.version or 1) + 1
    polygon.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(polygon)
    return _polygon_to_out(polygon, db)


@router.delete("/{camera_id}/zone-polygons/{polygon_id}", status_code=204)
def delete_zone_polygon(
    camera_id: int,
    polygon_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    polygon = db.query(CameraZonePolygon).filter(
        CameraZonePolygon.id == polygon_id,
        CameraZonePolygon.camera_id == camera_id,
    ).first()
    if not polygon:
        raise HTTPException(status_code=404, detail="Zone polygon not found")
    log_event(
        db,
        "camera_zone_polygon_removed",
        current_user.id,
        {"camera_id": camera_id, "polygon_id": polygon_id, "zone_id": polygon.zone_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.delete(polygon)
    db.commit()


# ── AI detection control ───────────────────────────────────────────────────────

@router.post("/{camera_id}/ai/start")
def start_ai_for_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Start RTSP ingestion + AI sampling for a specific camera."""
    camera = db.query(Camera).filter_by(id=camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    cred = db.query(CameraCredential).filter_by(camera_id=camera_id).first()
    if not cred or not cred.rtsp_url_enc:
        raise HTTPException(status_code=400, detail="Camera has no RTSP credentials")

    from ...core.crypto import decrypt_credential
    from ...services.rtsp_ingestion import ingestion_manager
    from ...services.ai_orchestrator import get_orchestrator

    try:
        rtsp_url = decrypt_credential(cred.rtsp_url_enc)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to decrypt RTSP credentials")

    if cred.username_enc and cred.password_enc and "@" not in rtsp_url:
        try:
            username = decrypt_credential(cred.username_enc)
            password = decrypt_credential(cred.password_enc)
            rtsp_url = rtsp_url.replace("rtsp://", f"rtsp://{username}:{password}@", 1)
        except Exception:
            pass

    ingestion_manager.start_camera(camera_id, rtsp_url)
    orch = get_orchestrator()
    orch.start()
    orch.notify_camera_started(camera_id)
    log_event(
        db,
        "ai_started",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    return {"camera_id": camera_id, "status": "started"}


@router.post("/{camera_id}/ai/stop")
def stop_ai_for_camera(
    camera_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Stop RTSP ingestion + AI sampling for a specific camera."""
    from ...services.rtsp_ingestion import ingestion_manager
    from ...services.ai_orchestrator import get_orchestrator
    from ...services.incident_engine import incident_engine

    ingestion_manager.stop_camera(camera_id)
    get_orchestrator().notify_camera_stopped(camera_id)
    incident_engine.clear_camera(camera_id)
    log_event(
        db,
        "ai_stopped",
        current_user.id,
        {"camera_id": camera_id},
        request=request,
        target_type="camera",
        target_id=camera_id,
    )
    db.commit()
    return {"camera_id": camera_id, "status": "stopped"}


@router.get("/{camera_id}/ai/status")
def ai_status_for_camera(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Return AI pipeline status for a camera."""
    from ...services.rtsp_ingestion import ingestion_manager
    from ...core.config import settings

    stream_status = ingestion_manager.status(camera_id)
    return {
        "camera_id":      camera_id,
        "active":         stream_status.get("active", False),
        "healthy":        stream_status.get("healthy", False),
        "last_frame_at":  stream_status.get("last_frame_at"),
        "fps_target":     settings.ppe_target_fps,
        "mode":           settings.ai_mode,
        "tracker":        settings.ppe_tracker,
        "batch":          settings.ppe_batch_inference,
        "error":          stream_status.get("error"),
    }


@router.post("/{camera_id}/projects/{project_id}", status_code=201)
def admin_assign_camera_to_project(
    camera_id: int,
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin: assign a camera to a project (override endpoint).

    Admin overrides permission checks but still enforces data integrity:
    - Camera must be verified (not draft/failed)
    - Camera must be on same site as project
    - Project must not be archived
    """
    from ...models.project import Project, ProjectStatus
    from ...models.project_camera import ProjectCamera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Cannot assign cameras to archived projects")

    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Data integrity checks (even admin must respect these)
    if camera.archived_at:
        raise HTTPException(status_code=400, detail="Cannot assign archived cameras")

    if camera.registry_status != RegistryStatus.verified:
        raise HTTPException(status_code=400, detail=f"Camera must be verified (current: {camera.registry_status.value})")

    if camera.site_id != project.site_id:
        raise HTTPException(status_code=400, detail="Camera must be on the same site as the project")

    existing = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Camera already assigned to this project")

    assignment = ProjectCamera(
        project_id=project_id,
        camera_id=camera_id,
        assigned_by=admin.id,
    )
    db.add(assignment)
    db.flush()  # get assignment.id before creating analytics

    # Always create a default analytics row so feature toggles work immediately.
    # inference_events_enabled=True matches the legacy behaviour (no row = events on).
    from ...models.project_camera_analytics import ProjectCameraAnalytics as _PCA
    db.add(_PCA(project_camera_id=assignment.id, inference_events_enabled=True))

    from ...api.deps import log_event

    log_event(
        db,
        "camera_assigned",
        admin.id,
        {
            "project_id": project_id,
            "camera_id": camera_id,
            "assigned_by_role": "admin",
        },
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()
    db.refresh(assignment)
    return assignment


@router.delete("/{camera_id}/projects/{project_id}", status_code=204)
def admin_unassign_camera_from_project(
    camera_id: int,
    project_id: int,
    request: Request,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin: unassign a camera from a project (override endpoint).

    Admin can unassign any camera from any project, but cannot unassign from archived projects.
    This deletion cascades: all analytics records for this assignment are deleted.
    """
    from ...models.project import Project, ProjectStatus
    from ...models.project_camera import ProjectCamera

    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    if project.status == ProjectStatus.ARCHIVED:
        raise HTTPException(status_code=400, detail="Cannot modify archived projects")

    assignment = db.query(ProjectCamera).filter(
        ProjectCamera.project_id == project_id,
        ProjectCamera.camera_id == camera_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Camera not assigned to this project")

    # Delete analytics records first (they reference project_cameras)
    from sqlalchemy import text
    analytics_count = db.execute(text("SELECT COUNT(*) FROM project_camera_analytics WHERE project_camera_id = :pc_id"), {"pc_id": assignment.id}).scalar()
    db.execute(text("DELETE FROM project_camera_analytics WHERE project_camera_id = :pc_id"), {"pc_id": assignment.id})

    # Now delete the assignment
    db.delete(assignment)
    from ...api.deps import log_event

    log_event(
        db,
        "camera_unassigned",
        admin.id,
        {
            "project_id": project_id,
            "camera_id": camera_id,
            "analytics_deleted": analytics_count,
            "unassigned_by_role": "admin",
            "note": "All associated inference records and analytics were deleted with this unassignment",
        },
        request=request,
        target_type="project",
        target_id=project_id,
    )
    db.commit()


# ── PTZ Control Endpoints ─────────────────────────────────────────────────────

def _ptz_auth_and_creds(camera_id: int, db: Session, current_user: User):
    """
    Verify camera exists, supports PTZ, and the caller has permission.
    Admin is always allowed; non-admin must be an ACTIVE project member.
    Returns (host, port, username, password, profile_token).
    """
    camera = db.get(Camera, camera_id)
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    if not camera.ptz_supported:
        raise HTTPException(status_code=400, detail="This camera does not support PTZ")
    if not camera.onvif_supported:
        raise HTTPException(status_code=400, detail="PTZ requires ONVIF to be enabled on this camera")

    if current_user.platform_role != PlatformRole.ADMIN:
        from ...models.project_membership import ProjectMembership, MembershipStatus
        member = (
            db.query(ProjectMembership)
            .join(ProjectCamera, ProjectCamera.project_id == ProjectMembership.project_id)
            .filter(
                ProjectCamera.camera_id == camera_id,
                ProjectMembership.user_id == current_user.id,
                ProjectMembership.status == MembershipStatus.ACTIVE,
            )
            .first()
        )
        if not member:
            raise HTTPException(status_code=403, detail="Access denied")

    cred = db.query(CameraCredential).filter(CameraCredential.camera_id == camera_id).first()
    if not cred or not cred.onvif_host_enc:
        raise HTTPException(status_code=400, detail="Camera has no ONVIF credentials configured")

    host = decrypt_credential(cred.onvif_host_enc)
    port = cred.onvif_port or 80
    username = decrypt_credential(cred.username_enc) if cred.username_enc else ""
    password = decrypt_credential(cred.password_enc) if cred.password_enc else ""
    profile_token = cred.selected_stream_profile or None  # None → auto-detect from device
    return host, port, username, password, profile_token


@router.post("/{camera_id}/ptz/move", status_code=204)
def ptz_move(
    camera_id: int,
    body: PTZMoveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ...services.onvif_ptz import ptz_continuous_move
    host, port, username, password, profile_token = _ptz_auth_and_creds(camera_id, db, current_user)
    ptz_continuous_move(camera_id, host, port, username, password, profile_token,
                        body.pan, body.tilt, body.zoom, body.speed)


@router.post("/{camera_id}/ptz/stop", status_code=204)
def ptz_stop_endpoint(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ...services.onvif_ptz import ptz_stop
    host, port, username, password, profile_token = _ptz_auth_and_creds(camera_id, db, current_user)
    ptz_stop(camera_id, host, port, username, password, profile_token)


@router.get("/{camera_id}/ptz/presets")
def ptz_list_presets(
    camera_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ...services.onvif_ptz import ptz_get_presets
    host, port, username, password, profile_token = _ptz_auth_and_creds(camera_id, db, current_user)
    return ptz_get_presets(camera_id, host, port, username, password, profile_token)


@router.post("/{camera_id}/ptz/presets/goto", status_code=204)
def ptz_goto_preset_endpoint(
    camera_id: int,
    body: PTZGotoPresetRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from ...services.onvif_ptz import ptz_goto_preset
    host, port, username, password, profile_token = _ptz_auth_and_creds(camera_id, db, current_user)
    ptz_goto_preset(camera_id, host, port, username, password, profile_token, body.preset_token)


# ── Camera Registry PDF Export ─────────────────────────────────────────────────
class CamerasExportPdfBody(BaseModel):
    filter: str = "all"
    generated_by_name: str = "Administrator"


@router.post("/export/pdf")
def export_cameras_registry_pdf(
    body: CamerasExportPdfBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Cameras",
        "verified": "Verified",
        "draft": "Draft",
        "archived": "Archived",
        "assigned": "Assigned",
        "unassigned": "Unassigned",
        "failed": "Failed",
        "verifying": "Verifying",
        "unverified": "Unverified",
    }
    filter_label = filter_map.get(filter_val, "All Cameras")

    query = db.query(Camera).order_by(Camera.created_at.desc())
    if filter_val == "verified":
        query = query.filter(Camera.registry_status == RegistryStatus.VERIFIED)
    elif filter_val == "draft":
        query = query.filter(Camera.registry_status == RegistryStatus.DRAFT)
    elif filter_val == "failed":
        query = query.filter(Camera.registry_status == RegistryStatus.VERIFY_FAILED)
    elif filter_val == "verifying":
        query = query.filter(Camera.registry_status == RegistryStatus.VERIFYING)
    elif filter_val == "archived":
        query = query.filter(Camera.archived_at.isnot(None))

    cameras = query.all()

    assigned_ids = set()
    if filter_val in ("assigned", "unassigned"):
        assigned_ids = {row[0] for row in db.query(ProjectCamera.camera_id).distinct().all()}
        if filter_val == "assigned":
            cameras = [c for c in cameras if c.id in assigned_ids]
        else:
            cameras = [c for c in cameras if c.id not in assigned_ids]

    cam_ids = [c.id for c in cameras]
    latest_health: dict = {}
    if cam_ids:
        logs = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id.in_(cam_ids))
            .order_by(CameraHealthLog.checked_at.desc())
            .all()
        )
        for lg in logs:
            if lg.camera_id not in latest_health:
                latest_health[lg.camera_id] = lg.health_status.value if lg.health_status else None

    def _fmt_date_pk(v):
        if not v:
            return "—"
        try:
            from datetime import timedelta as _td
            pk = timezone(_td(hours=5))
            if getattr(v, "tzinfo", None) is None:
                v = v.replace(tzinfo=timezone.utc)
            return v.astimezone(pk).strftime("%b %d, %Y")
        except Exception:
            return _fmt_date(v)

    def _get_site(c):
        if c.site_id:
            s = db.query(Site).filter(Site.id == c.site_id).first()
            return s.name if s else "—"
        return "—"

    def _fmt_date(v):
        if not v:
            return "—"
        try:
            if hasattr(v, "strftime"):
                return v.strftime("%b %d, %Y")
            from datetime import datetime as _dt
            return _dt.fromisoformat(str(v).replace("Z", "+00:00")).strftime("%b %d, %Y")
        except Exception:
            return str(v)

    def _status_label(s):
        return {"verified": "Verified", "unverified": "Unverified", "failed": "Failed",
                "archived": "Archived"}.get(str(s or "").lower(), str(s or "—").capitalize())

    headers = ["Camera Name", "Site", "Vendor", "Model", "Serial", "Reg. Status", "Health", "Created"]
    rows_data = [
        [
            str(c.name or "—"),
            _get_site(c),
            str(c.vendor or "—"),
            str(c.model or "—"),
            str(c.serial_number or "—"),
            _status_label(getattr(c.registry_status, "value", c.registry_status)),
            str((latest_health.get(c.id) or "—")).replace("_", " ").title(),
            _fmt_date_pk(c.created_at),
        ]
        for c in cameras
    ]

    total = len(rows_data)
    verified_n = sum(1 for c in cameras if str(getattr(c.registry_status, "value", c.registry_status) or "").lower() == "verified")
    draft_n = sum(1 for c in cameras if str(getattr(c.registry_status, "value", c.registry_status) or "").lower() == "draft")
    failed_n = sum(1 for c in cameras if str(getattr(c.registry_status, "value", c.registry_status) or "").lower() in ("verify_failed", "failed"))
    archived_n = sum(1 for c in cameras if bool(c.archived_at) or str(getattr(c.registry_status, "value", c.registry_status) or "").lower() == "archived")

    kpi_items = [
        (total, "Total", HexColor("#ffffff"), HexColor("#1e3a5f")),
        (verified_n, "Verified", HexColor("#15803d"), HexColor("#dcfce7")),
        (draft_n, "Draft", HexColor("#b45309"), HexColor("#fef3c7")),
        (archived_n, "Archived", HexColor("#6b7280"), HexColor("#f1f5f9")),
    ]
    status_fg = {
        "verified": HexColor("#15803d"),
        "draft": HexColor("#b45309"),
        "verifying": HexColor("#0f766e"),
        "verify_failed": HexColor("#b91c1c"),
        "failed": HexColor("#b91c1c"),
        "archived": HexColor("#6b7280"),
    }
    status_bg = {
        "verified": HexColor("#dcfce7"),
        "draft": HexColor("#fef3c7"),
        "verifying": HexColor("#ccfbf1"),
        "verify_failed": HexColor("#fee2e2"),
        "failed": HexColor("#fee2e2"),
        "archived": HexColor("#f1f5f9"),
    }

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Camera Registry Report",
            headers=headers, rows=rows_data,
            col_widths=[95, 85, 65, 65, 75, 65, 55, 60],
            meta_pairs=[("Report", "Camera Registry Directory")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or admin.full_name or "Administrator"),
            kpi_items=kpi_items,
            status_col_index=5,
            status_fg=status_fg,
            status_bg=status_bg,
        )
        fname = f"Cameras_Registry_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf",
                   headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ── Camera Health PDF Export ───────────────────────────────────────────────────
class CameraHealthExportPdfBody(BaseModel):
    filter: str = "all"
    generated_by_name: str = "Administrator"


@router.post("/health/export/pdf")
def export_cameras_health_pdf(
    body: CameraHealthExportPdfBody,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    from ...services.pdf_report_service import generate_generic_table_pdf, ReportGenerationError
    from reportlab.lib.colors import HexColor
    import io as _io
    from datetime import date
    from fastapi.responses import StreamingResponse as _SR

    filter_val = str(body.filter or "all").lower()
    filter_map = {
        "all": "All Cameras",
        "healthy": "Healthy",
        "degraded": "Degraded",
        "offline": "Offline",
        "maintenance": "Maintenance",
    }
    filter_label = filter_map.get(filter_val, "All Cameras")

    # Mirror the health GET endpoint: iterate cameras, grab latest health log +
    # latest successful verification (fps/resolution live on CameraVerification,
    # not on CameraHealthLog).
    cameras_with_health = db.query(Camera).filter(Camera.archived_at.is_(None)).all()

    class _HealthRow:
        __slots__ = ("camera_name", "site_name", "health_status", "latency_ms",
                     "fps_detected", "resolution_detected", "checked_at")
        def __init__(self, camera_name, site_name, health_status, latency_ms,
                     fps_detected, resolution_detected, checked_at):
            self.camera_name = camera_name
            self.site_name = site_name
            self.health_status = health_status
            self.latency_ms = latency_ms
            self.fps_detected = fps_detected
            self.resolution_detected = resolution_detected
            self.checked_at = checked_at

    latest: list = []
    for cam in cameras_with_health:
        log = (
            db.query(CameraHealthLog)
            .filter(CameraHealthLog.camera_id == cam.id)
            .order_by(CameraHealthLog.checked_at.desc())
            .first()
        )
        if not log:
            continue
        site = db.get(Site, cam.site_id) if cam.site_id else None
        verify = (
            db.query(CameraVerification)
            .filter(
                CameraVerification.camera_id == cam.id,
                CameraVerification.result_status == "verified",
            )
            .order_by(CameraVerification.completed_at.desc())
            .first()
        )
        latest.append(_HealthRow(
            camera_name=cam.name or f"Camera {cam.id}",
            site_name=site.name if site else "—",
            health_status=log.health_status,
            latency_ms=log.latency_ms,
            fps_detected=verify.fps_detected if verify else None,
            resolution_detected=verify.resolution_detected if verify else None,
            checked_at=log.checked_at,
        ))

    def _fmt_dt(v):
        if not v:
            return "—"
        try:
            if hasattr(v, "strftime"):
                from datetime import timedelta as _td
                pk = timezone(_td(hours=5))
                if getattr(v, "tzinfo", None) is None:
                    v = v.replace(tzinfo=timezone.utc)
                return v.astimezone(pk).strftime("%b %d, %Y %H:%M")
            from datetime import datetime as _dt
            vv = _dt.fromisoformat(str(v).replace("Z", "+00:00"))
            from datetime import timedelta as _td
            pk = timezone(_td(hours=5))
            if getattr(vv, "tzinfo", None) is None:
                vv = vv.replace(tzinfo=timezone.utc)
            return vv.astimezone(pk).strftime("%b %d, %Y %H:%M")
        except Exception:
            return str(v)

    def _status_val(s):
        """Extract plain string value from a CameraHealthStatus enum (or raw string)."""
        return str(getattr(s, "value", s) or "").lower()

    if filter_val != "all":
        latest = [r for r in latest if _status_val(r.health_status) == filter_val]

    headers = ["Camera", "Site", "Health Status", "Latency (ms)", "FPS", "Resolution", "Last Checked"]
    rows_data = [
        [
            r.camera_name,
            r.site_name,
            _status_val(r.health_status).capitalize() if r.health_status else "—",
            str(int(r.latency_ms)) if r.latency_ms is not None else "—",
            str(round(r.fps_detected, 1)) if r.fps_detected is not None else "—",
            str(r.resolution_detected or "—"),
            _fmt_dt(r.checked_at),
        ]
        for r in latest
    ]

    total        = len(latest)
    healthy_n    = sum(1 for r in latest if _status_val(r.health_status) == "healthy")
    degraded_n   = sum(1 for r in latest if _status_val(r.health_status) == "degraded")
    offline_n    = sum(1 for r in latest if _status_val(r.health_status) == "offline")
    maintenance_n = sum(1 for r in latest if _status_val(r.health_status) == "maintenance")

    kpi_items = [
        (total,     "Total",   HexColor("#ffffff"), HexColor("#1e3a5f")),
        (healthy_n, "Healthy", HexColor("#15803d"), HexColor("#dcfce7")),
        (degraded_n, "Degraded", HexColor("#b45309"), HexColor("#fef3c7")),
        (offline_n, "Offline", HexColor("#b91c1c"), HexColor("#fee2e2")),
    ]
    status_fg = {"healthy": HexColor("#15803d"), "degraded": HexColor("#b45309"), "offline": HexColor("#b91c1c"), "maintenance": HexColor("#0ea5e9")}
    status_bg = {"healthy": HexColor("#dcfce7"), "degraded": HexColor("#fef3c7"), "offline": HexColor("#fee2e2"), "maintenance": HexColor("#e0f2fe")}

    try:
        pdf_bytes = generate_generic_table_pdf(
            title="Camera Health Report",
            headers=headers, rows=rows_data,
            col_widths=[100, 90, 72, 60, 45, 80, 112],
            meta_pairs=[("Report", "Camera Health Monitoring")],
            filter_label=filter_label,
            generated_by=str(body.generated_by_name or admin.full_name or "Administrator"),
            kpi_items=kpi_items,
            status_col_index=2,
            status_fg=status_fg,
            status_bg=status_bg,
        )
        fname = f"Camera_Health_Export_{date.today().isoformat()}.pdf"
        return _SR(_io.BytesIO(pdf_bytes), media_type="application/pdf",
                   headers={"Content-Disposition": f'attachment; filename="{fname}"'})
    except ReportGenerationError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
