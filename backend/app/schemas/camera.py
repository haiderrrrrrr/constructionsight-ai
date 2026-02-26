import re
from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from datetime import datetime
from ..models.camera import RegistryStatus, CameraHealthStatus

_CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_LETTER_RE = re.compile(r"[A-Za-z]")


def _validate_camera_text(
    value: str,
    field_name: str,
    *,
    min_length: int = 2,
    max_length: int = 200,
    require_letter: bool = True,
) -> str:
    value = value.strip()
    if _CONTROL_CHARS_RE.search(value):
        raise ValueError(f"{field_name} contains invalid characters")
    if "<" in value or ">" in value:
        raise ValueError(f"{field_name} cannot contain HTML")
    if len(value) < min_length:
        raise ValueError(f"{field_name} is too short")
    if len(value) > max_length:
        raise ValueError(f"{field_name} is too long")
    if require_letter and not _LETTER_RE.search(value):
        raise ValueError(f"{field_name} must include letters")
    return value


def _validate_optional_camera_text(
    value: Optional[str],
    field_name: str,
    *,
    min_length: int = 2,
    max_length: int = 200,
    require_letter: bool = True,
) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    return _validate_camera_text(
        value,
        field_name,
        min_length=min_length,
        max_length=max_length,
        require_letter=require_letter,
    )


class CameraCreate(BaseModel):
    site_id: int
    name: str
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    onvif_supported: bool = False
    ptz_supported: bool = False
    connection_type: str = "rtsp"
    logo_url: Optional[str] = None
    logo_public_id: Optional[str] = None
    # Credentials
    rtsp_url: Optional[str] = None       # Main stream (high-res / Record URL)
    rtsp_url_sub: Optional[str] = None   # Sub-stream  (low-res  / Live URL)
    username: Optional[str] = None
    password: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: Optional[int] = None
    transport_preference: Optional[str] = "tcp"

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        return _validate_camera_text(v, "Camera name", min_length=3)

    @field_validator('vendor')
    @classmethod
    def vendor_valid(cls, v):
        return _validate_optional_camera_text(v, "Vendor")

    @field_validator('model')
    @classmethod
    def model_valid(cls, v):
        return _validate_optional_camera_text(v, "Model")

    @field_validator('serial_number')
    @classmethod
    def serial_number_valid(cls, v):
        return _validate_optional_camera_text(v, "Serial number", min_length=1, require_letter=False)

    @field_validator('onvif_port')
    @classmethod
    def onvif_port_valid_range(cls, v):
        if v is not None and (v < 1 or v > 65535):
            raise ValueError('ONVIF port must be between 1 and 65535')
        return v

    @field_validator('rtsp_url')
    @classmethod
    def rtsp_url_format_valid(cls, v):
        if v:
            v_lower = v.lower()
            if not (v_lower.startswith('rtsp://') or v_lower.startswith('rtsps://')):
                raise ValueError('RTSP URL must start with rtsp:// or rtsps://')
        return v

    @field_validator('transport_preference')
    @classmethod
    def transport_preference_valid(cls, v):
        if v and v.lower() not in ('tcp', 'udp'):
            raise ValueError('Transport preference must be "tcp" or "udp"')
        return v.lower() if v else 'tcp'

    @model_validator(mode='after')
    def at_least_one_credential(self):
        has_rtsp = bool(self.rtsp_url or self.rtsp_url_sub)
        has_onvif = bool(self.onvif_host)
        if not has_rtsp and not has_onvif:
            raise ValueError('At least one credential (RTSP URL or ONVIF host) must be provided')
        return self


class CameraUpdate(BaseModel):
    site_id: Optional[int] = None
    name: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    onvif_supported: Optional[bool] = None
    ptz_supported: Optional[bool] = None
    connection_type: Optional[str] = None
    logo_url: Optional[str] = None
    logo_public_id: Optional[str] = None

    @field_validator('name')
    @classmethod
    def name_not_empty(cls, v):
        return _validate_optional_camera_text(v, "Camera name", min_length=3)

    @field_validator('vendor')
    @classmethod
    def vendor_valid(cls, v):
        return _validate_optional_camera_text(v, "Vendor")

    @field_validator('model')
    @classmethod
    def model_valid(cls, v):
        return _validate_optional_camera_text(v, "Model")

    @field_validator('serial_number')
    @classmethod
    def serial_number_valid(cls, v):
        return _validate_optional_camera_text(v, "Serial number", min_length=1, require_letter=False)


