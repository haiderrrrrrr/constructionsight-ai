"""
ONVIF PTZ helpers — persistent connection pool + thin command wrappers.

Each camera gets one cached entry keyed by camera_id holding the live
ONVIFCamera object, PTZ service proxy, and resolved profile token.
Entries are evicted after CACHE_TTL_S seconds of no use so stale
TCP connections don't linger.  On any SOAP error the entry is dropped
and the next call reconnects from scratch.
"""
import threading
import time
from typing import List, Optional, Tuple
from fastapi import HTTPException

# ── Connection cache ──────────────────────────────────────────────────────────

CACHE_TTL_S = 300  # evict after 5 min of no use

_lock = threading.Lock()
# camera_id → { cam, ptz_svc, token, host, port, user, passwd, last_used }
_cache: dict = {}


def _evict_stale():
    now = time.monotonic()
    stale = [k for k, v in _cache.items() if now - v["last_used"] > CACHE_TTL_S]
    for k in stale:
        del _cache[k]


def _get_entry(
    camera_id: int,
    host: str,
    port: int,
    username: str,
    password: str,
    profile_hint: Optional[str],
) -> dict:
    """
    Return a live cache entry, (re)connecting only when necessary.
    Lock is held only for dict reads/writes — never during network I/O,
    so concurrent PTZ commands on different cameras don't serialize.
    """
    with _lock:
        entry = _cache.get(camera_id)
        if entry:
            if (entry["host"], entry["port"], entry["user"], entry["passwd"]) != (host, port, username, password):
                entry = None  # creds changed — fall through to reconnect
            else:
                entry["last_used"] = time.monotonic()
                return entry

    # ── Slow path: build connection outside the lock ──────────────────────────
    try:
        from onvif import ONVIFCamera  # type: ignore
    except ImportError:
        raise HTTPException(501, "onvif-zeep is not installed. Run: pip install onvif-zeep")

    try:
        cam = ONVIFCamera(host=host, port=port, user=username, passwd=password)
    except Exception as e:
        raise HTTPException(502, f"Could not connect to ONVIF device: {e}")

    token = _resolve_token(cam, profile_hint)

    try:
        ptz_svc = cam.create_ptz_service()
    except Exception as e:
        raise HTTPException(502, f"Could not create PTZ service: {e}")

    new_entry = {
        "cam": cam,
        "ptz_svc": ptz_svc,
        "token": token,
        "host": host,
        "port": port,
        "user": username,
        "passwd": password,
        "last_used": time.monotonic(),
    }
    with _lock:
        # Another thread may have connected concurrently — prefer theirs
        existing = _cache.get(camera_id)
        if existing and (existing["host"], existing["port"], existing["user"], existing["passwd"]) == (host, port, username, password):
            existing["last_used"] = time.monotonic()
            return existing
        _cache[camera_id] = new_entry
        _evict_stale()
    return new_entry


def _resolve_token(cam, hint: Optional[str]) -> str:
    if hint:
        return hint
    try:
        media = cam.create_media_service()
        profiles = media.GetProfiles()
        if not profiles:
            raise HTTPException(502, "No media profiles found on this camera")
        for p in profiles:
            if getattr(p, "PTZConfiguration", None) is not None:
                return p.token
        return profiles[0].token
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Could not fetch ONVIF profiles: {e}")


def _drop(camera_id: int):
    """Evict a broken cache entry so the next call reconnects."""
    with _lock:
        _cache.pop(camera_id, None)


# ── Public API ────────────────────────────────────────────────────────────────

def ptz_continuous_move(
    camera_id: int,
    host: str,
    port: int,
    username: str,
    password: str,
    profile_token: Optional[str],
    pan: float,
    tilt: float,
    zoom: float,
    speed: float = 0.5,
) -> None:
    entry = _get_entry(camera_id, host, port, username, password, profile_token)
    pan_val  = round(float(pan)  * float(speed), 4)
    tilt_val = round(float(tilt) * float(speed), 4)
    zoom_val = round(float(zoom) * float(speed), 4)
    try:
        ptz = entry["ptz_svc"]
        req = ptz.create_type("ContinuousMove")
        req.ProfileToken = entry["token"]

        # Only include velocity components that are actually non-zero.
        # Many cameras (Hikvision, Dahua, Axis) reject or silently ignore
        # ContinuousMove when a component is present but zero — e.g. sending
        # PanTilt {x:0, y:0} alongside Zoom {x:0.7} causes the zoom to be ignored.
        velocity = {}
        if pan_val != 0 or tilt_val != 0:
            velocity["PanTilt"] = {"x": pan_val, "y": tilt_val}
        if zoom_val != 0:
            velocity["Zoom"] = {"x": zoom_val}
        req.Velocity = velocity

        ptz.ContinuousMove(req)
    except Exception as e:
        _drop(camera_id)
        raise HTTPException(502, f"PTZ move failed: {e}")


def ptz_stop(
    camera_id: int,
    host: str,
    port: int,
    username: str,
    password: str,
    profile_token: Optional[str],
) -> None:
    entry = _get_entry(camera_id, host, port, username, password, profile_token)
    try:
        ptz = entry["ptz_svc"]
        req = ptz.create_type("Stop")
        req.ProfileToken = entry["token"]
        req.PanTilt = True
        req.Zoom    = True
        ptz.Stop(req)
    except Exception as e:
        _drop(camera_id)
        raise HTTPException(502, f"PTZ stop failed: {e}")


def ptz_get_presets(
    camera_id: int,
    host: str,
    port: int,
    username: str,
    password: str,
    profile_token: Optional[str],
) -> List[dict]:
    entry = _get_entry(camera_id, host, port, username, password, profile_token)
    try:
        ptz = entry["ptz_svc"]
        presets = ptz.GetPresets({"ProfileToken": entry["token"]})
        return [
            {
                "token": getattr(p, "token", None),
                "name":  getattr(p, "Name", None) or f"Preset {i+1}",
            }
            for i, p in enumerate(presets or [])
        ]
    except Exception as e:
        # Don't evict cache — preset failure doesn't mean the connection is broken.
        # Camera may simply not support presets; move/stop will still work.
        raise HTTPException(502, f"Failed to fetch presets: {e}")


def ptz_goto_preset(
    camera_id: int,
    host: str,
    port: int,
    username: str,
    password: str,
    profile_token: Optional[str],
    preset_token: str,
) -> None:
    entry = _get_entry(camera_id, host, port, username, password, profile_token)
    try:
        ptz = entry["ptz_svc"]
        req = ptz.create_type("GotoPreset")
        req.ProfileToken  = entry["token"]
        req.PresetToken   = preset_token
        ptz.GotoPreset(req)
    except Exception as e:
        _drop(camera_id)
        raise HTTPException(502, f"PTZ goto preset failed: {e}")
