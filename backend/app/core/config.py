import os
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")
from pydantic import BaseModel, field_validator

_env_name = os.getenv("ENV", os.getenv("NODE_ENV", "development"))
_is_dev_default = _env_name.lower() in ("dev", "development", "local")
_RATE_LIMIT_LOGIN = os.getenv("RATE_LIMIT_LOGIN", "").strip()
_RATE_LIMIT_SIGNUP = os.getenv("RATE_LIMIT_SIGNUP", "").strip()
_RATE_LIMIT_REFRESH = os.getenv("RATE_LIMIT_REFRESH", "").strip()

if _is_dev_default and _RATE_LIMIT_LOGIN in ("", "5/minute"):
    _RATE_LIMIT_LOGIN = "200/minute"
if _is_dev_default and _RATE_LIMIT_SIGNUP in ("", "3/minute"):
    _RATE_LIMIT_SIGNUP = "200/minute"
if _is_dev_default and _RATE_LIMIT_REFRESH in ("", "10/minute"):
    _RATE_LIMIT_REFRESH = "200/minute"

if not _RATE_LIMIT_LOGIN:
    _RATE_LIMIT_LOGIN = "5/minute"
if not _RATE_LIMIT_SIGNUP:
    _RATE_LIMIT_SIGNUP = "3/minute"
if not _RATE_LIMIT_REFRESH:
    _RATE_LIMIT_REFRESH = "10/minute"


class Settings(BaseModel):
    app_name: str = "ConstructionSight AI Backend"
    version: str = "1.0"

    # Database (defaults for local pgAdmin: user `postgres`, password `root`)
    db_host: str = os.getenv("DB_HOST", "localhost")
    db_port: str = os.getenv("DB_PORT", "5432")
    db_user: str = os.getenv("DB_USER", "postgres")
    db_password: str = os.getenv("DB_PASSWORD", "admin")
    db_name: str = os.getenv("DB_NAME", "constructionsight")

    database_url: str = os.getenv(
        "DATABASE_URL",
        f"postgresql+psycopg2://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}",
    )

    # JWT
    jwt_secret: str = os.getenv("JWT_SECRET")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    access_token_exp_minutes: int = int(os.getenv("ACCESS_TOKEN_EXP_MINUTES", "15"))
    refresh_token_exp_minutes: int = int(os.getenv("REFRESH_TOKEN_EXP_MINUTES", str(60 * 24 * 7)))
    jwt_previous_secrets: list[str] = list(
        s for s in (os.getenv("JWT_PREVIOUS_SECRETS", "").split(",") if os.getenv("JWT_PREVIOUS_SECRETS") else []) if s
    )
    jwt_issuer: str = os.getenv("JWT_ISSUER", "constructionsight-ai")
    jwt_audience: str = os.getenv("JWT_AUDIENCE", "constructionsight-client")
    jwt_key_id: str = os.getenv("JWT_KEY_ID", "current")

    # Rate limits (SlowAPI)
    rate_limit_login: str = _RATE_LIMIT_LOGIN
    rate_limit_signup: str = _RATE_LIMIT_SIGNUP
    rate_limit_refresh: str = _RATE_LIMIT_REFRESH

    # Frontend/CORS/CSRF
    allowed_origins: list[str] = list(
        o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173").split(",")
    )
    refresh_cookie_name: str = os.getenv("REFRESH_COOKIE_NAME", "refresh_token")
    refresh_cookie_samesite: str = os.getenv("REFRESH_COOKIE_SAMESITE", "lax")
    refresh_cookie_domain: str | None = os.getenv("REFRESH_COOKIE_DOMAIN", None)
    cookie_secure: bool = os.getenv("COOKIE_SECURE", "false").lower() in ("true", "1", "yes", "y")
    env: str = os.getenv("ENV", os.getenv("NODE_ENV", "development"))
    is_dev: bool = env.lower() in ("dev", "development", "local")

    @field_validator("jwt_secret")
    @classmethod
    def jwt_secret_required(cls, v: str) -> str:
        if not v:
            raise ValueError("JWT_SECRET environment variable must be set")
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v

    # Frontend URL (used for invitation email links)
    frontend_url: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

    # Gmail SMTP (for sending invitation emails)
    gmail_user: str = os.getenv("GMAIL_USER", "constructionsightai@gmail.com")
    gmail_app_password: str = os.getenv("GMAIL_APP_PASSWORD", "")

    # Google OAuth
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")

    # Cloudinary
    cloudinary_cloud_name: str = os.getenv("CLOUDINARY_CLOUD_NAME", "")
    cloudinary_api_key: str = os.getenv("CLOUDINARY_API_KEY", "")
    cloudinary_api_secret: str = os.getenv("CLOUDINARY_API_SECRET", "")

    # Auth security
    login_fail_window_minutes: int = int(os.getenv("LOGIN_FAIL_WINDOW_MINUTES", "15"))
    login_fail_threshold: int = int(os.getenv("LOGIN_FAIL_THRESHOLD", "10"))
    lockout_threshold: int = int(os.getenv("LOCKOUT_THRESHOLD", "5"))
    lockout_base_minutes: int = int(os.getenv("LOCKOUT_BASE_MINUTES", "5"))
    lockout_multiplier: int = int(os.getenv("LOCKOUT_MULTIPLIER", "2"))
    lockout_max_minutes: int = int(os.getenv("LOCKOUT_MAX_MINUTES", "60"))

    # OpenWeatherMap (for Risk Analytics weather data)
    openweather_api_key: str = os.getenv("OPENWEATHER_API_KEY", "")

    # Camera health-check scheduler
    camera_scheduler_enabled: bool = os.getenv("CAMERA_SCHEDULER_ENABLED", "true").lower() in ("true", "1", "yes", "y")
    camera_scheduler_interval_minutes: int = int(os.getenv("CAMERA_SCHEDULER_INTERVAL_MINUTES", "5"))

    # Celery: when False (default) video clips are encoded via local ThreadPoolExecutor.
    # Set CELERY_ENABLED=true when Redis + a Celery worker are running.
    celery_enabled: bool = os.getenv("CELERY_ENABLED", "false").lower() in ("true", "1", "yes", "y")

    # Media storage paths for snapshots and video clips
    media_snapshots_dir: str = os.getenv("MEDIA_SNAPSHOTS_DIR", "media/snapshots")
    media_clips_dir: str = os.getenv("MEDIA_CLIPS_DIR", "media/clips")

    # Camera credential encryption (Fernet key)
    camera_encryption_key: str = os.getenv("CAMERA_ENCRYPTION_KEY", "")

    # Project settings defaults
    report_frequency: str = os.getenv("REPORT_FREQUENCY", "weekly")

    # Webhook integration (n8n, etc.)
    webhook_api_key: str = os.getenv("WEBHOOK_API_KEY", "")

    # PDF report storage
    reports_dir: str = os.getenv("REPORTS_DIR", "reports")

    @field_validator("camera_encryption_key")
    @classmethod
    def validate_camera_key(cls, v: str) -> str:
        if not v:
            raise ValueError("CAMERA_ENCRYPTION_KEY must be set")
        try:
            from cryptography.fernet import Fernet
            Fernet(v.encode())
        except Exception:
            raise ValueError("CAMERA_ENCRYPTION_KEY must be a valid Fernet key")
        return v


settings = Settings()
