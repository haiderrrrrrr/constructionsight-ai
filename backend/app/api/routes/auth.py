from fastapi import APIRouter, Depends, HTTPException, status, Body, Request, Response, Header
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from slowapi.errors import RateLimitExceeded
from fastapi.responses import JSONResponse
from urllib.parse import urlparse
import re
import secrets
import requests as http_requests
from sqlalchemy.exc import IntegrityError

from ...core.db import get_db, Base, engine
from ...models.user import User, PlatformRole
from ...models.token import RefreshToken
from ...models.auth_event import AuthEvent
from ...models.project_invitation import ProjectInvitation, InvitationStatus
from ...schemas.user import UserCreate, UserLogin, UserOut, Token
from ...core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    generate_refresh_token,
    hash_token,
    generate_token_family,
)
from ...core.config import settings
from ...core.limiter import limiter
from ..deps import get_current_user  # used via Depends() in logout_all


router = APIRouter(prefix="/auth", tags=["auth"])

def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)

def _origin_allowed(origin: str) -> bool:
    if not origin:
        return False
    try:
        u = urlparse(origin)
        base = f"{u.scheme}://{u.netloc}"
    except Exception:
        base = origin
    allowed = set(settings.allowed_origins)
    return base in allowed

def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""

def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:512]

def _cookie_domain():
    return getattr(settings, "refresh_cookie_domain", None) or None

def _log_event(db: Session, *, user_id: int | None, event_type: str, identifier: str | None, request: Request, extra: str | None = None):
    ev = AuthEvent(
        user_id=user_id,
        event_type=event_type,
        identifier=identifier,
        ip=_client_ip(request),
        user_agent=_user_agent(request),
        extra=extra[:512] if extra else None,
    )
    db.add(ev)
def _log_and_commit(db: Session, *, user_id: int | None, event_type: str, identifier: str | None, request: Request, extra: str | None = None):
    _log_event(db, user_id=user_id, event_type=event_type, identifier=identifier, request=request, extra=extra)
    db.commit()

@router.post("/signup", response_model=UserOut)
@limiter.limit(settings.rate_limit_signup)
def signup(payload: UserCreate, request: Request, db: Session = Depends(get_db)):
    # Check uniqueness
    if db.query(User).filter(User.email == payload.email).first():
        _log_and_commit(db, user_id=None, event_type="signup_fail", identifier=payload.email, request=request, extra="email_already_registered")
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == payload.username).first():
        _log_and_commit(db, user_id=None, event_type="signup_fail", identifier=payload.username, request=request, extra="username_already_taken")
        raise HTTPException(status_code=400, detail="Username already taken")

    user = User(
        full_name=payload.full_name,
        email=payload.email,
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        platform_role=PlatformRole.USER,
    )
    if payload.invite_token:
        now = datetime.now(timezone.utc)
        inv = db.query(ProjectInvitation).filter(
            ProjectInvitation.token == payload.invite_token,
            ProjectInvitation.status == InvitationStatus.PENDING,
            ProjectInvitation.expires_at > now,
        ).first()
        if inv and (inv.email or "").strip().lower() == payload.email:
            user.is_approved = True
    db.add(user)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        # re-check after rollback so user gets clean message instead of 500
        if db.query(User).filter(User.email == payload.email).first():
            _log_and_commit(db, user_id=None, event_type="signup_fail", identifier=payload.email, request=request, extra="email_already_registered_race")
            raise HTTPException(status_code=400, detail="Email already registered")
        if db.query(User).filter(User.username == payload.username).first():
            _log_and_commit(db, user_id=None, event_type="signup_fail", identifier=payload.username, request=request, extra="username_already_taken_race")
            raise HTTPException(status_code=400, detail="Username already taken")
        _log_and_commit(db, user_id=None, event_type="signup_fail", identifier=payload.email, request=request, extra="account_creation_failed_race")
        raise HTTPException(status_code=500, detail="Account creation failed. Please try again.")

    db.refresh(user)
    _log_event(db, user_id=user.id, event_type="signup", identifier=user.email, request=request, extra=None)
    db.commit()
    return user


