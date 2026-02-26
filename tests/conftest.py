"""
Root conftest.py — test database setup, session fixtures, and shared auth helpers.

IMPORTANT: Environment variables must be set BEFORE any app imports so that
config.py picks up the test DB URL instead of backend/.env values.
"""
# ---------------------------------------------------------------------------
# Register the PDF report plugin so it runs automatically on every session
# ---------------------------------------------------------------------------
pytest_plugins = ["tests.accessories.pytest_pdf_plugin"]

import os
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 1. Point Python at the backend package so `from app.xxx import ...` works
# ---------------------------------------------------------------------------
BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

# ---------------------------------------------------------------------------
# 2. Inject test environment variables BEFORE any app module is imported.
#    config.py uses load_dotenv(override=False), so values already in
#    os.environ win over backend/.env.
# ---------------------------------------------------------------------------
from cryptography.fernet import Fernet  # noqa: E402  (before app imports intentionally)

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/constructionsight_test")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret-key-minimum-32-characters-long!!")
os.environ.setdefault("JWT_ISSUER", "constructionsight-ai")
os.environ.setdefault("JWT_AUDIENCE", "constructionsight-client")
os.environ.setdefault("ACCESS_TOKEN_EXP_MINUTES", "30")
os.environ.setdefault("REFRESH_TOKEN_EXP_MINUTES", "10080")
os.environ.setdefault("CAMERA_ENCRYPTION_KEY", Fernet.generate_key().decode())
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("ENV", "development")
os.environ.setdefault("CAMERA_SCHEDULER_ENABLED", "false")
os.environ.setdefault("YOLO_CONFIG_DIR", str(Path(__file__).resolve().parent / "accessories" / "yolo_cfg"))

from tests.accessories.factories import BaseFactory

# ---------------------------------------------------------------------------
# 3. Now it is safe to import from the app
# ---------------------------------------------------------------------------
import pytest  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker, Session  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.core.db import Base, get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.core.security import get_password_hash, create_access_token  # noqa: E402
from app.models.user import User, PlatformRole  # noqa: E402
from app.models.token import RefreshToken  # noqa: E402
from app.models.site import Site  # noqa: E402
from app.models.project import Project, ProjectStatus  # noqa: E402

# ---------------------------------------------------------------------------
# 4. Test engine (points at constructionsight_test)
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = os.environ["DATABASE_URL"]

test_engine = create_engine(
    TEST_DATABASE_URL,
    pool_pre_ping=True,
    future=True,
)
TestSessionLocal = sessionmaker(bind=test_engine, autoflush=False, autocommit=False, future=True)

# ---------------------------------------------------------------------------
# 5. One-time schema setup (session-scoped)
# ---------------------------------------------------------------------------

