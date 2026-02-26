from datetime import datetime
from typing import Optional
import re
from pydantic import BaseModel, field_validator

_MAX_DESCRIPTION_LEN = 1500
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
    value: str,
    label: str,
    *,
    min_len: int,
    max_len: int,
    multiline: bool = False,
) -> str:
    cleaned = _clean_text(value, multiline=multiline)
    if not cleaned:
        raise ValueError(f"{label} is required")
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


class TaskCreate(BaseModel):
    title: str
    description: str

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        return _validate_human_text(v, "Task title", min_len=2, max_len=500)

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: str) -> str:
        return _validate_human_text(
            v,
            "Description",
            min_len=5,
            max_len=_MAX_DESCRIPTION_LEN,
            multiline=True,
        )


class TaskToggle(BaseModel):
    is_done: bool


class TaskOut(BaseModel):
    id: int
    project_id: int
    title: str
    description: str
    is_done: bool
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    created_at: datetime
    done_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