@router.post("/login", response_model=Token)
@limiter.limit(settings.rate_limit_login)
def login(payload: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)):
    identifier = (payload.identifier or "").strip().lower()
    if not identifier:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="missing_identifier")
        raise HTTPException(status_code=400, detail="Missing username or email")
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.login_fail_window_minutes)
    recent_failures = (
        db.query(AuthEvent)
        .filter(
            AuthEvent.event_type == "login_fail",
            AuthEvent.created_at > cutoff,
            (AuthEvent.identifier == identifier),
        )
        .count()
    )
    if recent_failures >= settings.login_fail_threshold:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=identifier, request=request, extra="rate_limited")
        raise HTTPException(status_code=429, detail="Invalid credentials")
    if "@" in identifier:
        user = db.query(User).filter(User.email == identifier).first()
    else:
        user = db.query(User).filter(User.username == identifier).first()
    now = datetime.now(timezone.utc)
    if user and user.locked_until and user.locked_until > now:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=identifier, request=request, extra="account_locked")
        raise HTTPException(status_code=423, detail="Account temporarily locked")
    if not user or not verify_password(payload.password, user.password_hash):
        if user:
            user.failed_login_count = (user.failed_login_count or 0) + 1
            if user.failed_login_count % settings.lockout_threshold == 0:
                rounds = user.failed_login_count // settings.lockout_threshold
                minutes = min(settings.lockout_base_minutes * (settings.lockout_multiplier ** (rounds - 1)), settings.lockout_max_minutes)
                user.locked_until = now + timedelta(minutes=minutes)
                db.add(user)
                db.commit()
                _log_event(db, user_id=user.id, event_type="login_fail", identifier=identifier, request=request, extra="account_locked")
                db.commit()
                raise HTTPException(status_code=423, detail="Account temporarily locked")
            db.add(user)
            db.commit()
        _log_event(db, user_id=user.id if user else None, event_type="login_fail", identifier=identifier, request=request, extra=None)
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=identifier, request=request, extra="account_deactivated")
        raise HTTPException(status_code=403, detail="Account deactivated. Please contact your administrator.")
    if not user.is_approved:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=identifier, request=request, extra="account_pending_approval")
        raise HTTPException(status_code=403, detail="Account pending approval. Please wait for an administrator to approve your account.")
    access_token = create_access_token(subject=str(user.id), platform_role=user.platform_role.value, token_version=user.token_version)
    raw_refresh = generate_refresh_token()
    family = generate_token_family()
    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.refresh_token_exp_minutes),
        family=family,
        remember=bool(getattr(payload, "remember", False)),
        token_version=user.token_version or 1,
    )
    db.add(rt)
    user.failed_login_count = 0
    user.locked_until = None
    db.add(user)
    _log_event(db, user_id=user.id, event_type="login_success", identifier=identifier, request=request, extra=None)
    db.commit()
    max_age = settings.refresh_token_exp_minutes * 60 if getattr(payload, "remember", False) else None
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=raw_refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        path="/auth",
        domain=_cookie_domain(),
        max_age=max_age,
    )
    return Token(access_token=access_token, platform_role=user.platform_role)


