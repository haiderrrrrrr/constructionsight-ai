from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
import secrets
import hashlib
import re

from ...core.db import get_db
from ...models.user import User
from ...models.password_reset import PasswordResetOtp, PasswordResetSession
from ...models.auth_event import AuthEvent
from ...schemas.password_reset import (
    PasswordResetRequest,
    PasswordResetRequestResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
)
from ...core.security import get_password_hash, verify_password
from ...core.config import settings
from ...core.limiter import limiter
from ...services.email import send_password_reset_email

router = APIRouter(prefix="/auth", tags=["password-reset"])

# Common password list for validation
_COMMON_PASSWORDS = {
    "Password1!", "Password1@", "Password123!", "Admin1234!", "Welcome1!",
    "Qwerty123!", "Letmein1!", "Monkey123!", "Dragon123!", "Master123!",
    "Summer2024!", "Winter2024!", "Spring2024!", "Autumn2024!", "Login123!",
    "Pass1234!", "Test1234!", "User1234!", "Root1234!", "Admin123!",
    "Hello123!", "Start123!", "Change1!", "Secret1!", "Access1!",
    "Shadow1!", "Batman1!", "Trustno1!", "Baseball1!", "Football1!",
    "Superman1!", "Michael1!", "Jennifer1!", "Jordan123!", "Ranger1!",
    "Pepper123!", "Soccer123!", "Hockey123!", "Harley123!", "Ranger123!",
    "Charlie1!", "Donald1!", "Andrew1!", "Thomas1!", "George1!",
    "Jordan1!", "Hunter1!", "Buster1!", "Tigger1!", "Robert1!",
}


def _client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


def _user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:512]


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


def _validate_password(password: str) -> tuple[bool, str]:
    """Validate password using same rules as signup. Returns (is_valid, error_message)."""
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if len(password) > 128:
        return False, "Password must not exceed 128 characters"
    if not re.search(r"[A-Z]", password):
        return False, "Password must include an uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must include a lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must include a number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return False, "Password must include a special character"
    if password in _COMMON_PASSWORDS:
        return False, "Password is too common. Please choose a stronger password"
    return True, ""


