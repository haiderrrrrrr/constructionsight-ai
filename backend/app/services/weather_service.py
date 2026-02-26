"""
WeatherService — fetches current weather from OpenWeatherMap (free tier).
Returns every field the /data/2.5/weather endpoint exposes.
10-minute in-memory cache to avoid hammering the API.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

_CACHE: dict[str, dict] = {}
_LOCK = threading.Lock()
_CACHE_TTL_SECONDS = 1800  # 30 minutes

_WIND_DIRS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
              "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _wind_dir_label(deg: float | None) -> str | None:
    if deg is None:
        return None
    return _WIND_DIRS[round(deg / 22.5) % 16]


def _resolve_city(raw: str) -> list[str]:
    """
    Return ordered list of city strings to try with OWM.
    'Blue Area, Islamabad'   → ['Islamabad', 'Blue Area, Islamabad']
    'Lahore Pakistan'        → ['Lahore Pakistan', 'Lahore']
    'Lahore, Punjab, Pakistan' → ['Lahore']
    'Islamabad'              → ['Islamabad']
    """
    raw = raw.strip()
    if "," in raw:
        parts = [p.strip() for p in raw.split(",") if p.strip()]
        # If first part is a sub-area (multi-word), prefer the second part first
        if len(parts) >= 2 and len(parts[0].split()) >= 2:
            return [parts[1], raw]
        return [parts[0]]
    # No comma — try as-is, then fall back to first word only
    first_word = raw.split()[0] if raw.split() else raw
    if first_word.lower() == raw.lower():
        return [raw]
    return [raw, first_word]


def get_weather(city: str) -> Optional[dict]:
    """Return full weather dict for city, or None if unavailable."""
    from ..core.config import settings
    api_key = settings.openweather_api_key
    if not api_key or not city:
        return None

    candidates = _resolve_city(city)
    cache_key  = candidates[0].lower()
    now        = time.monotonic()

    with _LOCK:
        cached = _CACHE.get(cache_key)
        if cached and (now - cached["cached_at"]) < _CACHE_TTL_SECONDS:
            return cached["data"]

    raw_json = None
    for candidate in candidates:
        try:
            resp = requests.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": candidate, "appid": api_key, "units": "metric"},
                timeout=5,
            )
            resp.raise_for_status()
            raw_json = resp.json()
            break
        except Exception:
            continue

    if raw_json is None:
        logger.warning(f"[weather_service] Failed to fetch weather for '{city}' (tried: {candidates})")
        return None

    w   = raw_json.get("weather", [{}])[0]
    m   = raw_json.get("main", {})
    wnd = raw_json.get("wind", {})
    sys = raw_json.get("sys", {})

    icon_code = w.get("icon", "01d")
    wind_deg  = wnd.get("deg")

    data = {
        "city":          raw_json.get("name", candidates[0]),
        "country":       sys.get("country"),
        "icon_code":     icon_code,
        "icon_url":      f"https://openweathermap.org/img/wn/{icon_code}@2x.png",
        "condition":     w.get("main", "Unknown"),
        "description":   w.get("description", "").capitalize(),
        "temp_c":        m.get("temp"),
        "feels_like_c":  m.get("feels_like"),
        "temp_min_c":    m.get("temp_min"),
        "temp_max_c":    m.get("temp_max"),
        "humidity":      m.get("humidity"),
        "pressure_hpa":  m.get("pressure"),
        "wind_mps":      wnd.get("speed"),
        "wind_gust_mps": wnd.get("gust"),
        "wind_deg":      wind_deg,
        "wind_dir":      _wind_dir_label(wind_deg),
        "clouds_pct":    raw_json.get("clouds", {}).get("all"),
        "visibility_m":  raw_json.get("visibility"),
        "rain_1h":       raw_json.get("rain", {}).get("1h", 0.0),
        "snow_1h":       raw_json.get("snow", {}).get("1h"),
        "sunrise_unix":  sys.get("sunrise"),
        "sunset_unix":   sys.get("sunset"),
        "fetched_at":    time.time(),
    }

    with _LOCK:
        _CACHE[cache_key] = {"data": data, "cached_at": time.monotonic()}

    return data


def invalidate(city: str) -> None:
    with _LOCK:
        _CACHE.pop(city.strip().lower(), None)