@router.post("/refresh", response_model=Token)
@limiter.limit(settings.rate_limit_refresh)
def refresh(request: Request, response: Response, db: Session = Depends(get_db), origin: str | None = Header(default=None), referer: str | None = Header(default=None)):
    refresh_token = request.cookies.get(settings.refresh_cookie_name)
    if not refresh_token:
        _log_and_commit(db, user_id=None, event_type="refresh_fail", identifier=None, request=request, extra="missing_cookie")
        raise HTTPException(status_code=401, detail="Missing refresh token cookie")
    hdr_origin = origin or ""
    if not hdr_origin and referer:
        hdr_origin = referer
    if hdr_origin:
        if not _origin_allowed(hdr_origin):
            _log_and_commit(db, user_id=None, event_type="refresh_fail", identifier=None, request=request, extra="csrf_origin_not_allowed")
            raise HTTPException(status_code=403, detail="CSRF protection: origin not allowed")
    else:
        if settings.is_dev:
            host = request.client.host if request.client else ""
            if host not in ("127.0.0.1", "localhost"):
                _log_and_commit(db, user_id=None, event_type="refresh_fail", identifier=None, request=request, extra="csrf_dev_host_not_allowed")
                raise HTTPException(status_code=403, detail="CSRF protection: dev host not allowed")
        else:
            _log_and_commit(db, user_id=None, event_type="refresh_fail", identifier=None, request=request, extra="csrf_origin_missing")
            raise HTTPException(status_code=403, detail="CSRF protection: origin missing")
    token_record = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hash_token(refresh_token))
        .first()
    )
    if not token_record:
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_event(db, user_id=None, event_type="refresh_fail", identifier=None, request=request, extra="not_found")
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if token_record.revoked:
        if token_record.family:
            db.query(RefreshToken).filter(RefreshToken.family == token_record.family).update({"revoked": True})
            db.commit()
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_event(db, user_id=token_record.user_id, event_type="refresh_reuse_detected", identifier=None, request=request, extra=f"family={token_record.family} possible_theft")
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh token reuse detected")
    if _as_utc(token_record.expires_at) < datetime.now(timezone.utc):
        token_record.revoked = True
        db.add(token_record)
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_event(db, user_id=token_record.user_id, event_type="refresh_fail", identifier=None, request=request, extra="expired")
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user = db.query(User).filter(User.id == token_record.user_id).first()
    if not user:
        _log_and_commit(db, user_id=token_record.user_id, event_type="refresh_fail", identifier=None, request=request, extra="user_not_found")
        raise HTTPException(status_code=404, detail="User not found")
    user_identifier = (user.email or "").strip().lower() or None
    if int(token_record.token_version or 1) != int(user.token_version or 1):
        token_record.revoked = True
        db.add(token_record)
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_and_commit(db, user_id=user.id, event_type="refresh_fail", identifier=user_identifier, request=request, extra="token_version_mismatch")
        raise HTTPException(status_code=401, detail="Session invalidated")
    if not user.is_active:
        token_record.revoked = True
        db.add(token_record)
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_and_commit(db, user_id=user.id, event_type="refresh_fail", identifier=user_identifier, request=request, extra="account_deactivated")
        raise HTTPException(status_code=403, detail="Account deactivated. Please contact your administrator.")
    if not user.is_approved:
        token_record.revoked = True
        db.add(token_record)
        response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
        _log_and_commit(db, user_id=user.id, event_type="refresh_fail", identifier=user_identifier, request=request, extra="account_pending_approval")
        raise HTTPException(status_code=403, detail="Account pending approval. Please wait for an administrator to approve your account.")

    token_record.revoked = True
    access_token = create_access_token(subject=str(user.id), platform_role=user.platform_role.value, token_version=user.token_version)
    new_raw_refresh = generate_refresh_token()
    new_rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(new_raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.refresh_token_exp_minutes),
        family=token_record.family,
        remember=bool(getattr(token_record, "remember", False)),
        token_version=user.token_version or 1,
    )
    db.add(token_record)
    db.add(new_rt)
    _log_event(db, user_id=user.id, event_type="refresh_success", identifier=user_identifier, request=request, extra=None)
    db.commit()
    max_age = (settings.refresh_token_exp_minutes * 60) if bool(getattr(token_record, "remember", False)) else None
    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=new_raw_refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        path="/auth",
        domain=_cookie_domain(),
        max_age=max_age,
    )
    return Token(access_token=access_token, platform_role=user.platform_role)


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    origin: str | None = Header(default=None),
    referer: str | None = Header(default=None),
):
    hdr_origin = origin or ""
    if not hdr_origin and referer:
        hdr_origin = referer
    if hdr_origin:
        if not _origin_allowed(hdr_origin):
            _log_and_commit(db, user_id=None, event_type="logout", identifier=None, request=request, extra="csrf_origin_not_allowed")
            raise HTTPException(status_code=403, detail="CSRF protection: origin not allowed")
    else:
        if settings.is_dev:
            host = request.client.host if request.client else ""
            if host not in ("127.0.0.1", "localhost"):
                _log_and_commit(db, user_id=None, event_type="logout", identifier=None, request=request, extra="csrf_dev_host_not_allowed")
                raise HTTPException(status_code=403, detail="CSRF protection: dev host not allowed")
        else:
            _log_and_commit(db, user_id=None, event_type="logout", identifier=None, request=request, extra="csrf_origin_missing")
            raise HTTPException(status_code=403, detail="CSRF protection: origin missing")
    rt_value = request.cookies.get(settings.refresh_cookie_name)
    rec = None
    if rt_value:
        rec = db.query(RefreshToken).filter(RefreshToken.token_hash == hash_token(rt_value)).first()
        if rec:
            rec.revoked = True
            db.add(rec)
    response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
    logout_user_id = rec.user_id if rt_value and rec else None
    logout_identifier = None
    if logout_user_id is not None:
        logout_identifier = db.query(User.email).filter(User.id == logout_user_id).scalar()
        logout_identifier = (logout_identifier or "").strip().lower() or None
    _log_event(db, user_id=logout_user_id, event_type="logout", identifier=logout_identifier, request=request, extra=None)
    db.commit()
    return {"ok": True}


