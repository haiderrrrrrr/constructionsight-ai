import enum
from sqlalchemy import (
    Column, Integer, String, Boolean, Float, Text, DateTime,
    ForeignKey, UniqueConstraint, func, JSON
)
from sqlalchemy import Enum as PgEnum
from ..core.db import Base


class RegistryStatus(str, enum.Enum):
    draft = "draft"
    verifying = "verifying"
    verified = "verified"
    verify_failed = "verify_failed"
    archived = "archived"


class CameraHealthStatus(str, enum.Enum):
    healthy = "healthy"
    degraded = "degraded"
    offline = "offline"
    maintenance = "maintenance"


class Camera(Base):
    __tablename__ = "cameras"
    __table_args__ = (
        UniqueConstraint("serial_number", "site_id", name="uq_camera_serial_site"),
    )

    id = Column(Integer, primary_key=True, index=True)
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    vendor = Column(String(100), nullable=True)
    model = Column(String(100), nullable=True)
    serial_number = Column(String(200), nullable=True)
    onvif_supported = Column(Boolean, default=False)
    ptz_supported = Column(Boolean, default=False)
    connection_type = Column(String(50), default="rtsp")
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    logo_url = Column(String(500), nullable=True)
    logo_public_id = Column(String(300), nullable=True)
    registry_status = Column(
        PgEnum(RegistryStatus, name="registrystatus", create_type=False),
        default=RegistryStatus.draft,
        nullable=False,
    )
    verified_at = Column(DateTime(timezone=True), nullable=True)
    last_health_check_at = Column(DateTime(timezone=True), nullable=True)
    archived_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    worker_status = Column(String(20), default="idle", nullable=False)
    last_inference_at = Column(DateTime(timezone=True), nullable=True)
    worker_error = Column(Text, nullable=True)
    # New structured runtime status (Fix 3: separate status layers)
    runtime_status = Column(JSON, nullable=True, default=dict)


class CameraCredential(Base):
    __tablename__ = "camera_credentials"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False, unique=True, index=True)
    rtsp_url_enc = Column(Text, nullable=True)       # Main stream (high-res / Record URL)
    rtsp_url_sub_enc = Column(Text, nullable=True)   # Sub-stream  (low-res  / Live URL)
    username_enc = Column(Text, nullable=True)
    password_enc = Column(Text, nullable=True)
    onvif_host_enc = Column(Text, nullable=True)
    onvif_port = Column(Integer, nullable=True)
    selected_stream_profile = Column(String(100), nullable=True)
    transport_preference = Column(String(10), default="tcp")
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class CameraVerification(Base):
    __tablename__ = "camera_verifications"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False, index=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    completed_at = Column(DateTime(timezone=True), nullable=True)
    result_status = Column(String(50), nullable=True)
    failure_reason = Column(Text, nullable=True)
    preview_image_url = Column(String(500), nullable=True)
    fps_detected = Column(Float, nullable=True)
    resolution_detected = Column(String(50), nullable=True)
    latency_ms = Column(Float, nullable=True)


class CameraHealthLog(Base):
    __tablename__ = "camera_health_logs"

    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, ForeignKey("cameras.id"), nullable=False, index=True)
    health_status = Column(
        PgEnum(CameraHealthStatus, name="camerahealthstatus", create_type=False),
        nullable=False,
    )
    checked_at = Column(DateTime(timezone=True), server_default=func.now())
    latency_ms = Column(Float, nullable=True)
    message = Column(Text, nullable=True)