@router.post("/request-password-reset", response_model=PasswordResetRequestResponse)
@limiter.limit("3/minute")
def request_password_reset(
    body: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Always return neutral 200 response regardless of conditions.
    Silently skip sending OTP for: unknown email, inactive user, Google-only account, cooldown, resend limit.
    """
    email = body.email.strip().lower()

    # Look up user
    user = db.query(User).filter(User.email == email).first()

    # Condition 1: No user exists
    if not user:
        _log_event(db, user_id=None, event_type="password_reset_requested", identifier=email, request=request, extra="no_account")
        db.commit()
        return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")

    # Condition 2: User is inactive
    if not user.is_active:
        _log_event(db, user_id=user.id, event_type="password_reset_requested", identifier=email, request=request, extra="account_disabled")
        db.commit()
        return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")

    # Condition 3: User is Google-only (auth_provider == "google")
    if user.auth_provider == "google":
        _log_event(db, user_id=user.id, event_type="password_reset_requested", identifier=email, request=request, extra="google_only")
        db.commit()
        return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")

    # Condition 4: Backend cooldown check (60 seconds since last OTP)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=60)
    recent_otp = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.user_id == user.id,
            PasswordResetOtp.used == False,
            PasswordResetOtp.created_at > cutoff,
        )
        .order_by(PasswordResetOtp.created_at.desc())
        .first()
    )
    if recent_otp:
        _log_event(db, user_id=user.id, event_type="password_reset_requested", identifier=email, request=request, extra="cooldown")
        db.commit()
        return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")

    # Condition 5: Backend resend count check (3 OTPs in last 30 minutes)
    cutoff_30min = now - timedelta(minutes=30)
    otp_count = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.user_id == user.id,
            PasswordResetOtp.created_at > cutoff_30min,
        )
        .count()
    )
    if otp_count >= 3:
        _log_event(db, user_id=user.id, event_type="password_reset_requested", identifier=email, request=request, extra="resend_limit")
        db.commit()
        return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")

    # All checks passed — proceed to send OTP
    # Step 1: Invalidate all existing unused OTPs
    db.query(PasswordResetOtp).filter(
        PasswordResetOtp.user_id == user.id,
        PasswordResetOtp.used == False,
    ).update({"used": True})

    # Step 2: Invalidate all existing unused reset sessions
    db.query(PasswordResetSession).filter(
        PasswordResetSession.user_id == user.id,
        PasswordResetSession.used == False,
    ).update({"used": True})

    # Step 3: Generate and hash OTP
    otp = str(secrets.randbelow(1_000_000)).zfill(6)
    otp_hash = hashlib.sha256(otp.encode()).hexdigest()

    # Step 4: Create OTP record (include email for email-locking)
    otp_record = PasswordResetOtp(
        user_id=user.id,
        email=email,  # Store which email this reset is for
        otp_hash=otp_hash,
        expires_at=now + timedelta(minutes=10),
    )
    db.add(otp_record)
    db.commit()

    # Step 5: Send email (after commit)
    send_password_reset_email(email, otp, user.full_name)

    # Step 6: Log event
    _log_event(db, user_id=user.id, event_type="password_reset_requested", identifier=email, request=request, extra=None)
    db.commit()

    return PasswordResetRequestResponse(message="If an account exists for this email, a verification code has been sent.")


@router.post("/verify-password-reset-otp", response_model=VerifyOtpResponse)
@limiter.limit("3/minute")
def verify_password_reset_otp(
    body: VerifyOtpRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Verify OTP and return reset session token."""
    email = body.email.strip().lower()
    otp = body.otp.strip()

    # Validate OTP format
    if not re.match(r"^\d{6}$", otp):
        _log_event(db, user_id=None, event_type="password_reset_failed", identifier=email, request=request, extra="invalid_otp_format")
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid code format")

    # Look up user
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        extra = "user_not_found" if not user else "account_disabled"
        _log_event(db, user_id=user.id if user else None, event_type="password_reset_failed", identifier=email, request=request, extra=extra)
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    # Find latest non-expired, non-used OTP
    now = datetime.now(timezone.utc)
    otp_record = (
        db.query(PasswordResetOtp)
        .filter(
            PasswordResetOtp.user_id == user.id,
            PasswordResetOtp.used == False,
            PasswordResetOtp.expires_at > now,
        )
        .order_by(PasswordResetOtp.created_at.desc())
        .first()
    )

    if not otp_record:
        _log_event(db, user_id=user.id, event_type="password_reset_failed", identifier=email, request=request, extra="no_valid_otp")
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired code")

    # Check attempt count
    if otp_record.attempt_count >= 5:
        otp_record.used = True
        db.add(otp_record)
        db.commit()
        _log_event(db, user_id=user.id, event_type="password_reset_failed", identifier=email, request=request, extra="max_attempts")
        db.commit()
        raise HTTPException(status_code=400, detail="Too many attempts. Please restart the reset process.")

    # Compare OTP hash
    entered_hash = hashlib.sha256(otp.encode()).hexdigest()
    if entered_hash != otp_record.otp_hash:
        otp_record.attempt_count += 1

        if otp_record.attempt_count >= 5:
            otp_record.used = True
            db.add(otp_record)
            db.commit()
            _log_event(db, user_id=user.id, event_type="password_reset_failed", identifier=email, request=request, extra="max_attempts")
            db.commit()
            raise HTTPException(status_code=400, detail="Too many attempts. Please restart the reset process.")

        db.add(otp_record)
        db.commit()
        remaining = 5 - otp_record.attempt_count
        _log_event(db, user_id=user.id, event_type="password_reset_failed", identifier=email, request=request, extra="wrong_otp")
        db.commit()
        raise HTTPException(status_code=400, detail=f"Invalid code. {remaining} attempts remaining.")

    # OTP correct — mark as used and create reset session token
    otp_record.used = True
    db.add(otp_record)

    reset_token = secrets.token_urlsafe(48)
    token_hash = hashlib.sha256(reset_token.encode()).hexdigest()

    session_record = PasswordResetSession(
        user_id=user.id,
        token_hash=token_hash,
        expires_at=now + timedelta(minutes=15),
    )
    db.add(session_record)
    db.commit()

    _log_event(db, user_id=user.id, event_type="password_reset_otp_verified", identifier=email, request=request, extra=None)
    db.commit()

    return VerifyOtpResponse(reset_token=reset_token)


@router.post("/reset-password", response_model=ResetPasswordResponse)
@limiter.limit("3/minute")
def reset_password(
    body: ResetPasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """Reset password using valid reset session token."""
    reset_token = body.reset_token.strip()

    # Hash and validate reset session token
    token_hash = hashlib.sha256(reset_token.encode()).hexdigest()
    now = datetime.now(timezone.utc)

    session_record = (
        db.query(PasswordResetSession)
        .filter(
            PasswordResetSession.token_hash == token_hash,
            PasswordResetSession.used == False,
            PasswordResetSession.expires_at > now,
        )
        .first()
    )

    if not session_record:
        _log_event(db, user_id=None, event_type="password_reset_failed", identifier=None, request=request, extra="invalid_reset_session")
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset session")

    # Get user
    user = db.query(User).filter(User.id == session_record.user_id).first()
    if not user:
        _log_event(db, user_id=session_record.user_id, event_type="password_reset_failed", identifier=None, request=request, extra="user_not_found")
        db.commit()
        raise HTTPException(status_code=400, detail="Invalid or expired reset session")

    # Validate new password
    is_valid, error_msg = _validate_password(body.new_password)
    if not is_valid:
        _log_event(db, user_id=user.id, event_type="password_reset_failed", identifier=user.email, request=request, extra="invalid_password")
        db.commit()
        raise HTTPException(status_code=422, detail=error_msg)

    # Hash new password
    new_password_hash = get_password_hash(body.new_password)

    # Update user
    user.password_hash = new_password_hash
    user.token_version = (user.token_version or 1) + 1
    user.failed_login_count = 0
    user.locked_until = None
    db.add(user)

    # Revoke all refresh tokens
    from ...models.token import RefreshToken
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})

    # Invalidate all OTPs and reset sessions for this user
    db.query(PasswordResetOtp).filter(PasswordResetOtp.user_id == user.id).update({"used": True})
    db.query(PasswordResetSession).filter(PasswordResetSession.user_id == user.id).update({"used": True})

    db.commit()

    _log_event(db, user_id=user.id, event_type="password_reset_success", identifier=user.email, request=request, extra=None)
    db.commit()

    return ResetPasswordResponse(message="Your password has been reset successfully. Please sign in again.")