@router.post("/logout-all")
def logout_all(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    origin: str | None = Header(default=None),
    referer: str | None = Header(default=None),
):
    hdr_origin = origin or ""
    if not hdr_origin and referer:
        hdr_origin = referer
    if hdr_origin:
        if not _origin_allowed(hdr_origin):
            _log_and_commit(db, user_id=user.id, event_type="logout_all", identifier=(user.email or "").strip().lower() or None, request=request, extra="csrf_origin_not_allowed")
            raise HTTPException(status_code=403, detail="CSRF protection: origin not allowed")
    else:
        if settings.is_dev:
            host = request.client.host if request.client else ""
            if host not in ("127.0.0.1", "localhost"):
                _log_and_commit(db, user_id=user.id, event_type="logout_all", identifier=(user.email or "").strip().lower() or None, request=request, extra="csrf_dev_host_not_allowed")
                raise HTTPException(status_code=403, detail="CSRF protection: dev host not allowed")
        else:
            _log_and_commit(db, user_id=user.id, event_type="logout_all", identifier=(user.email or "").strip().lower() or None, request=request, extra="csrf_origin_missing")
            raise HTTPException(status_code=403, detail="CSRF protection: origin missing")
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
    user.token_version = (user.token_version or 1) + 1
    db.add(user)
    response.delete_cookie(settings.refresh_cookie_name, path="/auth", domain=_cookie_domain())
    _log_event(db, user_id=user.id, event_type="logout_all", identifier=(user.email or "").strip().lower() or None, request=request, extra=None)
    db.commit()
    return {"ok": True}


