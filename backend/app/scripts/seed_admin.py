"""
Seed/ensure an Administrator account for ConstructionSight AI.

Features:
- Deterministic: always targets the configured SEED_ADMIN_EMAIL/USERNAME.
- Idempotent: safe to run multiple times.
- Race-safe (Postgres): uses advisory lock to avoid double-seeding.
- Optional password reset via SEED_ADMIN_RESET_PASSWORD=1.
- Optional set "must_change_password" if your User model has that column (safe check).

ENV (recommended):
  SEED_ADMIN_FULL_NAME=System Administrator
  SEED_ADMIN_EMAIL=constructionsightai@gmail.com
  SEED_ADMIN_USERNAME=admin
  SEED_ADMIN_PASSWORD=<strong-password>
  SEED_ADMIN_RESET_PASSWORD=0
  SEED_ADMIN_FORCE_CHANGE=0   # only used if column exists
"""

import os
import sys
from contextlib import contextmanager

from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy import text

from app.core.db import engine
from app.models.user import User, PlatformRole
from app.core.security import get_password_hash


@contextmanager
def session_scope():
    Session = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _env_bool(key: str, default: str = "0") -> bool:
    return os.getenv(key, default).strip().lower() in ("1", "true", "yes", "y", "on")


def _has_attr(obj, attr: str) -> bool:
    return hasattr(obj, attr)


def _advisory_lock(session, lock_key: int = 91337721) -> None:
    """
    Postgres advisory lock (transaction-scoped).
    Prevents two processes seeding at the same time.
    """
    # If you're not on Postgres, this will fail; you can remove it.
    session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": lock_key})


def ensure_admin() -> int:
    full_name = os.getenv("SEED_ADMIN_FULL_NAME", "System Administrator").strip()
    email = (os.getenv("SEED_ADMIN_EMAIL") or "").strip().lower()
    username = (os.getenv("SEED_ADMIN_USERNAME") or "").strip()
    password = os.getenv("SEED_ADMIN_PASSWORD") or ""

    reset_password = _env_bool("SEED_ADMIN_RESET_PASSWORD", "0")
    force_change = _env_bool("SEED_ADMIN_FORCE_CHANGE", "0")

    if not email or not username or not password:
        print("❌ Missing env vars. Required: SEED_ADMIN_EMAIL, SEED_ADMIN_USERNAME, SEED_ADMIN_PASSWORD")
        return 2

    with session_scope() as session:
        # Race-safety
        _advisory_lock(session)

        # Deterministic target: find by email OR username
        target = (
            session.query(User).filter(User.email == email).first()
            or session.query(User).filter(User.username == username).first()
        )

        if target:
            changed = False

            # Ensure admin role
            if target.platform_role != PlatformRole.ADMIN:
                target.platform_role = PlatformRole.ADMIN
                changed = True
            if getattr(target, "is_approved", False) is not True:
                target.is_approved = True
                changed = True
            if getattr(target, "can_create_project", False) is not True:
                target.can_create_project = True
                changed = True

            # Ensure identity fields match config (optional but nice)
            # Only change if you want strict control; otherwise remove these lines.
            if target.email != email:
                target.email = email
                changed = True
            if target.username != username:
                target.username = username
                changed = True
            if target.full_name != full_name:
                target.full_name = full_name
                changed = True

            # Reset password only if explicitly asked
            if reset_password:
                target.password_hash = get_password_hash(password)
                changed = True

            # Optional: force change on next login (only if column exists)
            if force_change and _has_attr(target, "must_change_password"):
                setattr(target, "must_change_password", True)
                changed = True

            if changed:
                session.add(target)
                print("✅ Ensured seeded user is Admin (updated).")
            else:
                print("✅ Seeded Administrator already configured (no changes).")
            return 0

        # Create new seeded admin
        user = User(
            full_name=full_name,
            email=email,
            username=username,
            password_hash=get_password_hash(password),
            platform_role=PlatformRole.ADMIN,
            is_approved=True,
            can_create_project=True,
        )

        if force_change and _has_attr(user, "must_change_password"):
            setattr(user, "must_change_password", True)

        session.add(user)
        print("✅ Seeded Administrator created.")
        return 0


if __name__ == "__main__":
    try:
        code = ensure_admin()
        sys.exit(code)
    except IntegrityError as e:
        print("❌ IntegrityError while seeding admin (likely unique constraint conflict).")
        print(f"Details: {e}")
        sys.exit(3)
    except SQLAlchemyError as e:
        print("❌ Database error while seeding admin.")
        print(f"Details: {e}")
        sys.exit(4)
    except Exception as e:
        print("❌ Unexpected error while seeding admin.")
        print(f"Details: {e}")
        sys.exit(5)
