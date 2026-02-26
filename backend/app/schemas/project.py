import re
from pydantic import BaseModel, field_validator, model_validator
from typing import Literal, Optional, List
from datetime import date, datetime

_EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LETTER_RE = re.compile(r"[A-Za-z]")


def _validate_human_text(
    value: str,
    field_name: str,
    *,
    min_length: int = 2,
    max_length: int = 200,
) -> str:
    value = value.strip()
    if _CONTROL_CHARS_RE.search(value):
        raise ValueError(f"{field_name} contains invalid hidden characters")
    if "<" in value or ">" in value:
        raise ValueError(f"{field_name} cannot contain HTML tags")
    if len(value) < min_length or len(value) > max_length:
        raise ValueError(f"{field_name} must be {min_length}-{max_length} characters")
    if not _LETTER_RE.search(value):
        raise ValueError(f"{field_name} must include letters, not only numbers or symbols")
    return value


def _validate_optional_human_text(
    value: Optional[str],
    field_name: str,
    *,
    min_length: int = 2,
    max_length: int = 200,
) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    return _validate_human_text(
        value,
        field_name,
        min_length=min_length,
        max_length=max_length,
    )


class ProjectCreate(BaseModel):
    name: str
    location: str
    description: Optional[str] = None
    client_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: date
    # PM assignment — exactly one pair must be provided
    pm_user_id: Optional[int] = None       # existing registered user
    pm_email: Optional[str] = None         # invite by email (non-registered OK)
    pm_full_name: Optional[str] = None     # required when pm_email is used

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _validate_human_text(v, "Project name", min_length=2, max_length=200)

    @field_validator("location")
    @classmethod
    def validate_location(cls, v: str) -> str:
        return _validate_human_text(v, "Location", min_length=2, max_length=300)

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(
            v,
            "Description",
            min_length=2,
            max_length=2000,
        )

    @field_validator("client_name")
    @classmethod
    def validate_client_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Client name", min_length=2, max_length=200)

    @field_validator("pm_full_name")
    @classmethod
    def validate_pm_full_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "PM full name", min_length=2, max_length=100)

    @field_validator("pm_email")
    @classmethod
    def validate_pm_email(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip().lower()
            if not _EMAIL_RE.match(v):
                raise ValueError("Invalid PM email address")
        return v

    @model_validator(mode="after")
    def validate_pm_assignment(self) -> "ProjectCreate":
        has_user = self.pm_user_id is not None
        has_email = self.pm_email is not None
        if not has_user and not has_email:
            raise ValueError("Either pm_user_id or pm_email must be provided")
        if has_user and has_email:
            raise ValueError("Provide either pm_user_id or pm_email, not both")
        if has_email and not (self.pm_full_name or "").strip():
            raise ValueError("pm_full_name is required when inviting by email")
        return self

    @model_validator(mode="after")
    def validate_dates(self) -> "ProjectCreate":
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("End date must be on or after start date")
        return self


class ProjectSetup(BaseModel):
    """All fields optional — partial PATCH is always safe."""
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    client_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: date

    @model_validator(mode="after")
    def validate_dates(self) -> "ProjectSetup":
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("End date must be on or after start date")
        return self

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Project name", min_length=2, max_length=200)

    @field_validator("location")
    @classmethod
    def validate_location(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Location", min_length=2, max_length=300)

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(
            v,
            "Description",
            min_length=2,
            max_length=2000,
        )

    @field_validator("client_name")
    @classmethod
    def validate_client_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Client name", min_length=2, max_length=200)


class ProjectStatusUpdate(BaseModel):
    status: Literal["archived"]


class ProjectEdit(BaseModel):
    """Edit project details (admin-only, DRAFT status only)."""
    name: Optional[str] = None
    location: Optional[str] = None
    description: Optional[str] = None
    client_name: Optional[str] = None
    start_date: Optional[date] = None
    end_date: date

    @model_validator(mode="after")
    def validate_dates(self) -> "ProjectEdit":
        if self.start_date and self.end_date:
            if self.end_date < self.start_date:
                raise ValueError("End date must be on or after start date")
        return self

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Project name", min_length=2, max_length=200)

    @field_validator("location")
    @classmethod
    def validate_location(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Location", min_length=2, max_length=300)

    @field_validator("description")
    @classmethod
    def validate_description(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(
            v,
            "Description",
            min_length=2,
            max_length=2000,
        )

    @field_validator("client_name")
    @classmethod
    def validate_client_name(cls, v: Optional[str]) -> Optional[str]:
        return _validate_optional_human_text(v, "Client name", min_length=2, max_length=200)


class ProjectOut(BaseModel):
    id: int
    name: str
    description: Optional[str]
    location: str
    client_name: Optional[str]
    start_date: Optional[date]
    end_date: Optional[date]
    status: str
    logo_url: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None        # resolved from site relationship
    created_by: int
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class ProjectCreateResponse(ProjectOut):
    """Extended response after admin creates a project — includes invitation data."""
    invitation_token: str
    invitation_id: int
    invitation_email: str


class ProjectWithRoleOut(ProjectOut):
    my_role: Optional[str] = None
    my_email: Optional[str] = None
    is_pinned: bool = False


class MemberOut(BaseModel):
    id: int
    user_id: int
    project_id: int
    project_role: str
    status: str
    full_name: str
    email: str
    username: str
    avatar_url: Optional[str] = None
    joined_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserListOut(BaseModel):
    id: int
    full_name: str
    email: str
    username: str
    platform_role: str

    class Config:
        from_attributes = True


class InviteRequest(BaseModel):
    email: str
    role: str
    full_name: Optional[str] = None
    send_email: bool = True

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL_RE.match(v):
            raise ValueError("Invalid email address")
        return v

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        valid_roles = {"project_manager", "site_supervisor", "safety_officer", "data_analyst", "stakeholder"}
        if v not in valid_roles:
            raise ValueError(f"Role must be one of: {', '.join(valid_roles)}")
        return v


class ChangeMemberRole(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        valid_roles = {"project_manager", "site_supervisor", "safety_officer", "data_analyst", "stakeholder"}
        if v not in valid_roles:
            raise ValueError(f"Role must be one of: {', '.join(valid_roles)}")
        return v


class InvitationOut(BaseModel):
    id: int
    token: str
    email: str
    project_id: int
    role: str
    status: str
    expires_at: datetime
    created_at: Optional[datetime] = None
    project_name: str
    project_logo_url: Optional[str] = None
    invited_by_name: str

    class Config:
        from_attributes = True


# ─────────────────────────────────────────────────────────────────────────
# PM SETUP WIZARD SCHEMAS
# ─────────────────────────────────────────────────────────────────────────


class ProjectSettingsOut(BaseModel):
    project_id: int
    alerts_enabled: bool
    report_frequency: str

    class Config:
        from_attributes = True


class ProjectSettingsUpdate(BaseModel):
    report_frequency: Literal["daily", "weekly", "monthly"]


# Update ProjectWithRoleOut to include is_pinned