@router.post("/google", response_model=Token)
@limiter.limit("10/minute")
def google_auth(request: Request, response: Response, db: Session = Depends(get_db),
                code: str = Body(..., embed=True),
                invite_token: str | None = Body(None, embed=True)):
    if not settings.google_client_id or not settings.google_client_secret:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="google_not_configured")
        raise HTTPException(status_code=503, detail="Google OAuth not configured")

    # 1. Exchange authorization code for tokens
    try:
        token_res = http_requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": "postmessage",
                "grant_type": "authorization_code",
            },
            timeout=10,
        )
    except Exception:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="google_exchange_failure")
        raise HTTPException(status_code=503, detail="Could not reach Google to exchange code")

    if token_res.status_code != 200:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="invalid_google_auth_code")
        raise HTTPException(status_code=401, detail="Invalid Google authorization code")

    raw_id_token = token_res.json().get("id_token")
    if not raw_id_token:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="no_google_id_token")
        raise HTTPException(status_code=401, detail="No ID token returned from Google")

    # 2. Verify ID token locally — no extra HTTP call needed
    try:
        from google.oauth2 import id_token as google_id_token
        from google.auth.transport import requests as google_requests
        idinfo = google_id_token.verify_oauth2_token(
            raw_id_token,
            google_requests.Request(),
            settings.google_client_id,
        )
    except ValueError:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="invalid_google_id_token")
        raise HTTPException(status_code=401, detail="Invalid Google ID token")

    if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="invalid_google_issuer")
        raise HTTPException(status_code=401, detail="Invalid Google ID token issuer")
    if not idinfo.get("email_verified", False):
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="google_email_not_verified")
        raise HTTPException(status_code=400, detail="Google account email is not verified")

    email = (idinfo.get("email") or "").lower().strip()
    if not email:
        _log_and_commit(db, user_id=None, event_type="login_fail", identifier=None, request=request, extra="no_google_email")
        raise HTTPException(status_code=400, detail="No email returned from Google")

    full_name = (idinfo.get("name") or idinfo.get("given_name") or "").strip()

    # 3. Find or create user (with race-condition guard)
    user = db.query(User).filter(User.email == email).first()
    if not user:
        base = re.sub(r"[^a-z0-9_]", "", email.split("@")[0].lower())[:25]
        if not base or not base[0].isalpha():
            base = "user" + base
        username = base
        counter = 1
        while db.query(User).filter(User.username == username).first():
            username = f"{base}{counter}"
            counter += 1

        user = User(
            full_name=full_name or email.split("@")[0],
            email=email,
            username=username,
            password_hash=get_password_hash(secrets.token_hex(32)),
            platform_role=PlatformRole.USER,
            auth_provider="google",
            is_approved=True,
        )
        if invite_token:
            now = datetime.now(timezone.utc)
            inv = db.query(ProjectInvitation).filter(
                ProjectInvitation.token == invite_token,
                ProjectInvitation.status == InvitationStatus.PENDING,
                ProjectInvitation.expires_at > now,
            ).first()
            if inv and (inv.email or "").strip().lower() == email:
                user.is_approved = True
        db.add(user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            user = db.query(User).filter(User.email == email).first()
            if not user:
                _log_and_commit(db, user_id=None, event_type="signup", identifier=email, request=request, extra="google_account_creation_failed")
                raise HTTPException(status_code=500, detail="Account creation failed, please try again")
        db.refresh(user)
        _log_event(db, user_id=user.id, event_type="signup", identifier=email, request=request, extra="google_oauth")
        db.commit()
    else:
        # Existing local user logging in with Google — update auth_provider to hybrid if it's still "local"
        if user.auth_provider == "local":
            user.auth_provider = "hybrid"
            db.add(user)
            db.commit()

    now = datetime.now(timezone.utc)
    if user.locked_until and user.locked_until > now:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=email, request=request, extra="account_locked")
        raise HTTPException(status_code=423, detail="Account temporarily locked")
    if not user.is_active:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=email, request=request, extra="account_deactivated")
        raise HTTPException(status_code=403, detail="Account deactivated. Please contact your administrator.")
    if not user.is_approved:
        _log_and_commit(db, user_id=user.id, event_type="login_fail", identifier=email, request=request, extra="account_pending_approval")
        raise HTTPException(status_code=403, detail="Account pending approval. Please wait for an administrator to approve your account.")

    # 4. Issue tokens (same as regular login)
    access_tok = create_access_token(subject=str(user.id), platform_role=user.platform_role.value, token_version=user.token_version)
    raw_refresh = generate_refresh_token()
    family = generate_token_family()
    rt = RefreshToken(
        user_id=user.id,
        token_hash=hash_token(raw_refresh),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.refresh_token_exp_minutes),
        family=family,
        remember=False,
        token_version=user.token_version or 1,
    )
    db.add(rt)
    user.failed_login_count = 0
    user.locked_until = None
    db.add(user)
    _log_event(db, user_id=user.id, event_type="login_success", identifier=email, request=request, extra="google_oauth")
    db.commit()

    response.set_cookie(
        key=settings.refresh_cookie_name,
        value=raw_refresh,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.refresh_cookie_samesite,
        path="/auth",
        domain=_cookie_domain(),
        max_age=None,
    )
    return Token(access_token=access_tok, platform_role=user.platform_role)
