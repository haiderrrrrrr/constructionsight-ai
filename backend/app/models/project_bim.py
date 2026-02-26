from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.sql import func

from ..core.db import Base


class ProjectBimConfig(Base):
    __tablename__ = "project_bim_configs"

    id                = Column(Integer, primary_key=True, index=True)
    project_id        = Column(Integer, ForeignKey("projects.id"), nullable=False, unique=True, index=True)
    bim_enabled       = Column(Boolean, nullable=False, default=False)
    overlay_enabled   = Column(Boolean, nullable=False, default=True)
    model_url         = Column(String(1000), nullable=True)
    model_filename    = Column(String(300), nullable=True)
    model_size_bytes  = Column(BigInteger, nullable=True)
    model_uploaded_at = Column(DateTime(timezone=True), nullable=True)
    uploaded_by       = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at        = Column(DateTime(timezone=True), server_default=func.now())
    updated_at        = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class BimZoneMapping(Base):
    __tablename__ = "bim_zone_mappings"

    id            = Column(Integer, primary_key=True, index=True)
    project_id    = Column(Integer, ForeignKey("projects.id"), nullable=False, index=True)
    zone_id       = Column(Integer, ForeignKey("zones.id"), nullable=False, index=True)
    mesh_name     = Column(String(500), nullable=False)
    mesh_uuid     = Column(String(128), nullable=True)
    display_color = Column(String(20), nullable=False, default="#3b82f6")
    created_by    = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at    = Column(DateTime(timezone=True), server_default=func.now())
    updated_at    = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
