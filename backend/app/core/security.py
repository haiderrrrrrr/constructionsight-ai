from datetime import datetime, timedelta, timezone
from jose import jwt, JWTError
from passlib.context import CryptContext
import secrets, hashlib
from .config import settings
from typing import Dict

from uuid import uuid4

# Use Argon2 exclusively to avoid bcrypt backend issues
pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def create_access_token(
    subject: str,
    platform_role: str,
    token_version: int = 1,
    expires_minutes: int = settings.access_token_exp_minutes,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    now = datetime.now(timezone.utc)
    to_encode = {
        "sub": subject,
        "platform_role": platform_role,
        "exp": expire,
        "iat": int(now.timestamp()),
        "iss": settings.jwt_issuer,
        "aud": settings.jwt_audience,
        "jti": str(uuid4()),
        "ver": int(token_version),
    }
    headers = {"kid": settings.jwt_key_id}
    return jwt.encode(to_encode, settings.jwt_secret, algorithm=settings.jwt_algorithm, headers=headers)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def generate_refresh_token() -> str:
    """Create a random opaque refresh token."""
    return secrets.token_urlsafe(64)


def hash_token(token: str) -> str:
    """Store only a hash of refresh tokens in DB."""
    return hashlib.sha256(token.encode()).hexdigest()


def decode_access_token(token: str) -> Dict:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
            audience=settings.jwt_audience,
            options={"require_aud": True, "require_iss": True, "require_iat": True},
            issuer=settings.jwt_issuer,
        )
        return payload
    except JWTError:
        for old in settings.jwt_previous_secrets:
            try:
                payload = jwt.decode(
                    token,
                    old,
                    algorithms=[settings.jwt_algorithm],
                    audience=settings.jwt_audience,
                    options={"require_aud": True, "require_iss": True, "require_iat": True},
                    issuer=settings.jwt_issuer,
                )
                return payload
            except JWTError:
                continue
        raise


def generate_token_family() -> str:
    return secrets.token_urlsafe(16)
