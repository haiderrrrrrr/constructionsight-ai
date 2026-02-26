from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Request
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timezone

from ...core.db import get_db
from ...models.user import User
from ...models.token import RefreshToken
from ...schemas.user import UserCreate, UserOut, UserMeOut, UserProfileUpdate, UserPasswordChange, UserThemeUpdate
from ...core.security import verify_password, get_password_hash
from ..deps import get_current_user, log_event
from ...services.cloudinary import upload_image, delete_asset

router = APIRouter(prefix="/users", tags=["users"])

ALLOWED_AVATAR_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_AVATAR_SIZE = 5 * 1024 * 1024  # 5 MB


@router.get("/me", response_model=UserMeOut)
def get_current_user_profile(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user)
):
    """Get current logged-in user's profile details"""
    return UserMeOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        username=user.username,
        platform_role=user.platform_role,
        is_active=user.is_active,
        avatar_url=user.avatar_url,
        created_at=user.created_at.isoformat() if user.created_at else None,
        auth_provider=user.auth_provider,
        theme_skin=user.theme_skin or "dark",
    )


@router.patch("/me/profile", response_model=UserMeOut)
def update_user_profile(
    body: UserProfileUpdate,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update user's full name and/or username. Requires current password confirmation."""
    if user.auth_provider != "google":
        if not body.current_password:
            raise HTTPException(status_code=400, detail="Current password is required")
        if not verify_password(body.current_password, user.password_hash):
            raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Update full_name if provided
    if body.full_name is not None:
        user.full_name = body.full_name.strip()

    # Update username if provided (check for uniqueness first)
    if body.username is not None:
        new_username = body.username.strip().lower()
        # Check if new username already exists (and it's not the user's current username)
        existing = db.query(User).filter(
            User.username == new_username,
            User.id != user.id
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already taken")
        user.username = new_username

    db.commit()
    db.refresh(user)

    log_event(
        db,
        "profile_updated",
        user.id,
        {
            "updated_full_name": body.full_name is not None,
            "updated_username": body.username is not None,
        },
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return UserMeOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        username=user.username,
        platform_role=user.platform_role,
        is_active=user.is_active,
        avatar_url=user.avatar_url,
        created_at=user.created_at.isoformat() if user.created_at else None,
        auth_provider=user.auth_provider,
        theme_skin=user.theme_skin or "dark",
    )


@router.patch("/me/theme", response_model=UserMeOut)
def update_user_theme(
    body: UserThemeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Save user's theme preference."""
    if body.theme_skin is not None:
        user.theme_skin = body.theme_skin
    db.commit()
    db.refresh(user)
    return UserMeOut(
        id=user.id,
        full_name=user.full_name,
        email=user.email,
        username=user.username,
        platform_role=user.platform_role,
        is_active=user.is_active,
        avatar_url=user.avatar_url,
        created_at=user.created_at.isoformat() if user.created_at else None,
        auth_provider=user.auth_provider,
        theme_skin=user.theme_skin or "dark",
    )


@router.patch("/me/password")
def change_password(
    body: UserPasswordChange,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Change user's password. Requires current password verification."""
    # Verify current password
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    # Hash and save new password
    user.password_hash = get_password_hash(body.new_password)

    # Invalidate all existing sessions — revoke all refresh tokens and bump token_version
    # so outstanding access tokens immediately fail the `ver` check in get_current_user
    db.query(RefreshToken).filter(RefreshToken.user_id == user.id).update({"revoked": True})
    user.token_version = (user.token_version or 1) + 1

    db.commit()

    log_event(
        db,
        "password_changed",
        user.id,
        {},
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {"detail": "Password changed successfully"}


@router.post("/me/avatar")
async def upload_avatar(
    request: Request,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Upload user avatar. File should be sent as multipart FormData."""
    if file.content_type not in ALLOWED_AVATAR_TYPES:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, WebP, and GIF images are allowed")

    contents = await file.read()
    if len(contents) > MAX_AVATAR_SIZE:
        raise HTTPException(status_code=400, detail="Avatar must be under 5 MB")

    if user.avatar_public_id:
        try:
            delete_asset(user.avatar_public_id)
        except Exception:
            pass

    result = upload_image(
        contents,
        folder="constructionsight/user-avatars",
        public_id=f"user_{user.id}_avatar",
    )

    user.avatar_url = result.get("secure_url") or result.get("url")
    user.avatar_public_id = result.get("public_id")
    db.commit()

    log_event(
        db,
        "avatar_uploaded",
        user.id,
        {"avatar_public_id": user.avatar_public_id, "has_avatar_url": bool(user.avatar_url)},
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {
        "avatar_url": user.avatar_url,
        "avatar_public_id": user.avatar_public_id,
        "detail": "Avatar uploaded successfully"
    }


@router.delete("/me/avatar")
def delete_avatar(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Remove user's avatar"""
    # Delete from Cloudinary if it exists
    if user.avatar_public_id:
        try:
            delete_asset(user.avatar_public_id, resource_type="image")
        except Exception:
            # Log but don't fail if deletion fails
            pass

    # Clear avatar URL and public ID
    user.avatar_url = None
    user.avatar_public_id = None
    db.commit()

    log_event(
        db,
        "avatar_deleted",
        user.id,
        {},
        request=request,
        target_type="user",
        target_id=user.id,
    )

    return {"detail": "Avatar removed successfully"}