class CameraCredentialsUpdate(BaseModel):
    rtsp_url: Optional[str] = None       # Main stream
    rtsp_url_sub: Optional[str] = None   # Sub-stream
    username: Optional[str] = None
    password: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: Optional[int] = None
    selected_stream_profile: Optional[str] = None
    transport_preference: Optional[str] = None

    @field_validator('onvif_port')
    @classmethod
    def onvif_port_valid_range(cls, v):
        if v is not None and (v < 1 or v > 65535):
            raise ValueError('ONVIF port must be between 1 and 65535')
        return v

    @field_validator('rtsp_url')
    @classmethod
    def rtsp_url_format_valid(cls, v):
        if v:
            v_lower = v.lower()
            if not (v_lower.startswith('rtsp://') or v_lower.startswith('rtsps://')):
                raise ValueError('RTSP URL must start with rtsp:// or rtsps://')
        return v

    @field_validator('transport_preference')
    @classmethod
    def transport_preference_valid(cls, v):
        if v and v.lower() not in ('tcp', 'udp'):
            raise ValueError('Transport preference must be "tcp" or "udp"')
        return v.lower() if v else None

    @model_validator(mode='after')
    def at_least_one_credential_if_updating(self):
        # Only check if we're explicitly clearing all credentials (all set to None/empty)
        # If user is updating only some fields, allow partial updates
        has_rtsp = bool(self.rtsp_url or self.rtsp_url_sub)
        has_onvif = bool(self.onvif_host)
        # Only error if ALL fields are provided AND all are empty/null
        has_any_field = (
            self.rtsp_url is not None or
            self.rtsp_url_sub is not None or
            self.onvif_host is not None
        )
        if has_any_field and not has_rtsp and not has_onvif:
            raise ValueError('At least one credential (RTSP URL or ONVIF host) must be provided')
        return self


class CameraCredentialsOut(BaseModel):
    rtsp_url: Optional[str] = None
    rtsp_url_sub: Optional[str] = None
    username: Optional[str] = None
    onvif_host: Optional[str] = None
    onvif_port: Optional[int] = None
    transport_preference: Optional[str] = None
    has_password: bool = False


class CameraVerificationOut(BaseModel):
    id: int
    camera_id: int
    started_at: datetime
    completed_at: Optional[datetime] = None
    result_status: Optional[str] = None
    failure_reason: Optional[str] = None
    preview_image_url: Optional[str] = None
    fps_detected: Optional[float] = None
    resolution_detected: Optional[str] = None
    latency_ms: Optional[float] = None

    class Config:
        from_attributes = True


class CameraOut(BaseModel):
    id: int
    site_id: int
    site_name: Optional[str] = None
    project_id: Optional[int] = None
    project_name: Optional[str] = None
    name: str
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    onvif_supported: bool
    ptz_supported: bool = False
    connection_type: str
    logo_url: Optional[str] = None
    created_by: int
    registry_status: RegistryStatus
    verified_at: Optional[datetime] = None
    last_health_check_at: Optional[datetime] = None
    archived_at: Optional[datetime] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    latest_health_status: Optional[CameraHealthStatus] = None

    class Config:
        from_attributes = True


class CameraDetailOut(CameraOut):
    verifications: List[CameraVerificationOut] = []
    onvif_port: Optional[int] = None


class CameraHealthRowOut(BaseModel):
    id: int
    camera_id: int
    camera_name: Optional[str] = None
    site_name: Optional[str] = None
    health_status: CameraHealthStatus
    checked_at: datetime
    latency_ms: Optional[float] = None
    message: Optional[str] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    registry_status: Optional[str] = None
    logo_url: Optional[str] = None
    onvif_supported: Optional[bool] = None
    fps_detected: Optional[float] = None
    resolution_detected: Optional[str] = None

    class Config:
        from_attributes = True


class CameraHealthSummaryOut(BaseModel):
    total: int
    healthy: int
    degraded: int
    offline: int
    maintenance: int
    rows: List[CameraHealthRowOut]


class PTZMoveRequest(BaseModel):
    pan: float = 0.0    # -1.0 to 1.0
    tilt: float = 0.0   # -1.0 to 1.0
    zoom: float = 0.0   # -1.0 to 1.0
    speed: float = 0.5  # 0.1 to 1.0


class PTZGotoPresetRequest(BaseModel):
    preset_token: str


class PTZPreset(BaseModel):
    token: Optional[str] = None
    name: Optional[str] = None
