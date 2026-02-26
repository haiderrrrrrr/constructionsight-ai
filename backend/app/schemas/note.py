from datetime import datetime
from typing import Optional
import re
from pydantic import BaseModel, field_validator

VALID_CATEGORIES = {"tasks", "work", "team", "archive", "urgent", "personal", "client", "important"}
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


class NoteCreate(BaseModel):
    title: str
    content: Optional[str] = None
    category: str = "tasks"

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        return _validate_human_text(v, "Note title", min_len=2, max_len=500)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: Optional[str]) -> Optional[str]:
        return _validate_human_text(
            v,
            "Description",
            required=False,
            min_len=5,
            max_len=2000,
            multiline=True,
        )

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    is_favourite: Optional[bool] = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        return _validate_human_text(v, "Note title", min_len=2, max_len=500)

    @field_validator("content")
    @classmethod
    def validate_content(cls, v: Optional[str]) -> Optional[str]:
        return _validate_human_text(
            v,
            "Description",
            required=False,
            min_len=5,
            max_len=2000,
            multiline=True,
        )

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip().lower()
        if v not in VALID_CATEGORIES:
            raise ValueError(f"Category must be one of: {', '.join(sorted(VALID_CATEGORIES))}")
        return v


class NoteOut(BaseModel):
    id: int
    project_id: int
    user_id: int
    title: str
    content: Optional[str] = None
    category: str
    is_favourite: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