def _create_enums(conn):
    """Create all PostgreSQL enum types used by the ORM models."""
    statements = [
        "DO $$ BEGIN CREATE TYPE violationtype AS ENUM ('no_helmet','no_vest'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
        "DO $$ BEGIN CREATE TYPE incidentstatus AS ENUM ('active','resolved'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platformrole') THEN
                CREATE TYPE platformrole AS ENUM ('admin','user');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projectstatus') THEN
                CREATE TYPE projectstatus AS ENUM ('draft','setup_in_progress','active','completed','archived');
            ELSE
                IF NOT EXISTS (SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid=pt.oid WHERE pt.typname='projectstatus' AND pe.enumlabel='completed') THEN
                    ALTER TYPE projectstatus ADD VALUE 'completed' BEFORE 'archived';
                END IF;
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projectrole') THEN
                CREATE TYPE projectrole AS ENUM ('project_manager','site_supervisor','safety_officer','data_analyst','stakeholder');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membershipstatus') THEN
                CREATE TYPE membershipstatus AS ENUM ('active','removed');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitationstatus') THEN
                CREATE TYPE invitationstatus AS ENUM ('pending','accepted','expired','cancelled');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registrystatus') THEN
                CREATE TYPE registrystatus AS ENUM ('draft','verifying','verified','verify_failed','archived');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'camerahealthstatus') THEN
                CREATE TYPE camerahealthstatus AS ENUM ('healthy','degraded','offline','maintenance');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ppeseverity') THEN
                CREATE TYPE ppeseverity AS ENUM ('low','medium','high');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ppeincidentstatus') THEN
                CREATE TYPE ppeincidentstatus AS ENUM ('open','acknowledged','resolved');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reportstatus') THEN
                CREATE TYPE reportstatus AS ENUM ('pending','completed','error');
            END IF;
        END $$;""",
        """DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reportfrequency') THEN
                CREATE TYPE reportfrequency AS ENUM ('daily','weekly','monthly');
            END IF;
        END $$;""",
    ]
    for sql in statements:
        conn.execute(text(sql))


@pytest.fixture(scope="session", autouse=True)
def setup_test_database():
    """Create all tables in constructionsight_test once per test session."""
    with test_engine.begin() as conn:
        _create_enums(conn)
    Base.metadata.create_all(bind=test_engine)
    yield
    # Leave schema intact so failures are inspectable; data is rolled back per test


# ---------------------------------------------------------------------------
# 6. Per-test DB session with transaction rollback
# ---------------------------------------------------------------------------

@pytest.fixture
def db(setup_test_database):
    """
    Yields a SQLAlchemy Session bound to a connection whose transaction is
    rolled back after the test, keeping the test DB clean between runs.
    """
    connection = test_engine.connect()
    transaction = connection.begin()
    session = TestSessionLocal(bind=connection)
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()


# ---------------------------------------------------------------------------
# 7. FastAPI TestClient with DB override
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def _wire_factory_session(db):
    def _all_subclasses(cls):
        subs = cls.__subclasses__()
        return subs + [s for sub in subs for s in _all_subclasses(sub)]

    factories = _all_subclasses(BaseFactory)
    for f in factories:
        f._meta.sqlalchemy_session = db
    yield
    for f in factories:
        f._meta.sqlalchemy_session = None


@pytest.fixture
def client(db):
    """TestClient with get_db overridden to use the rollback session."""
    def _override_get_db():
        yield db

    app.dependency_overrides[get_db] = _override_get_db
    # Do NOT use 'with TestClient(...) as c:' — that triggers on_startup() DDL
    # migrations for every test, causing deadlocks with open test transactions.
    c = TestClient(app, raise_server_exceptions=False)
    yield c
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# 8. Auth helper fixtures
# ---------------------------------------------------------------------------

CSRF_HEADERS = {"origin": "http://localhost:5173"}


def _make_user(db: Session, *, email: str, username: str, password: str = "TestPass123!",
               platform_role: PlatformRole = PlatformRole.USER,
               is_approved: bool = True, is_active: bool = True,
               token_version: int = 1) -> User:
    user = User(
        full_name="Test User",
        email=email,
        username=username,
        password_hash=get_password_hash(password),
        platform_role=platform_role,
        is_approved=is_approved,
        is_active=is_active,
        token_version=token_version,
    )
    db.add(user)
    db.flush()
    return user


def _token_for(user: User) -> str:
    return create_access_token(
        subject=str(user.id),
        platform_role=user.platform_role.value,
        token_version=user.token_version,
    )


def _auth_headers(user: User) -> dict:
    return {"Authorization": f"Bearer {_token_for(user)}"}


@pytest.fixture
def regular_user(db):
    """A standard approved, active user."""
    return _make_user(db, email="user@test.com", username="testuser")


@pytest.fixture
def admin_user(db):
    """An admin user."""
    return _make_user(db, email="admin@test.com", username="testadmin",
                      platform_role=PlatformRole.ADMIN, is_approved=True)


@pytest.fixture
def user_headers(regular_user):
    return _auth_headers(regular_user)


@pytest.fixture
def admin_headers(admin_user):
    return _auth_headers(admin_user)


@pytest.fixture
def unapproved_user(db):
    return _make_user(db, email="pending@test.com", username="pendinguser", is_approved=False)


@pytest.fixture
def inactive_user(db):
    return _make_user(db, email="inactive@test.com", username="inactiveuser", is_active=False)


# ---------------------------------------------------------------------------
# 9. Shared project / site helpers
# ---------------------------------------------------------------------------

def make_site(db: Session, *, name: str = "Test Site", location: str = "London", created_by: int) -> Site:
    site = Site(name=name, location=location, created_by=created_by)
    db.add(site)
    db.flush()
    return site


def make_project(db: Session, *, name: str = "Test Project", location: str = "London",
                 status: ProjectStatus = ProjectStatus.DRAFT, created_by: int,
                 site_id: int = None) -> Project:
    if site_id is None:
        site = make_site(db, name=name, location=location, created_by=created_by)
        site_id = site.id
    project = Project(
        name=name, location=location, status=status,
        created_by=created_by, site_id=site_id,
    )
    db.add(project)
    db.flush()
    return project
