from pydantic import BaseModel, field_validator
from typing import Optional, List, Any
from datetime import datetime
import re

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LETTER_RE = re.compile(r"[A-Za-z]")


def _clean_text(value: str, *, multiline: bool = False) -> str:
    value = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    if multiline:
        value = re.sub(r"[^\S\n]+", " ", value)
        value = re.sub(r"\n{3,}", "\n\n", value)
        return value.strip()
    return re.sub(r"\s+", " ", value).strip()


def _validate_human_text(
    value: Optional[str],
    label: str,
    *,
    required: bool = True,
    min_len: int,
    max_len: int,
    multiline: bool = False,
) -> Optional[str]:
    if value is None:
        if required:
            raise ValueError(f"{label} is required")
        return None
    cleaned = _clean_text(value, multiline=multiline)
    if not cleaned:
        if required:
            raise ValueError(f"{label} is required")
        return None
    if _CONTROL_CHARS_RE.search(str(value or "")):
        raise ValueError(f"{label} contains invalid hidden characters")
    if "<" in str(value or "") or ">" in str(value or ""):
        raise ValueError(f"{label} cannot contain HTML tags")
    if not _LETTER_RE.search(cleaned):
        raise ValueError(f"{label} must include letters, not only numbers or symbols")
    if len(cleaned) < min_len:
        raise ValueError(f"{label} must be at least {min_len} characters")
    if len(cleaned) > max_len:
        raise ValueError(f"{label} must not exceed {max_len} characters")
    return cleaned


class ZoneCreate(BaseModel):
    name: str
    description: Optional[str] = None
    zone_type: Optional[str] = None

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _validate_human_text(v, "Zone name", min_len=1, max_len=200)

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        return _validate_human_text(
            v,
            "Description",
            required=False,
            min_len=5,
            max_len=500,
            multiline=True,
        )


class ZoneOut(BaseModel):
    id: int
    site_id: int
    name: str
    description: Optional[str] = None
    zone_type: Optional[str] = None
    created_by: int
    created_at: datetime

    class Config:
        from_attributes = True


# A single normalised frame coordinate {x: float, y: float}
class PolygonPoint(BaseModel):
    x: float
    y: float


class CameraZonePolygonCreate(BaseModel):
    zone_id: int
    points: Optional[List[PolygonPoint]] = None
    label: Optional[str] = None
    zone_category: Optional[str] = None


class CameraZonePolygonUpdate(BaseModel):
    points: Optional[List[PolygonPoint]] = None
    label: Optional[str] = None
    zone_category: Optional[str] = None
    is_active: Optional[int] = None


class CameraZonePolygonOut(BaseModel):
    id: int
    camera_id: int
    zone_id: int
    zone_name: Optional[str] = None
    site_name: Optional[str] = None
    points: Optional[Any] = None   # parsed JSON list returned to client
    label: Optional[str] = None
    zone_category: Optional[str] = None
    is_active: int
    version: int
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
