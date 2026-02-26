from enum import Enum
from sqlalchemy import Column, Integer, String, Boolean, Enum as PgEnum, DateTime, func
from sqlalchemy.orm import relationship
from ..core.db import Base


class PlatformRole(str, Enum):
    ADMIN = "admin"
    USER = "user"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String(200), nullable=False)
    email = Column(String(255), unique=True, index=True, nullable=False)
    username = Column(String(120), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    is_active = Column(Boolean, default=True)
    platform_role = Column(
        PgEnum(PlatformRole, values_callable=lambda x: [e.value for e in x], create_type=False),
        nullable=False,
        default=PlatformRole.USER,
    )
    is_approved = Column(Boolean, default=False)
    can_create_project = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    failed_login_count = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    token_version = Column(Integer, default=1)
    auth_provider = Column(String(20), nullable=False, default="local")
    avatar_url = Column(String(500), nullable=True)
    avatar_public_id = Column(String(255), nullable=True)
    theme_skin = Column(String(10), nullable=False, default="dark")
