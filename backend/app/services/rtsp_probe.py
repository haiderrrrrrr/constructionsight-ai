"""
Real RTSP and ONVIF stream probing utilities.

Verify endpoint uses ffprobe (subprocess) to validate the RTSP stream and
extract codec / FPS / resolution details.  If ffprobe is not on PATH the
function falls back to a plain TCP socket reachability test so at least the
host/port connectivity is confirmed.

Health-check uses a lightweight TCP socket test (fast, 5 s timeout) so the
synchronous endpoint does not block the API thread for long.

discover_onvif_cameras() implements raw WS-Discovery (RFC 5357 / DPWS) via
UDP multicast — no extra dependencies beyond stdlib.  Works with any ONVIF
device including Dahua, Hikvision, Axis, Hanwha, etc.

Phase 2: replace probe_onvif with full python-onvif-zeep WS-Discovery.
"""

import json
import os
import shutil
import socket
import subprocess
from typing import Optional, Tuple


def _find_ffprobe() -> Optional[str]:
    """
    Locate the ffprobe executable.
    Checks PATH first, then common Windows install locations including Agent DVR.
    Returns None if not found anywhere (Agent DVR does not ship ffprobe).
    """
    found = shutil.which("ffprobe")
    if found:
        return found
    candidates = [
        r"C:\Program Files\Agent\dlls\x64\ffprobe.exe",
        r"C:\Program Files\Agent DVR\ffprobe.exe",
        r"C:\Program Files (x86)\Agent DVR\ffprobe.exe",
        r"C:\Agent DVR\ffprobe.exe",
        r"C:\ffmpeg\bin\ffprobe.exe",
        r"C:\Program Files\ffmpeg\bin\ffprobe.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffprobe.exe",
        r"C:\tools\ffmpeg\bin\ffprobe.exe",
        r"C:\ProgramData\chocolatey\bin\ffprobe.exe",
        r"C:\ProgramData\scoop\apps\ffmpeg\current\bin\ffprobe.exe",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def _find_ffmpeg() -> Optional[str]:
    """Locate ffmpeg — same search order as in admin_cameras.py."""
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
    for path in candidates:
        if os.path.isfile(path):
            return path
    return None


def _probe_with_ffmpeg(
    ffmpeg: str,
    rtsp_url: str,
    transport: str,
    timeout: int,
) -> Tuple[bool, Optional[float], Optional[str], Optional[str]]:
    """
    Use ffmpeg to extract stream info when ffprobe is unavailable.
    Reads exactly 1 frame then exits — ffmpeg prints stream info to stderr.
    e.g. "Stream #0:0: Video: h264, yuv420p, 1920x1080, 15 fps, 15 tbr"
    """
    import re
    # NUL on Windows, /dev/null on Linux/Mac
    null_out = "NUL" if os.name == "nt" else "/dev/null"
    cmd = [
        ffmpeg, "-y",
        "-rtsp_transport", transport,
        "-i", rtsp_url,
        "-frames:v", "1",   # read exactly 1 frame — forces full stream init
        "-f", "null",
        null_out,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout + 5,
            errors="replace",
        )
        # ffmpeg writes stream info to stderr regardless of exit code
        stderr = result.stderr or ""

        # Look for a Video stream line anywhere in stderr
        # e.g. "    Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 15 fps, 15 tbr"
        video_match = re.search(r"Stream #\S+.*?Video:.*", stderr)
        if not video_match:
            # No stream info — likely auth failure or unreachable
            if result.returncode != 0:
                # Extract meaningful error: last non-empty line from stderr
                lines = [l.strip() for l in stderr.splitlines() if l.strip()]
                err_line = lines[-1] if lines else "RTSP stream unreachable"
                return False, None, None, err_line[:300]
            return True, None, None, None

        line = video_match.group(0)

        # Resolution: "1920x1080"
        res_match = re.search(r"(\d{2,5})x(\d{2,5})", line)
        resolution = f"{res_match.group(1)}x{res_match.group(2)}" if res_match else None

        # FPS: prefer tbr (true frame rate), fall back to fps display value
        fps: Optional[float] = None
        for pattern in (r"([\d.]+)\s+tbr", r"([\d.]+)\s+fps"):
            m = re.search(pattern, line)
            if m:
                try:
                    fps = round(float(m.group(1)), 1)
                    break
                except ValueError:
                    pass

        return True, fps, resolution, None

    except subprocess.TimeoutExpired:
        return False, None, None, f"ffmpeg timed out after {timeout}s"
    except Exception as exc:
        return False, None, None, str(exc)


def _tcp_reachable(host: str, port: int, timeout: float = 5.0) -> Tuple[bool, Optional[str]]:
    """Attempt a TCP connection; return (success, error_message)."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, None
    except socket.timeout:
        return False, f"TCP connection to {host}:{port} timed out after {int(timeout)}s"
    except OSError as exc:
        return False, f"TCP connection to {host}:{port} failed: {exc}"


def probe_rtsp(
    rtsp_url: str,
    transport: str = "tcp",
    timeout: int = 10,
) -> Tuple[bool, Optional[float], Optional[str], Optional[str]]:
    """
    Probe an RTSP stream with ffprobe.

    Returns:
        (success, fps, resolution, error_message)

    Falls back to a TCP socket test when ffprobe is not installed.
    The fallback confirms port reachability but cannot extract stream details.
    """
    ffprobe = _find_ffprobe()
    if not ffprobe:
        # ── ffmpeg fallback (Agent DVR ships ffmpeg but not ffprobe) ──────────
        ffmpeg = _find_ffmpeg()
        if ffmpeg:
            return _probe_with_ffmpeg(ffmpeg, rtsp_url, transport, timeout)
        # ── Last resort: TCP reachability only ────────────────────────────────
        try:
            from urllib.parse import urlparse
            parsed = urlparse(rtsp_url)
            host = parsed.hostname
            port = parsed.port or 554
            if not host:
                return False, None, None, "Cannot parse host from RTSP URL."
            ok, err = _tcp_reachable(host, port, timeout=float(timeout))
            if ok:
                return True, None, None, None
            return False, None, None, err or "TCP socket test failed"
        except Exception as exc:
            return False, None, None, f"Probe error: {exc}"

    # ── ffprobe path ──────────────────────────────────────────────────────────
    cmd = [
        ffprobe,
        "-v", "quiet",
        "-print_format", "json",
        "-show_streams",
        "-rtsp_transport", transport,
        "-timeout", str(timeout * 1_000_000),   # microseconds
        rtsp_url,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout + 5,
        )
        if result.returncode != 0:
            err_text = (result.stderr or "").strip()[:500]
            return False, None, None, err_text or "RTSP stream unreachable"

        data = json.loads(result.stdout or "{}")
        streams = data.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"), None)
        if not video:
            return False, None, None, "No video stream found at RTSP URL"

        # Parse FPS from rational string e.g. "30000/1001"
        fps: Optional[float] = None
        fps_str = video.get("r_frame_rate", "")
        if fps_str and "/" in fps_str:
            a, b = fps_str.split("/", 1)
            try:
                fps = round(int(a) / int(b), 1) if int(b) else None
            except ValueError:
                pass

        w, h = video.get("width"), video.get("height")
        resolution = f"{w}x{h}" if w and h else None

        return True, fps, resolution, None

    except subprocess.TimeoutExpired:
        return False, None, None, f"ffprobe timed out after {timeout}s"
    except json.JSONDecodeError:
        return False, None, None, "ffprobe returned invalid JSON"
    except Exception as exc:
        return False, None, None, str(exc)


def probe_rtsp_health(rtsp_url: str, timeout: float = 5.0) -> Tuple[bool, Optional[float], Optional[str]]:
    """
    Lightweight health-check probe — TCP socket only.
    Returns (reachable, latency_ms, error_message).

    Fast path (< 5 s) so the synchronous health-check endpoint does not stall.
    """
    import time
    try:
        from urllib.parse import urlparse
        parsed = urlparse(rtsp_url)
        host = parsed.hostname
        port = parsed.port or 554
        if not host:
            return False, None, "Cannot parse host from RTSP URL"

        start = time.monotonic()
        ok, err = _tcp_reachable(host, port, timeout=timeout)
        latency = round((time.monotonic() - start) * 1000, 1)  # ms

        if ok:
            return True, latency, None
        return False, None, err
    except Exception as exc:
        return False, None, str(exc)


def probe_onvif(host: str, port: int = 80, timeout: float = 5.0) -> Tuple[bool, Optional[str]]:
    """
    Basic ONVIF reachability: TCP connection to the ONVIF service port.
    """
    return _tcp_reachable(host, port, timeout=timeout)


# ── WS-Discovery ──────────────────────────────────────────────────────────────

def discover_onvif_cameras(timeout: float = 5.0) -> list:
    """
    Discover ONVIF cameras on the local network using WS-Discovery (RFC 5357).

    Sends a UDP multicast Probe to 239.255.255.250:3702 and collects ProbeMatch
    responses from all reachable ONVIF devices.  Parses scopes to extract
    hardware model and friendly name without requiring any credentials.

    Returns a list of dicts:
        {
            "ip":          "192.168.0.49",
            "service_url": "http://192.168.0.49/onvif/device_service",
            "name":        "IPC-K2E-5H3W",   # from ONVIF scope or IP fallback
            "hardware":    "IPC-K2E-5H3W",   # from hardware scope
            "onvif":       True,
        }
    """
    import socket
    import time
    import uuid
    import xml.etree.ElementTree as ET
    from urllib.parse import unquote

    MCAST_ADDR = "239.255.255.250"
    MCAST_PORT = 3702

    # WS-Discovery Probe — NetworkVideoTransmitter covers all ONVIF cameras
    msg_id = str(uuid.uuid4())
    probe = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"'
        ' xmlns:wsa="http://schemas.xmlsoap.org/ws/2004/08/addressing"'
        ' xmlns:wsd="http://schemas.xmlsoap.org/ws/2005/04/discovery"'
        ' xmlns:dn="http://www.onvif.org/ver10/network/wsdl">'
        "<env:Header>"
        "<wsa:Action>http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</wsa:Action>"
        f"<wsa:MessageID>uuid:{msg_id}</wsa:MessageID>"
        "<wsa:To>urn:schemas-xmlsoap-org:ws:2005:04:discovery</wsa:To>"
        "</env:Header>"
        "<env:Body>"
        "<wsd:Probe>"
        "<wsd:Types>dn:NetworkVideoTransmitter</wsd:Types>"
        "</wsd:Probe>"
        "</env:Body>"
        "</env:Envelope>"
    ).encode()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 4)
        sock.settimeout(0.5)   # short recv timeout — loop until wall-clock expires
        sock.sendto(probe, (MCAST_ADDR, MCAST_PORT))
    except OSError:
        sock.close()
        return []

    devices: list = []
    seen_ips: set = set()
    deadline = time.monotonic() + timeout

    ns = {
        "env": "http://www.w3.org/2003/05/soap-envelope",
        "wsd": "http://schemas.xmlsoap.org/ws/2005/04/discovery",
        "wsa": "http://schemas.xmlsoap.org/ws/2004/08/addressing",
    }

    while time.monotonic() < deadline:
        try:
            data, addr = sock.recvfrom(65535)
        except socket.timeout:
            continue
        except OSError:
            break

        ip = addr[0]
        if ip in seen_ips:
            continue
        seen_ips.add(ip)

        service_url: Optional[str] = None
        hardware: Optional[str] = None
        name: Optional[str] = None

        try:
            root = ET.fromstring(data.decode(errors="replace"))

            # XAddrs — one or more space-separated ONVIF service URLs
            xaddrs_el = root.find(".//wsd:XAddrs", ns)
            if xaddrs_el is not None and xaddrs_el.text:
                # Prefer the URL that matches the responding IP
                for addr_str in xaddrs_el.text.split():
                    service_url = addr_str
                    if ip in addr_str:
                        break

            # Scopes — parse hardware and name
            scopes_el = root.find(".//wsd:Scopes", ns)
            if scopes_el is not None and scopes_el.text:
                for scope in scopes_el.text.split():
                    scope_dec = unquote(scope)
                    if "/hardware/" in scope_dec:
                        hardware = scope_dec.split("/hardware/", 1)[-1].strip("/")
                    elif "/name/" in scope_dec:
                        name = scope_dec.split("/name/", 1)[-1].strip("/")
        except Exception:
            pass  # still add the device with minimal info

        devices.append({
            "ip": ip,
            "service_url": service_url,
            "name": name or hardware or ip,
            "hardware": hardware,
            "onvif": True,
        })

    sock.close()
    return devices
