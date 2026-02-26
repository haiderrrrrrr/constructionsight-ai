import logging
import time
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

logger = logging.getLogger(__name__)

from .core.db import Base, engine
from .api.routes.auth import router as auth_router
from .api.routes.password_reset import router as password_reset_router
from .api.routes.admin_projects import router as admin_projects_router
from .api.routes.projects import router as projects_router
from .api.routes.invitations import router as invitations_router
from .api.routes.admin_invitations import router as admin_invitations_router
from .api.routes.admin_users import router as admin_users_router
from .api.routes.admin_sites import router as admin_sites_router
from .api.routes.admin_cameras import router as admin_cameras_router
from .api.routes.admin_notifications import router as admin_notifications_router
from .api.routes.users import router as users_router
from .api.routes.project_tasks import router as project_tasks_router
from .api.routes.notes import router as notes_router
from .api.routes.ml_stream_enterprise import router as ml_stream_router
from .api.routes.project_ppe import router as project_ppe_router
from .api.routes.user_notifications import router as user_notifications_router
from .api.routes.admin_ml_config import router as admin_ml_config_router
from .api.routes.project_features import router as project_features_router
from .api.routes.project_ml_config import router as project_ml_config_router
from .api.routes.project_reports import router as project_reports_router
from .api.routes.webhooks import router as webhooks_router
from .api.routes.project_workforce import router as project_workforce_router
from .api.routes.project_activity import router as project_activity_router
from .api.routes.project_equipment import router as project_equipment_router
from .api.routes.project_bim import router as project_bim_router
from .api.routes.project_risk import router as project_risk_router
from .api.routes.admin_risk import router as admin_risk_router
from .api.routes.smart_query import router as smart_query_router
from slowapi.errors import RateLimitExceeded
from .core.config import settings
from .core.limiter import limiter
from .services import camera_scheduler as sched
from sqlalchemy import text
# Import new models to ensure they're included in Base.metadata
from .models.project_camera import ProjectCamera  # noqa: F401
from .models.pinned_project import PinnedProject  # noqa: F401
from .models.project_settings import ProjectSettings  # noqa: F401
from .models.ml_config import MLConfig  # noqa: F401
from .models.ppe_incident import PpeIncident  # noqa: F401
from .models.project_camera_analytics import ProjectCameraAnalytics  # noqa: F401
from .models.project_report import ProjectReport  # noqa: F401
from .models.workforce_snapshot import WorkforceSnapshot  # noqa: F401
from .models.workforce_alert import WorkforceAlert  # noqa: F401
from .models.workforce_zone_settings import WorkforceZoneSettings  # noqa: F401
from .models.activity_snapshot import ActivitySnapshot  # noqa: F401
from .models.activity_alert import ActivityAlert  # noqa: F401
from .models.activity_zone_settings import ActivityZoneSettings  # noqa: F401
from .models.equipment_snapshot import EquipmentSnapshot  # noqa: F401
from .models.equipment_alert import EquipmentAlert  # noqa: F401
from .models.equipment_zone_settings import EquipmentZoneSettings  # noqa: F401
from .models.project_bim import ProjectBimConfig, BimZoneMapping  # noqa: F401
from .models.risk_snapshot import RiskSnapshot  # noqa: F401
from .models.risk_event import RiskEvent  # noqa: F401
from .models.risk_scheduler_config import RiskSchedulerConfig  # noqa: F401

app = FastAPI(title="ConstructionSight AI Backend", version="1.0")

app.state.limiter = limiter

# Handle rate limit exceeded errors with a simple 429 response
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(RateLimitExceeded)
def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        {"detail": "Too many attempts. Please wait a moment before trying again."},
        status_code=429,
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Create DB tables on startup
@app.on_event("startup")
async def on_startup():
    # ── Create PostgreSQL enums BEFORE create_all so ORM models that
    #    reference them (incidents.status, incidents.violation_type) are
    #    created with the correct column types.
    if engine.dialect.name == "postgresql":
        with engine.begin() as _pre:
            _pre.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE violationtype AS ENUM ('no_helmet', 'no_vest');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))
            _pre.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE incidentstatus AS ENUM ('active', 'resolved');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))

    Base.metadata.create_all(bind=engine)

    try:
        from .core.db import SessionLocal as _SL_risk
        from .services.risk.risk_scheduler import (
            load_config_from_db as _risk_load_cfg,
            start as _risk_start,
        )
        _rdb = _SL_risk()
        try:
            _rcfg = _risk_load_cfg(_rdb)
        finally:
            _rdb.close()
        _risk_iv = (_rcfg or {}).get("interval_seconds", 30)
        _risk_en = (_rcfg or {}).get("enabled", True)
        if _risk_en:
            _risk_start(_risk_iv)
    except Exception as _re:
        print(f"[main] risk_scheduler start failed: {_re}")

    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as conn:
        # refresh_tokens schema fixes
        conn.execute(text("ALTER TABLE IF EXISTS refresh_tokens ADD COLUMN IF NOT EXISTS remember BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE IF EXISTS refresh_tokens ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;"))

        # Ensure platformrole enum exists with correct lowercase values.
        # SQLAlchemy may have previously created it with uppercase member names
        # (ADMIN, USER) instead of lowercase values (admin, user). Fix that here.
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'platformrole') THEN
                    CREATE TYPE platformrole AS ENUM ('admin', 'user');
                ELSIF EXISTS (
                    SELECT 1 FROM pg_enum pe
                    JOIN pg_type pt ON pe.enumtypid = pt.oid
                    WHERE pt.typname = 'platformrole' AND pe.enumlabel = 'ADMIN'
                ) THEN
                    -- Wrong casing from a previous SQLAlchemy create_all run.
                    -- Safe to drop because platform_role column does not exist yet.
                    DROP TYPE platformrole;
                    CREATE TYPE platformrole AS ENUM ('admin', 'user');
                END IF;
            END $$;
        """))

        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS platform_role platformrole NOT NULL DEFAULT 'user';"))
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS can_create_project BOOLEAN NOT NULL DEFAULT FALSE;"))
        conn.execute(text("UPDATE users SET is_approved = TRUE, can_create_project = TRUE WHERE platform_role = 'admin';"))

        # Columns required by lockout and token-revocation logic —
        # create_all adds these on fresh DBs but not on existing ones
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 1;"))
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS failed_login_count INTEGER NOT NULL DEFAULT 0;"))
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ DEFAULT NULL;"))

        # auth_provider enum: local, google, hybrid
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'local';"))

        # Avatar columns for user profile pictures
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(500);"))
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS avatar_public_id VARCHAR(255);"))

        # Theme preference (per-user, stored on server) - single skin theme only
        conn.execute(text("ALTER TABLE IF EXISTS users ADD COLUMN IF NOT EXISTS theme_skin VARCHAR(10) DEFAULT 'dark';"))

        # ── projectstatus enum ───────────────────────────────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projectstatus') THEN
                    CREATE TYPE projectstatus AS ENUM ('draft','setup_in_progress','active','completed','archived');
                END IF;
            END $$;
        """))
        # Add 'completed' status if enum already exists (for existing databases)
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                    WHERE pt.typname = 'projectstatus' AND pe.enumlabel = 'completed'
                ) THEN
                    ALTER TYPE projectstatus ADD VALUE 'completed' BEFORE 'archived';
                END IF;
            END $$;
        """))

        # ── projectrole enum (create or ensure all 5 values exist) ─────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'projectrole') THEN
                    CREATE TYPE projectrole AS ENUM (
                        'project_manager','site_supervisor',
                        'safety_officer','data_analyst','stakeholder'
                    );
                ELSE
                    -- Ensure all 5 values exist regardless of what the pre-existing enum had
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'projectrole' AND pe.enumlabel = 'project_manager'
                    ) THEN
                        ALTER TYPE projectrole ADD VALUE 'project_manager';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'projectrole' AND pe.enumlabel = 'site_supervisor'
                    ) THEN
                        ALTER TYPE projectrole ADD VALUE 'site_supervisor';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'projectrole' AND pe.enumlabel = 'safety_officer'
                    ) THEN
                        ALTER TYPE projectrole ADD VALUE 'safety_officer';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'projectrole' AND pe.enumlabel = 'data_analyst'
                    ) THEN
                        ALTER TYPE projectrole ADD VALUE 'data_analyst';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'projectrole' AND pe.enumlabel = 'stakeholder'
                    ) THEN
                        ALTER TYPE projectrole ADD VALUE 'stakeholder';
                    END IF;
                END IF;
            END $$;
        """))

        # ── membershipstatus enum (active/removed only) ───────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membershipstatus') THEN
                    CREATE TYPE membershipstatus AS ENUM ('active','removed');
                ELSE
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'membershipstatus' AND pe.enumlabel = 'active'
                    ) THEN
                        ALTER TYPE membershipstatus ADD VALUE 'active';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'membershipstatus' AND pe.enumlabel = 'removed'
                    ) THEN
                        ALTER TYPE membershipstatus ADD VALUE 'removed';
                    END IF;
                END IF;
            END $$;
        """))

        # Normalize pre-existing uppercase membershipstatus values to lowercase
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                    WHERE pt.typname = 'membershipstatus' AND pe.enumlabel = 'active'
                ) AND EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'project_memberships' AND column_name = 'status'
                ) THEN
                    UPDATE project_memberships SET status = 'active'::membershipstatus WHERE status::text = 'ACTIVE';
                    UPDATE project_memberships SET status = 'removed'::membershipstatus WHERE status::text = 'REMOVED';
                END IF;
            END $$;
        """))

        # ── invitationstatus enum ─────────────────────────────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'invitationstatus') THEN
                    CREATE TYPE invitationstatus AS ENUM ('pending','accepted','expired','cancelled');
                ELSE
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'invitationstatus' AND pe.enumlabel = 'pending'
                    ) THEN
                        ALTER TYPE invitationstatus ADD VALUE 'pending';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'invitationstatus' AND pe.enumlabel = 'accepted'
                    ) THEN
                        ALTER TYPE invitationstatus ADD VALUE 'accepted';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'invitationstatus' AND pe.enumlabel = 'expired'
                    ) THEN
                        ALTER TYPE invitationstatus ADD VALUE 'expired';
                    END IF;
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_enum pe JOIN pg_type pt ON pe.enumtypid = pt.oid
                        WHERE pt.typname = 'invitationstatus' AND pe.enumlabel = 'cancelled'
                    ) THEN
                        ALTER TYPE invitationstatus ADD VALUE 'cancelled';
                    END IF;
                END IF;
            END $$;
        """))

        # ── projects table ────────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS projects (
                id SERIAL PRIMARY KEY,
                name VARCHAR(200) NOT NULL DEFAULT '',
                description VARCHAR(2000),
                location VARCHAR(300) NOT NULL DEFAULT '',
                client_name VARCHAR(200),
                start_date DATE,
                end_date DATE,
                status projectstatus NOT NULL DEFAULT 'draft',
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ
            );
        """))
        # ── Normalise projects columns (handle pre-existing tables with different names) ──
        # project_name → name
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='projects' AND column_name='project_name'
                ) THEN
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name='projects' AND column_name='name'
                    ) THEN
                        -- Both exist: copy data from old column then drop it
                        UPDATE projects SET name = project_name
                        WHERE (name IS NULL OR name = '') AND project_name IS NOT NULL;
                        ALTER TABLE projects DROP COLUMN project_name;
                    ELSE
                        ALTER TABLE projects RENAME COLUMN project_name TO name;
                    END IF;
                END IF;
            END $$;
        """))
        # Add any columns still missing after the rename above
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS name VARCHAR(200) NOT NULL DEFAULT '';"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS description VARCHAR(2000);"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS location VARCHAR(300) NOT NULL DEFAULT '';"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS client_name VARCHAR(200);"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS start_date DATE;"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS end_date DATE;"))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='projects' AND column_name='status'
                ) THEN
                    ALTER TABLE projects ADD COLUMN status projectstatus NOT NULL DEFAULT 'draft';
                END IF;
            END $$;
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='projects' AND column_name='created_by'
                ) THEN
                    ALTER TABLE projects ADD COLUMN created_by INTEGER REFERENCES users(id);
                END IF;
            END $$;
        """))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);"))
        conn.execute(text("ALTER TABLE projects ADD COLUMN IF NOT EXISTS logo_public_id VARCHAR(300);"))
        # ── site_id FK on projects (links project to its construction site) ────
        # sites table is created below in the on_startup block, but ALTER TABLE IF EXISTS
        # is safe to run even if sites table doesn't exist yet — Postgres will error,
        # so we guard with a DO block.
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'sites')
                AND NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'projects' AND column_name = 'site_id'
                ) THEN
                    ALTER TABLE projects ADD COLUMN site_id INTEGER REFERENCES sites(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """))

        # ── project_invitations: invited_name for non-registered invitees ─────
        conn.execute(text("ALTER TABLE project_invitations ADD COLUMN IF NOT EXISTS invited_name VARCHAR(255);"))

        # ── project_memberships: add FK + unique constraint ───────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='project_memberships'
                    AND constraint_name='fk_membership_project'
                ) THEN
                    ALTER TABLE project_memberships
                        ADD CONSTRAINT fk_membership_project
                        FOREIGN KEY (project_id) REFERENCES projects(id);
                END IF;
            END $$;
        """))
        # Drop old (user_id, project_id) unique constraint so one user can hold
        # multiple roles in the same project (enterprise multi-role support).
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='project_memberships'
                    AND constraint_name='uq_membership_user_project'
                ) THEN
                    ALTER TABLE project_memberships
                        DROP CONSTRAINT uq_membership_user_project;
                END IF;
            END $$;
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='project_memberships'
                    AND constraint_name='uq_membership_user_project_role'
                ) THEN
                    ALTER TABLE project_memberships
                        ADD CONSTRAINT uq_membership_user_project_role
                        UNIQUE (user_id, project_id, project_role);
                END IF;
            END $$;
        """))

        # ── Enforce single role per user per project (enterprise standard) ────
        # Remove duplicate memberships — keep highest id (most recently accepted role)
        conn.execute(text("""
            DELETE FROM project_memberships
            WHERE id NOT IN (
                SELECT MAX(id)
                FROM project_memberships
                GROUP BY user_id, project_id
            )
        """))
        # Drop old multi-role unique constraint and replace with single-role constraint
        conn.execute(text("""
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='project_memberships'
                    AND constraint_name='uq_membership_user_project_role'
                ) THEN
                    ALTER TABLE project_memberships
                        DROP CONSTRAINT uq_membership_user_project_role;
                END IF;
            END $$;
        """))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name='project_memberships'
                    AND constraint_name='uq_membership_user_project'
                ) THEN
                    ALTER TABLE project_memberships
                        ADD CONSTRAINT uq_membership_user_project
                        UNIQUE (user_id, project_id);
                END IF;
            END $$;
        """))

        # ── project_invitations table ─────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_invitations (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                role projectrole NOT NULL,
                token VARCHAR(128) UNIQUE NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                accepted_at TIMESTAMPTZ,
                invited_by INTEGER NOT NULL REFERENCES users(id),
                status invitationstatus NOT NULL DEFAULT 'pending',
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_project_invitations_email ON project_invitations(email);
            CREATE INDEX IF NOT EXISTS ix_project_invitations_token ON project_invitations(token);
            CREATE INDEX IF NOT EXISTS ix_project_invitations_project_id ON project_invitations(project_id);
        """))
        # Partial unique index: only one PENDING invitation allowed per (email, project_id, role)
        # Allows same user to be invited with different roles (multi-role support).
        conn.execute(text("""
            DO $$
            BEGIN
                -- Drop old index that blocked same email+project regardless of role
                DROP INDEX IF EXISTS uq_invite_pending_email_project;
            END $$;
        """))
        conn.execute(text("""
            CREATE UNIQUE INDEX IF NOT EXISTS uq_invite_pending_email_project_role
            ON project_invitations(email, project_id, role)
            WHERE status = 'pending';
        """))

        # ── registrystatus enum ───────────────────────────────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'registrystatus') THEN
                    CREATE TYPE registrystatus AS ENUM ('draft','verifying','verified','verify_failed','archived');
                END IF;
            END $$;
        """))

        # ── camerahealthstatus enum ───────────────────────────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'camerahealthstatus') THEN
                    CREATE TYPE camerahealthstatus AS ENUM ('healthy','degraded','offline','maintenance');
                END IF;
            END $$;
        """))

        # ── sites table ───────────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS sites (
                id SERIAL PRIMARY KEY,
                name VARCHAR(300) NOT NULL,
                location VARCHAR(500),
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_name ON sites(name);
        """))

        # ── cameras table ─────────────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS cameras (
                id SERIAL PRIMARY KEY,
                site_id INTEGER NOT NULL REFERENCES sites(id),
                name VARCHAR(200) NOT NULL,
                vendor VARCHAR(100),
                model VARCHAR(100),
                serial_number VARCHAR(200),
                onvif_supported BOOLEAN DEFAULT FALSE,
                connection_type VARCHAR(50) DEFAULT 'rtsp',
                created_by INTEGER NOT NULL REFERENCES users(id),
                registry_status registrystatus NOT NULL DEFAULT 'draft',
                verified_at TIMESTAMPTZ,
                last_health_check_at TIMESTAMPTZ,
                archived_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                logo_url VARCHAR(500),
                logo_public_id VARCHAR(300),
                CONSTRAINT uq_camera_serial_site UNIQUE (serial_number, site_id)
            );
        """))
        # Add logo columns to existing cameras tables
        conn.execute(text("ALTER TABLE IF EXISTS cameras ADD COLUMN IF NOT EXISTS logo_url VARCHAR(500);"))
        conn.execute(text("ALTER TABLE IF EXISTS cameras ADD COLUMN IF NOT EXISTS logo_public_id VARCHAR(300);"))

        # ── Add cascade delete to cameras.site_id FK ──────────────────────────
        # Drop existing FK if it doesn't have CASCADE and recreate with CASCADE
        conn.execute(text("""
            DO $$
            BEGIN
                -- Check if constraint exists without CASCADE
                IF EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE table_name = 'cameras' AND constraint_type = 'FOREIGN KEY'
                ) THEN
                    -- Drop the old FK constraint
                    ALTER TABLE cameras DROP CONSTRAINT cameras_site_id_fkey;
                    -- Recreate with CASCADE
                    ALTER TABLE cameras ADD CONSTRAINT cameras_site_id_fkey
                        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE;
                END IF;
            END $$;
        """))

        # ── camera_credentials table ──────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS camera_credentials (
                id SERIAL PRIMARY KEY,
                camera_id INTEGER NOT NULL UNIQUE REFERENCES cameras(id),
                rtsp_url_enc TEXT,
                rtsp_url_sub_enc TEXT,
                username_enc TEXT,
                password_enc TEXT,
                onvif_host_enc TEXT,
                onvif_port INTEGER,
                selected_stream_profile VARCHAR(100),
                transport_preference VARCHAR(10) DEFAULT 'tcp',
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                updated_by INTEGER REFERENCES users(id)
            );
        """))
        # Add sub-stream column to existing camera_credentials tables
        conn.execute(text(
            "ALTER TABLE IF EXISTS camera_credentials "
            "ADD COLUMN IF NOT EXISTS rtsp_url_sub_enc TEXT;"
        ))

        # ── camera_verifications table ────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS camera_verifications (
                id SERIAL PRIMARY KEY,
                camera_id INTEGER NOT NULL REFERENCES cameras(id),
                started_at TIMESTAMPTZ DEFAULT NOW(),
                completed_at TIMESTAMPTZ,
                result_status VARCHAR(50),
                failure_reason TEXT,
                preview_image_url VARCHAR(500),
                fps_detected FLOAT,
                resolution_detected VARCHAR(50),
                latency_ms FLOAT
            );
            CREATE INDEX IF NOT EXISTS ix_camera_verifications_camera_id ON camera_verifications(camera_id);
        """))
        conn.execute(text("ALTER TABLE IF EXISTS camera_verifications ADD COLUMN IF NOT EXISTS latency_ms FLOAT;"))

        # ── camera_health_logs table ──────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS camera_health_logs (
                id SERIAL PRIMARY KEY,
                camera_id INTEGER NOT NULL REFERENCES cameras(id),
                health_status camerahealthstatus NOT NULL,
                checked_at TIMESTAMPTZ DEFAULT NOW(),
                latency_ms FLOAT,
                message TEXT
            );
            CREATE INDEX IF NOT EXISTS ix_camera_health_logs_camera_id ON camera_health_logs(camera_id);
        """))
        conn.execute(text("ALTER TABLE IF EXISTS camera_health_logs DROP COLUMN IF EXISTS fps_observed;"))

        # ── zones table ───────────────────────────────────────────────────────
        # Site-level zoning is logical: one site can have multiple operational
        # zones (e.g. 'North Scaffold', 'Entry Checkpoint').
        # A dedicated site_zones reference table can be promoted to a source-of-truth
        # later if cross-camera zone standardization becomes necessary.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS zones (
                id SERIAL PRIMARY KEY,
                site_id INTEGER NOT NULL REFERENCES sites(id),
                name VARCHAR(200) NOT NULL,
                description VARCHAR(500),
                zone_type VARCHAR(100),
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_zone_site_name UNIQUE (site_id, name)
            );
            CREATE INDEX IF NOT EXISTS ix_zones_site_id ON zones(site_id);
        """))

        # ── audit_logs table (replaces auth_events reuse for lifecycle events) ──
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(200) NOT NULL,
                target_type VARCHAR(100),
                target_id INTEGER,
                metadata JSONB,
                ip_address VARCHAR(45),
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_audit_logs_actor_id ON audit_logs(actor_id);
            CREATE INDEX IF NOT EXISTS ix_audit_logs_action ON audit_logs(action);
            CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at DESC);
        """))

        # ── project_cameras join table (Phase 1: DB structure only) ──────────
        # Phase 2: add API endpoints + wire CameraTable "Assigned" column
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_cameras (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                assigned_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_project_camera UNIQUE (project_id, camera_id)
            );
            CREATE INDEX IF NOT EXISTS ix_project_cameras_project_id ON project_cameras(project_id);
            CREATE INDEX IF NOT EXISTS ix_project_cameras_camera_id ON project_cameras(camera_id);
        """))

        # ── add zone_id to project_cameras (was missing from original DDL) ───────────
        conn.execute(text("""
            ALTER TABLE project_cameras
            ADD COLUMN IF NOT EXISTS zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;
        """))

        # ── notifications table ───────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(100) NOT NULL,
                title VARCHAR(300) NOT NULL,
                message TEXT NOT NULL,
                camera_id INTEGER REFERENCES cameras(id) ON DELETE CASCADE,
                is_read BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_notifications_user_id ON notifications(user_id);
            CREATE INDEX IF NOT EXISTS ix_notifications_is_read ON notifications(user_id, is_read);
        """))

        # ── camera_zone_polygons table ────────────────────────────────────────
        # Camera-specific zone polygons — the visual mapping of a site zone onto
        # a camera frame. Architectural rules:
        #   · One camera can have multiple active polygons (one per zone it covers).
        #   · Different cameras in the same site may cover different zone subsets.
        #   · Two cameras may define separate polygons for the same real-world zone.
        #   · Editing a polygon on one camera never affects other cameras' polygons.
        #   · Together, all active polygons for a camera represent the portions of
        #     the site visible in that camera's feed.
        # points: JSON array [{x, y}] normalised to [0, 1] of frame dimensions.
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS camera_zone_polygons (
                id SERIAL PRIMARY KEY,
                camera_id INTEGER NOT NULL REFERENCES cameras(id),
                zone_id INTEGER NOT NULL REFERENCES zones(id),
                points TEXT,
                label VARCHAR(200),
                zone_category VARCHAR(100),
                is_active INTEGER NOT NULL DEFAULT 1,
                version INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER NOT NULL REFERENCES users(id),
                updated_by INTEGER REFERENCES users(id),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_czp_camera_id ON camera_zone_polygons(camera_id);
            CREATE INDEX IF NOT EXISTS ix_czp_zone_id ON camera_zone_polygons(zone_id);
        """))

        # Scheduler config table (persistent configuration)
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS scheduler_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                enabled BOOLEAN DEFAULT TRUE,
                interval_minutes INTEGER DEFAULT 5,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );

            -- Seed initial row if none exists
            INSERT INTO scheduler_config (id, enabled, interval_minutes)
            SELECT 1, true, 5
            WHERE NOT EXISTS (SELECT 1 FROM scheduler_config);
        """))

        # ── Risk Analytics tables ─────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risk_snapshots (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                camera_id INTEGER REFERENCES cameras(id),
                zone_id INTEGER REFERENCES zones(id),
                zone_name VARCHAR(255),
                recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                delay_risk FLOAT NOT NULL DEFAULT 0,
                safety_risk FLOAT NOT NULL DEFAULT 0,
                productivity_risk FLOAT NOT NULL DEFAULT 0,
                overall_risk FLOAT NOT NULL DEFAULT 0,
                risk_level VARCHAR(20) NOT NULL DEFAULT 'low',
                trend VARCHAR(20) NOT NULL DEFAULT 'stable',
                momentum FLOAT NOT NULL DEFAULT 0,
                factors_json TEXT,
                prediction_risk FLOAT,
                prediction_window_minutes INTEGER,
                compound_risk_flag BOOLEAN NOT NULL DEFAULT FALSE,
                weather_condition VARCHAR(50),
                weather_temp FLOAT,
                weather_wind FLOAT,
                weather_rain FLOAT
            );
            CREATE INDEX IF NOT EXISTS ix_risk_snapshots_project_time ON risk_snapshots(project_id, recorded_at DESC);
            CREATE INDEX IF NOT EXISTS ix_risk_snapshots_zone_time ON risk_snapshots(zone_id, recorded_at DESC);
            CREATE INDEX IF NOT EXISTS ix_risk_snapshots_camera_time ON risk_snapshots(camera_id, recorded_at DESC);
            CREATE INDEX IF NOT EXISTS ix_risk_snapshots_project_camera ON risk_snapshots(project_id, camera_id, recorded_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risk_events (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                camera_id INTEGER REFERENCES cameras(id),
                zone_id INTEGER REFERENCES zones(id),
                zone_name VARCHAR(255),
                event_type VARCHAR(50) NOT NULL,
                severity VARCHAR(20) NOT NULL DEFAULT 'medium',
                message TEXT,
                risk_score FLOAT,
                previous_risk_score FLOAT,
                triggered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
                acknowledged_at TIMESTAMP WITH TIME ZONE,
                acknowledged_by INTEGER REFERENCES users(id),
                status VARCHAR(20) NOT NULL DEFAULT 'open'
            );
            CREATE INDEX IF NOT EXISTS ix_risk_events_project_time ON risk_events(project_id, triggered_at DESC);
            CREATE INDEX IF NOT EXISTS ix_risk_events_project_status ON risk_events(project_id, status);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS risk_scheduler_config (
                id INTEGER PRIMARY KEY DEFAULT 1,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                interval_seconds INTEGER NOT NULL DEFAULT 30,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            INSERT INTO risk_scheduler_config (id, enabled, interval_seconds)
            SELECT 1, true, 30
            WHERE NOT EXISTS (SELECT 1 FROM risk_scheduler_config);
        """))

        # ── password_reset_otps table ──────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                email VARCHAR(255) NOT NULL,
                otp_hash VARCHAR(128) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                attempt_count INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_password_reset_otps_user_id ON password_reset_otps(user_id);
        """))
        # Add email column to existing table if it doesn't exist
        conn.execute(text("ALTER TABLE IF EXISTS password_reset_otps ADD COLUMN IF NOT EXISTS email VARCHAR(255);"))

        # ── password_reset_sessions table ──────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS password_reset_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash VARCHAR(128) NOT NULL,
                expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                used BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_password_reset_sessions_user_id ON password_reset_sessions(user_id);
        """))

        # ── project_cameras zone_id migration ──────────────────────────────────────
        # (table created earlier with initial DDL; zone_id added via ALTER TABLE above)

        # ── pinned_projects table (PM pin feature) ─────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS pinned_projects (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                pinned_at TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_pinned_user_project UNIQUE (user_id, project_id)
            );
            CREATE INDEX IF NOT EXISTS ix_pinned_projects_user_id ON pinned_projects(user_id);
        """))

        # ── project_settings table (project config: alerts, report frequency) ───
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_settings (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
                alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE,
                report_frequency VARCHAR(20) NOT NULL DEFAULT 'weekly',
                updated_by INTEGER REFERENCES users(id),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            );
        """))

        conn.execute(text("ALTER TABLE project_settings ADD COLUMN IF NOT EXISTS reports_scheduler_enabled BOOLEAN NOT NULL DEFAULT TRUE;"))

        # ── project_tasks table ───────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_tasks (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                title VARCHAR(500) NOT NULL,
                description TEXT,
                is_done BOOLEAN NOT NULL DEFAULT FALSE,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                done_at TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS ix_project_tasks_project_id ON project_tasks(project_id);
        """))

        # ── PPE: ppe_incidents table ──────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ppe_incidents (
                id                SERIAL PRIMARY KEY,
                project_id        INTEGER NOT NULL REFERENCES projects(id),
                camera_id         INTEGER NOT NULL REFERENCES cameras(id),
                zone_id           INTEGER REFERENCES zones(id),
                zone_name         VARCHAR(255),
                track_id          INTEGER,
                global_person_id  INTEGER,
                incident_type     VARCHAR(50) NOT NULL,
                started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                ended_at          TIMESTAMPTZ,
                severity          VARCHAR(20) NOT NULL DEFAULT 'medium',
                status            VARCHAR(20) NOT NULL DEFAULT 'open',
                snapshot_url      TEXT,
                video_clip_url    TEXT,
                frame_confidence  FLOAT,
                created_at        TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS idx_ppe_incidents_project ON ppe_incidents(project_id);
            CREATE INDEX IF NOT EXISTS idx_ppe_incidents_camera  ON ppe_incidents(camera_id);
            CREATE INDEX IF NOT EXISTS idx_ppe_incidents_started ON ppe_incidents(started_at DESC);
        """))

        # ── PPE: project_camera_analytics table ──────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_camera_analytics (
                id                        SERIAL PRIMARY KEY,
                project_camera_id         INTEGER UNIQUE NOT NULL REFERENCES project_cameras(id) ON DELETE CASCADE,
                ppe_enabled               BOOLEAN NOT NULL DEFAULT TRUE,
                activity_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
                equipment_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
                inference_events_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
                updated_at                TIMESTAMPTZ DEFAULT NOW()
            );
        """))

        # ── PPE: workforce_enabled column (added after initial table creation) ──
        conn.execute(text(
            "ALTER TABLE project_camera_analytics "
            "ADD COLUMN IF NOT EXISTS workforce_enabled BOOLEAN NOT NULL DEFAULT FALSE;"
        ))

        # ── PPE: ppe_enabled_at — server-side live session start timestamp ──────
        conn.execute(text(
            "ALTER TABLE project_camera_analytics "
            "ADD COLUMN IF NOT EXISTS ppe_enabled_at TIMESTAMPTZ;"
        ))

        # ── Workforce: workforce_enabled_at — server-side live session start timestamp ──
        conn.execute(text(
            "ALTER TABLE project_camera_analytics "
            "ADD COLUMN IF NOT EXISTS workforce_enabled_at TIMESTAMPTZ;"
        ))

        # ── PPE: Project-specific ML config (per-project settings) ──────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_ml_config (
                id                        SERIAL PRIMARY KEY,
                project_id                INTEGER UNIQUE NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                alert_cooldown_frames     INTEGER DEFAULT 90,
                violation_frames          INTEGER DEFAULT 8,
                incident_dedup_seconds    INTEGER DEFAULT 30,
                stage1_conf               FLOAT DEFAULT 0.25,
                stage2_conf               FLOAT DEFAULT 0.30,
                created_at                TIMESTAMPTZ DEFAULT NOW(),
                updated_at                TIMESTAMPTZ DEFAULT NOW(),
                updated_by                INTEGER REFERENCES users(id)
            );
        """))

        # ── PPE: confirm_frames column (state machine compliance confirmation) ─
        conn.execute(text("ALTER TABLE project_ml_config ADD COLUMN IF NOT EXISTS confirm_frames INTEGER DEFAULT 5;"))

        # ── PPE: lost_frames column (ByteTrack person loss timeout) ───────────
        conn.execute(text("ALTER TABLE project_ml_config ADD COLUMN IF NOT EXISTS lost_frames INTEGER DEFAULT 30;"))

        # ── PPE: reid_enabled column (enable/disable cross-camera re-id) ─────
        conn.execute(text("ALTER TABLE project_ml_config ADD COLUMN IF NOT EXISTS reid_enabled BOOLEAN DEFAULT TRUE;"))

        # ── PPE: worker tracking columns on cameras ───────────────────────────
        conn.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS worker_status VARCHAR(20) DEFAULT 'idle';"))
        conn.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS last_inference_at TIMESTAMPTZ;"))
        conn.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS worker_error TEXT;"))
        conn.execute(text("ALTER TABLE cameras ADD COLUMN IF NOT EXISTS runtime_status JSONB DEFAULT NULL;"))

        # ── PPE: auto-task columns on project_tasks ───────────────────────────
        conn.execute(text("ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT FALSE;"))
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='project_tasks' AND column_name='source_incident_id'
                ) THEN
                    ALTER TABLE project_tasks
                        ADD COLUMN source_incident_id INTEGER REFERENCES ppe_incidents(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """))
        conn.execute(text("ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS assigned_role VARCHAR(50);"))

        # ── MLConfig: incident dedup window ───────────────────────────────────
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS incident_dedup_seconds INTEGER NOT NULL DEFAULT 30;"))

        # ── MLConfig: ReID quality + persistence keys ──────────────────────────
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_assign_thresh FLOAT DEFAULT 0.86;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_match_thresh FLOAT DEFAULT 0.72;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_min_pending_frames INTEGER DEFAULT 8;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_quality_min FLOAT DEFAULT 0.65;"))
        # Migrate existing rows that still have the old loose thresholds
        conn.execute(text("UPDATE ml_config SET reid_assign_thresh = 0.86 WHERE reid_assign_thresh <= 0.82;"))
        conn.execute(text("UPDATE ml_config SET reid_match_thresh = 0.72 WHERE reid_match_thresh <= 0.68;"))
        conn.execute(text("UPDATE ml_config SET reid_min_pending_frames = 8 WHERE reid_min_pending_frames < 8;"))
        conn.execute(text("UPDATE ml_config SET reid_quality_min = 0.65 WHERE reid_quality_min < 0.65;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_identity_top_k INTEGER DEFAULT 5;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_min_trusted_embeddings INTEGER DEFAULT 2;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_max_gallery_size INTEGER DEFAULT 500;"))
        conn.execute(text("ALTER TABLE ml_config ADD COLUMN IF NOT EXISTS reid_persist_state_max_age_s INTEGER DEFAULT 300;"))

        # ── PPE incidents: explicit helmet/vest booleans ──────────────────────
        conn.execute(text("ALTER TABLE ppe_incidents ADD COLUMN IF NOT EXISTS has_helmet BOOLEAN;"))
        conn.execute(text("ALTER TABLE ppe_incidents ADD COLUMN IF NOT EXISTS has_vest BOOLEAN;"))
        conn.execute(text("ALTER TABLE ppe_incidents ALTER COLUMN camera_id DROP NOT NULL;"))
        # Fix existing analytics rows that have inference_events_enabled=False (default was wrong)
        conn.execute(text("""
            UPDATE project_camera_analytics
            SET inference_events_enabled = TRUE
            WHERE inference_events_enabled = FALSE
        """))
        # Allow camera_id to be NULL on all analytics/alert tables so history survives camera deletion
        conn.execute(text("ALTER TABLE activity_snapshots ALTER COLUMN camera_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE activity_alerts ALTER COLUMN camera_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE workforce_snapshots ALTER COLUMN camera_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE workforce_alerts ALTER COLUMN camera_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE equipment_snapshots ALTER COLUMN camera_id DROP NOT NULL;"))
        conn.execute(text("ALTER TABLE equipment_alerts ALTER COLUMN camera_id DROP NOT NULL;"))

        # ── PPE: project_id on notifications ─────────────────────────────────
        conn.execute(text("""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='notifications' AND column_name='project_id'
                ) THEN
                    ALTER TABLE notifications
                        ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
                END IF;
            END $$;
        """))

        # ── project_reports table ─────────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_reports (
                id                   SERIAL PRIMARY KEY,
                project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                report_type          VARCHAR(50) NOT NULL DEFAULT 'ppe',
                period_label         VARCHAR(50),
                period_start         TIMESTAMPTZ NOT NULL,
                period_end           TIMESTAMPTZ NOT NULL,
                frequency            VARCHAR(20) NOT NULL DEFAULT 'weekly',
                status               VARCHAR(30) NOT NULL DEFAULT 'pending',
                file_path            TEXT,
                error_message        TEXT,
                recipient_count      INTEGER DEFAULT 0,
                triggered_by         VARCHAR(20) DEFAULT 'scheduled',
                triggered_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at           TIMESTAMPTZ DEFAULT NOW(),
                generated_at         TIMESTAMPTZ,
                emailed_at           TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_project_reports_project_id ON project_reports(project_id);
            CREATE INDEX IF NOT EXISTS idx_project_reports_status ON project_reports(status);
        """))

        # ── report_recipients table (audit trail: who was emailed per report) ─
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS report_recipients (
                id           SERIAL PRIMARY KEY,
                report_id    INTEGER NOT NULL REFERENCES project_reports(id) ON DELETE CASCADE,
                user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
                email        VARCHAR(255) NOT NULL,
                full_name    VARCHAR(255),
                role         VARCHAR(50),
                delivered    BOOLEAN DEFAULT TRUE,
                delivered_at TIMESTAMPTZ
            );
            CREATE INDEX IF NOT EXISTS idx_report_recipients_report_id ON report_recipients(report_id);
        """))

        # ── Cloudinary columns for project_reports ────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS project_reports ADD COLUMN IF NOT EXISTS cloudinary_url TEXT;"))
        conn.execute(text("ALTER TABLE IF EXISTS project_reports ADD COLUMN IF NOT EXISTS cloudinary_public_id TEXT;"))

        # ── Workforce Analytics: new tables ───────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workforce_snapshots (
                id                SERIAL PRIMARY KEY,
                project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id         INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id           INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name         VARCHAR(255),
                recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                trigger           VARCHAR(20) DEFAULT 'interval',
                worker_count      INTEGER NOT NULL DEFAULT 0,
                active_count      INTEGER NOT NULL DEFAULT 0,
                idle_count        INTEGER NOT NULL DEFAULT 0,
                utilization_score FLOAT NOT NULL DEFAULT 0.0,
                zone_status       VARCHAR(20) NOT NULL DEFAULT 'BALANCED',
                congestion_flag   BOOLEAN NOT NULL DEFAULT FALSE,
                avg_dwell_seconds FLOAT,
                sparkline_json    TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_wf_snapshots_project ON workforce_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_wf_snapshots_camera  ON workforce_snapshots(camera_id);
            CREATE INDEX IF NOT EXISTS idx_wf_snapshots_time    ON workforce_snapshots(recorded_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workforce_alerts (
                id              SERIAL PRIMARY KEY,
                project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id       INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id         INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name       VARCHAR(255),
                alert_type      VARCHAR(50) NOT NULL,
                severity        VARCHAR(20) NOT NULL DEFAULT 'medium',
                message         TEXT,
                triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
                acknowledged_at TIMESTAMPTZ,
                acknowledged_by INTEGER REFERENCES users(id)
            );
            CREATE INDEX IF NOT EXISTS idx_wf_alerts_project ON workforce_alerts(project_id);
            CREATE INDEX IF NOT EXISTS idx_wf_alerts_time    ON workforce_alerts(triggered_at DESC);
        """))
        conn.execute(text("ALTER TABLE workforce_alerts ADD COLUMN IF NOT EXISTS snapshot_url TEXT;"))
        conn.execute(text("ALTER TABLE workforce_alerts ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open';"))
        conn.execute(text("ALTER TABLE workforce_alerts ADD COLUMN IF NOT EXISTS worker_id INTEGER;"))

        # ── Workforce Analytics: ml_config columns ────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_movement_thresh FLOAT DEFAULT 8.0;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_idle_time_seconds INTEGER DEFAULT 30;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_lost_frames INTEGER DEFAULT 20;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_confirm_frames INTEGER DEFAULT 8;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_understaffed_threshold INTEGER DEFAULT 2;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_overloaded_threshold INTEGER DEFAULT 15;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_snapshot_interval_secs INTEGER DEFAULT 60;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_alert_cooldown_secs INTEGER DEFAULT 600;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_reconcile_distance_px INTEGER DEFAULT 120;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_reconcile_window_secs INTEGER DEFAULT 6;"))
        # Update existing rows to new defaults (idempotent — only changes if still at old value)
        conn.execute(text("UPDATE ml_config SET workforce_lost_frames = 20 WHERE workforce_lost_frames = 45;"))
        conn.execute(text("UPDATE ml_config SET workforce_reconcile_distance_px = 120 WHERE workforce_reconcile_distance_px = 80;"))
        conn.execute(text("UPDATE ml_config SET workforce_reconcile_window_secs = 6 WHERE workforce_reconcile_window_secs = 4;"))

        # ── Workforce Analytics: new config columns ────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_idle_alert_threshold INTEGER DEFAULT 60;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS workforce_idle_reactivation_thresh FLOAT DEFAULT 15.0;"))

        # ── PM per-zone workforce settings ────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS workforce_zone_settings (
                id                    SERIAL PRIMARY KEY,
                project_id            INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id             INTEGER REFERENCES cameras(id) ON DELETE CASCADE,
                required_workers      INTEGER NOT NULL DEFAULT 2,
                max_workers           INTEGER NOT NULL DEFAULT 15,
                idle_alert_threshold  INTEGER NOT NULL DEFAULT 60,
                alert_sensitivity     VARCHAR(10) NOT NULL DEFAULT 'medium',
                operating_hours_start TIME,
                operating_hours_end   TIME,
                confirm_frames        INTEGER NOT NULL DEFAULT 8,
                idle_time_seconds     INTEGER NOT NULL DEFAULT 30,
                updated_at            TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_zone_settings_unique
                ON workforce_zone_settings(project_id, COALESCE(camera_id, -1));
            CREATE INDEX IF NOT EXISTS idx_wf_zone_settings_project
                ON workforce_zone_settings(project_id);
        """))
        conn.execute(text("""
            ALTER TABLE IF EXISTS workforce_zone_settings
                ADD COLUMN IF NOT EXISTS understaffed_confirm_samples INTEGER NOT NULL DEFAULT 30,
                ADD COLUMN IF NOT EXISTS overload_confirm_seconds     INTEGER NOT NULL DEFAULT 180,
                ADD COLUMN IF NOT EXISTS pre_demo_snapshot            TEXT;
        """))

        # ── Activity / Idle Monitoring: new tables ────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS activity_snapshots (
                id                        SERIAL PRIMARY KEY,
                project_id                INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id                 INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id                   INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name                 VARCHAR(255),
                recorded_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                trigger                   VARCHAR(20) DEFAULT 'interval',
                zone_state                VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
                moving_count              INTEGER NOT NULL DEFAULT 0,
                stationary_count          INTEGER NOT NULL DEFAULT 0,
                idle_count                INTEGER NOT NULL DEFAULT 0,
                total_count               INTEGER NOT NULL DEFAULT 0,
                motion_intensity_score    FLOAT NOT NULL DEFAULT 0.0,
                activity_score            INTEGER NOT NULL DEFAULT 0,
                active_minutes_today      INTEGER NOT NULL DEFAULT 0,
                idle_minutes_today        INTEGER NOT NULL DEFAULT 0,
                low_activity_minutes_today INTEGER NOT NULL DEFAULT 0,
                idle_duration_seconds     FLOAT,
                longest_idle_seconds      FLOAT,
                sparkline_json            TEXT,
                optical_flow_score        FLOAT
            );
            CREATE INDEX IF NOT EXISTS idx_act_snapshots_project ON activity_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_act_snapshots_camera  ON activity_snapshots(camera_id);
            CREATE INDEX IF NOT EXISTS idx_act_snapshots_time    ON activity_snapshots(project_id, recorded_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS activity_alerts (
                id              SERIAL PRIMARY KEY,
                project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id       INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id         INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name       VARCHAR(255),
                alert_type      VARCHAR(50) NOT NULL,
                severity        VARCHAR(20) NOT NULL DEFAULT 'medium',
                message         TEXT,
                triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                acknowledged    BOOLEAN NOT NULL DEFAULT FALSE,
                acknowledged_at TIMESTAMPTZ,
                acknowledged_by INTEGER REFERENCES users(id),
                snapshot_url    TEXT,
                status          VARCHAR(20) NOT NULL DEFAULT 'open'
            );
            CREATE INDEX IF NOT EXISTS idx_act_alerts_project ON activity_alerts(project_id);
            CREATE INDEX IF NOT EXISTS idx_act_alerts_time    ON activity_alerts(triggered_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS activity_zone_settings (
                id                      SERIAL PRIMARY KEY,
                project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id               INTEGER REFERENCES cameras(id) ON DELETE CASCADE,
                idle_threshold_seconds  INTEGER NOT NULL DEFAULT 300,
                alert_idle_minutes      INTEGER NOT NULL DEFAULT 15,
                low_activity_threshold  INTEGER NOT NULL DEFAULT 30,
                movement_thresh_px      FLOAT NOT NULL DEFAULT 6.0,
                stationary_thresh_secs  INTEGER NOT NULL DEFAULT 20,
                alert_sensitivity       VARCHAR(10) NOT NULL DEFAULT 'medium',
                optical_flow_weight     FLOAT NOT NULL DEFAULT 0.2,
                operating_hours_start   TIME,
                operating_hours_end     TIME,
                updated_at              TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_act_zone_settings_unique
                ON activity_zone_settings(project_id, COALESCE(camera_id, -1));
            CREATE INDEX IF NOT EXISTS idx_act_zone_settings_project
                ON activity_zone_settings(project_id);
        """))

        # ── Activity zone settings: new confirm/sustained columns ────────────
        conn.execute(text("ALTER TABLE IF EXISTS activity_zone_settings ADD COLUMN IF NOT EXISTS zone_idle_confirm_cycles INTEGER NOT NULL DEFAULT 3;"))
        conn.execute(text("ALTER TABLE IF EXISTS activity_zone_settings ADD COLUMN IF NOT EXISTS low_activity_sustained_minutes INTEGER NOT NULL DEFAULT 30;"))

        # ── Activity: ml_config columns ───────────────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_movement_thresh_px FLOAT DEFAULT 6.0;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_idle_threshold_seconds INTEGER DEFAULT 300;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_alert_idle_minutes INTEGER DEFAULT 15;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_low_activity_threshold INTEGER DEFAULT 30;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_stationary_thresh_secs INTEGER DEFAULT 20;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_optical_flow_weight FLOAT DEFAULT 0.2;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_lost_frames INTEGER DEFAULT 25;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_confirm_frames INTEGER DEFAULT 6;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_reconcile_distance_px INTEGER DEFAULT 100;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_reconcile_window_secs INTEGER DEFAULT 5;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_snapshot_interval_secs INTEGER DEFAULT 60;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_alert_cooldown_secs INTEGER DEFAULT 600;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS activity_flow_every_n_frames INTEGER DEFAULT 10;"))

        # ── Equipment Usage: new tables ────────────────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS equipment_snapshots (
                id                   SERIAL PRIMARY KEY,
                project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id            INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id              INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name            VARCHAR(255),
                recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                trigger              VARCHAR(50),
                active_count         INTEGER NOT NULL DEFAULT 0,
                idle_count           INTEGER NOT NULL DEFAULT 0,
                total_count          INTEGER NOT NULL DEFAULT 0,
                utilization_score    INTEGER NOT NULL DEFAULT 0,
                idle_ratio           FLOAT NOT NULL DEFAULT 0.0,
                avg_active_duration  FLOAT,
                zone_status          VARCHAR(50) NOT NULL DEFAULT 'BALANCED',
                cross_zone_conflicts INTEGER NOT NULL DEFAULT 0,
                misuse_flags_json    TEXT,
                sparkline_json       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_eq_snapshots_project ON equipment_snapshots(project_id);
            CREATE INDEX IF NOT EXISTS idx_eq_snapshots_camera  ON equipment_snapshots(camera_id);
            CREATE INDEX IF NOT EXISTS idx_eq_snapshots_time    ON equipment_snapshots(recorded_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS equipment_alerts (
                id               SERIAL PRIMARY KEY,
                project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id        INTEGER NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
                zone_id          INTEGER REFERENCES zones(id) ON DELETE SET NULL,
                zone_name        VARCHAR(255),
                alert_type       VARCHAR(100) NOT NULL,
                severity         VARCHAR(50) NOT NULL DEFAULT 'medium',
                message          TEXT,
                equipment_type   VARCHAR(100),
                track_id         INTEGER,
                triggered_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                acknowledged     BOOLEAN NOT NULL DEFAULT FALSE,
                acknowledged_at  TIMESTAMPTZ,
                acknowledged_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
                snapshot_url     TEXT,
                status           VARCHAR(20) NOT NULL DEFAULT 'open'
            );
            CREATE INDEX IF NOT EXISTS idx_eq_alerts_project  ON equipment_alerts(project_id);
            CREATE INDEX IF NOT EXISTS idx_eq_alerts_camera   ON equipment_alerts(camera_id);
            CREATE INDEX IF NOT EXISTS idx_eq_alerts_time     ON equipment_alerts(triggered_at DESC);
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS equipment_zone_settings (
                id                           SERIAL PRIMARY KEY,
                project_id                   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                camera_id                    INTEGER REFERENCES cameras(id) ON DELETE CASCADE,
                expected_equipment_count     INTEGER NOT NULL DEFAULT 2,
                max_equipment_count          INTEGER NOT NULL DEFAULT 10,
                idle_alert_threshold_minutes INTEGER NOT NULL DEFAULT 30,
                overuse_threshold_hours      FLOAT NOT NULL DEFAULT 8.0,
                min_workers_alongside        INTEGER NOT NULL DEFAULT 2,
                alert_sensitivity            VARCHAR(10) NOT NULL DEFAULT 'medium',
                confirm_frames               INTEGER NOT NULL DEFAULT 8,
                pre_demo_snapshot            TEXT,
                updated_at                   TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_eq_zone_settings_unique
                ON equipment_zone_settings(project_id, COALESCE(camera_id, -1));
            CREATE INDEX IF NOT EXISTS idx_eq_zone_settings_project
                ON equipment_zone_settings(project_id);
        """))

        # ── Equipment: ml_config columns ──────────────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_enabled BOOLEAN DEFAULT FALSE;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_stage1_conf FLOAT DEFAULT 0.35;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_movement_thresh FLOAT DEFAULT 3.0;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_idle_confirm_secs INTEGER DEFAULT 30;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_lost_frames INTEGER DEFAULT 25;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_snapshot_interval_secs INTEGER DEFAULT 60;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_alert_cooldown_secs INTEGER DEFAULT 600;"))
        conn.execute(text("ALTER TABLE IF EXISTS ml_config ADD COLUMN IF NOT EXISTS equipment_groundingdino_prompt TEXT DEFAULT 'crane, excavator, concrete truck, dump truck, bulldozer, forklift, compactor';"))
        conn.execute(text("ALTER TABLE IF EXISTS cameras ADD COLUMN IF NOT EXISTS equipment_enabled BOOLEAN DEFAULT FALSE;"))

        # ── PTZ support flag on cameras ───────────────────────────────────────
        conn.execute(text("ALTER TABLE IF EXISTS cameras ADD COLUMN IF NOT EXISTS ptz_supported BOOLEAN DEFAULT FALSE;"))

        # ── BIM 3D Viewer: config + zone mappings ─────────────────────────────
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_bim_configs (
                id                SERIAL PRIMARY KEY,
                project_id        INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
                bim_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
                overlay_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
                model_url         VARCHAR(1000),
                model_filename    VARCHAR(300),
                model_size_bytes  BIGINT,
                model_uploaded_at TIMESTAMPTZ,
                uploaded_by       INTEGER REFERENCES users(id),
                created_at        TIMESTAMPTZ DEFAULT NOW(),
                updated_at        TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_project_bim_configs_project_id ON project_bim_configs(project_id);
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS bim_zone_mappings (
                id            SERIAL PRIMARY KEY,
                project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                zone_id       INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
                mesh_name     VARCHAR(500) NOT NULL,
                mesh_uuid     VARCHAR(128),
                display_color VARCHAR(20) NOT NULL DEFAULT '#3b82f6',
                created_by    INTEGER NOT NULL REFERENCES users(id),
                created_at    TIMESTAMPTZ DEFAULT NOW(),
                updated_at    TIMESTAMPTZ DEFAULT NOW(),
                CONSTRAINT uq_bim_zone_mesh UNIQUE (project_id, mesh_name),
                CONSTRAINT uq_bim_zone_id   UNIQUE (project_id, zone_id)
            );
            CREATE INDEX IF NOT EXISTS ix_bim_zone_mappings_project_id ON bim_zone_mappings(project_id);
            CREATE INDEX IF NOT EXISTS ix_bim_zone_mappings_zone_id    ON bim_zone_mappings(zone_id);
        """))

    # ── Create media directories for snapshots, clips, and reports ───────────
    import os as _os
    _os.makedirs(settings.media_snapshots_dir, exist_ok=True)
    _os.makedirs(settings.media_clips_dir, exist_ok=True)
    _os.makedirs(settings.reports_dir, exist_ok=True)

    # ── Mount media directories as static file routes ─────────────────────────
    # (must happen after directories are created)
    app.mount("/media/snapshots", StaticFiles(directory=settings.media_snapshots_dir), name="snapshots")
    app.mount("/media/clips", StaticFiles(directory=settings.media_clips_dir), name="clips")

    # ── BIM 3D model static serving ───────────────────────────────────────────
    import os as _os2
    _bim_dir = _os2.getenv("BIM_UPLOAD_DIR", "uploads/bim")
    _os2.makedirs(_bim_dir, exist_ok=True)
    app.mount("/bim-models", StaticFiles(directory=_bim_dir), name="bim-models")

    # ── Start incident event queue workers (fire-and-forget bridge) ───────────
    try:
        from .services.incident_event_queue import start_workers as _start_queue_workers
        from .services.workforce_event_queue import start_workers as _start_wf_queue_workers
        from .services.activity_event_queue import start_workers as _start_act_queue_workers
        from .services.equipment_event_queue import start_workers as _start_eq_queue_workers
        print("[main] 🚀 Starting incident event queue workers...")
        logger.info("[main] Starting incident event queue workers...")
        _start_queue_workers()
        _start_wf_queue_workers()
        _start_act_queue_workers()
        _start_eq_queue_workers()
        print("[main] ✅ Incident + Workforce + Activity + Equipment event queue workers started successfully")
        logger.info("[main] ✅ Incident + Workforce + Activity + Equipment event queue workers started successfully")
    except Exception as e:
        print(f"[main] ❌ Failed to start incident event queue workers: {e}")
        logger.error(f"[main] ❌ Failed to start incident event queue workers: {e}", exc_info=True)

    # ── Start periodic ReID gallery save (galleries load on-demand per-project) ──
    # Per-project galleries are loaded lazily in _get_project_reid_context() when each
    # camera pipeline starts.  We only need to kick off the periodic save daemon here.
    try:
        from .services.reid_persistence import start_periodic_save
        start_periodic_save(interval_s=60)
        logger.info("[main] ReID periodic save thread started (per-project galleries load on demand)")
    except Exception as e:
        logger.warning(f"[main] ReID periodic save start failed: {e}")

    # ── Auto-start PPE inference for all active projects ──────────────────────
    # Runs in a background thread so RTSP connects don't delay server startup
    try:
        from .services import ppe_stream_manager as _psm
        import threading as _threading
        _t = _threading.Thread(target=_psm.start_all_active, name="ppe-auto-start", daemon=True)
        _t.start()
        logger.info("[main] PPE auto-start thread launched")
    except Exception as e:
        logger.error(f"[main] PPE auto-start failed: {e}", exc_info=True)

    # ── notes table ──────────────────────────────────────────────────────────
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS notes (
                id           SERIAL PRIMARY KEY,
                project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title        VARCHAR(500) NOT NULL,
                content      TEXT,
                category     VARCHAR(50) NOT NULL DEFAULT 'tasks',
                is_favourite BOOLEAN NOT NULL DEFAULT FALSE,
                created_at   TIMESTAMPTZ DEFAULT NOW(),
                updated_at   TIMESTAMPTZ DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS ix_notes_project_user ON notes(project_id, user_id);
        """))

    # ── Smart Query Assistant history table ──────────────────────────────────
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS smart_query_history (
                id           SERIAL PRIMARY KEY,
                user_id      INTEGER REFERENCES users(id) ON DELETE CASCADE,
                project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
                question     TEXT NOT NULL,
                answer       TEXT,
                sql_used     TEXT,
                chart_json   TEXT,
                evidence_json TEXT,
                insights_json TEXT,
                duration_ms  INTEGER,
                cached       BOOLEAN DEFAULT FALSE,
                mode         VARCHAR(20) DEFAULT 'standard',
                created_at   TIMESTAMPTZ DEFAULT NOW()
            )
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_smart_query_history_user
            ON smart_query_history(user_id, created_at DESC)
        """))
        # Add conversation_id for multi-turn conversation tracking
        conn.execute(text("""
            ALTER TABLE smart_query_history
            ADD COLUMN IF NOT EXISTS conversation_id VARCHAR(36)
        """))
        conn.execute(text("""
            ALTER TABLE smart_query_history
            ADD COLUMN IF NOT EXISTS resolved_question TEXT
        """))
        conn.execute(text("""
            ALTER TABLE smart_query_history
            ADD COLUMN IF NOT EXISTS query_context_json TEXT
        """))
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_smart_query_history_conversation
            ON smart_query_history(conversation_id, created_at ASC)
            WHERE conversation_id IS NOT NULL
        """))

    # ── Notification table column additions ───────────────────────────────────
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS category VARCHAR(50);"))
            conn.execute(text("ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS priority VARCHAR(20);"))
            conn.execute(text("ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS action_url VARCHAR(500);"))
            conn.execute(text("ALTER TABLE IF EXISTS notifications ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES project_tasks(id) ON DELETE SET NULL;"))

    # Start camera health-check scheduler (after DB migrations)
    # Load config from DB first; fall back to .env if DB load fails
    from .core.db import SessionLocal
    db = SessionLocal()

    try:
        from .core.security import get_password_hash
        from .models.project_task import ProjectTask
        from .models.user import PlatformRole, User

        system_user = db.query(User).filter(User.username == "system").first()
        if not system_user:
            system_user = db.query(User).filter(User.email == "system@constructionsightai.com").first()
            if system_user:
                system_user.username = "system"
        if system_user:
            # Ensure system user is always inactive (can never log in)
            if system_user.is_active:
                system_user.is_active = False
                db.commit()
        if not system_user:
            system_user = User(
                full_name="System",
                email="system@constructionsightai.com",
                username="system",
                password_hash=get_password_hash("system-user-not-for-login"),
                is_active=False,
                platform_role=PlatformRole.USER,
                is_approved=True,
                can_create_project=False,
            )
            db.add(system_user)
            db.commit()
            db.refresh(system_user)

        if system_user and system_user.id:
            db.query(ProjectTask).filter(
                ProjectTask.auto_generated == True,  # noqa: E712
                ProjectTask.created_by.is_(None),
            ).update({"created_by": system_user.id}, synchronize_session=False)
            db.commit()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass

    # ── Initialize ML Config (singleton) ──────────────────────────────────────
    # Seed default ml_config row if it doesn't exist
    try:
        ml_config = db.query(MLConfig).filter(MLConfig.id == 1).first()
        if not ml_config:
            ml_config = MLConfig(id=1)
            db.add(ml_config)
            db.commit()
            logger.info("✅ ML config initialized (defaults)")
    except Exception as e:
        logger.warning(f"ML config init failed: {e}, falling back to service defaults")

    # ── Smart Query Assistant: build dynamic schema registry ─────────────────
    try:
        from .services.smart_query.schema_registry import registry as _sq_registry
        _sq_registry.build(engine)
        logger.info(f"[main] Smart Query schema registry built: {len(_sq_registry.get_all_table_names())} tables")
    except Exception as e:
        logger.warning(f"[main] Smart Query schema registry build failed (non-critical): {e}")

    # ── Smart Query Assistant: build FAISS+BM25 schema index ─────────────────
    try:
        from .services.smart_query.schema_memory import build_schema_index
        build_schema_index()
        logger.info("[main] Smart Query schema index built (FAISS + BM25)")
    except Exception as e:
        logger.warning(f"[main] Smart Query schema index build failed (non-critical): {e}")

    # ── Smart Query Assistant: build few-shot SQL example index ──────────────
    try:
        from .services.smart_query.few_shot_memory import build_few_shot_index
        build_few_shot_index()
        logger.info("[main] Smart Query few-shot index built")
    except Exception as e:
        logger.warning(f"[main] Smart Query few-shot index build failed (non-critical): {e}")

    # ── Initialize Camera Scheduler ───────────────────────────────────────────
    db_config = sched.load_config_from_db(db)

    if db_config and db_config.get("enabled"):
        # DB config exists and is enabled
        sched.start(interval_minutes=db_config.get("interval_minutes", 5))
    elif settings.camera_scheduler_enabled:
        # Fall back to .env settings
        sched.start(interval_minutes=settings.camera_scheduler_interval_minutes)

    # ── Initialize Report Scheduler ───────────────────────────────────────────
    try:
        from .services.report_scheduler import start as _report_sched_start
        _report_sched_start()
    except Exception as _rse:
        print(f"[main] report_scheduler start failed: {_rse}")

    db.close()

    # ── Notification broker: capture asyncio event loop for SSE/thread bridge ─
    import asyncio as _asyncio
    _loop = _asyncio.get_running_loop()

    from .services.notification_broker import set_event_loop as _set_notif_loop
    try:
        _set_notif_loop(_loop)
        logger.info("✅ Notification broker event loop registered")
    except Exception as _e:
        logger.warning(f"Notification broker loop setup failed: {_e}")

    from .services.ppe_dashboard_broker import set_event_loop as _set_dash_loop
    try:
        _set_dash_loop(_loop)
        logger.info("✅ PPE dashboard broker event loop registered")
    except Exception as _e:
        logger.warning(f"PPE dashboard broker loop setup failed: {_e}")

    from .services.camera_health_broker import set_event_loop as _set_cam_health_loop
    try:
        _set_cam_health_loop(_loop)
        logger.info("✅ Camera health broker event loop registered")
    except Exception as _e:
        logger.warning(f"Camera health broker loop setup failed: {_e}")

    from .services.project_camera_broker import set_event_loop as _set_proj_cam_loop
    try:
        _set_proj_cam_loop(_loop)
        logger.info("✅ Project camera broker event loop registered")
    except Exception as _e:
        logger.warning(f"Project camera broker loop setup failed: {_e}")

    from .services.project_task_broker import set_event_loop as _set_proj_task_loop
    try:
        _set_proj_task_loop(_loop)
        logger.info("✅ Project task broker event loop registered")
    except Exception as _e:
        logger.warning(f"Project task broker loop setup failed: {_e}")

    from .services.workforce_dashboard_broker import set_event_loop as _set_wf_dash_loop
    try:
        _set_wf_dash_loop(_loop)
        logger.info("✅ Workforce dashboard broker event loop registered")
    except Exception as _e:
        logger.warning(f"Workforce dashboard broker loop setup failed: {_e}")

    from .services.activity_dashboard_broker import set_event_loop as _set_act_dash_loop
    try:
        _set_act_dash_loop(_loop)
    except Exception as _e:
        logger.warning(f"Activity dashboard broker loop setup failed: {_e}")

    from .services.equipment_dashboard_broker import set_event_loop as _set_eq_dash_loop
    try:
        _set_eq_dash_loop(_loop)
        logger.info("✅ Equipment dashboard broker event loop registered")
    except Exception as _e:
        logger.warning(f"Equipment dashboard broker loop setup failed: {_e}")

    from .services.risk_dashboard_broker import set_event_loop as _set_risk_dash_loop
    try:
        _set_risk_dash_loop(_loop)
        logger.info("✅ Risk dashboard broker event loop registered")
    except Exception as _e:
        logger.warning(f"Risk dashboard broker loop setup failed: {_e}")


# Include routers
app.include_router(auth_router)
app.include_router(password_reset_router)
app.include_router(admin_projects_router)
app.include_router(project_features_router)
app.include_router(project_ml_config_router)
app.include_router(projects_router)
app.include_router(invitations_router)
app.include_router(admin_invitations_router)
app.include_router(admin_users_router)
app.include_router(admin_sites_router)
app.include_router(admin_cameras_router)
app.include_router(admin_notifications_router)
app.include_router(users_router)
app.include_router(project_tasks_router)
app.include_router(notes_router)
app.include_router(ml_stream_router)
app.include_router(project_ppe_router)
app.include_router(user_notifications_router)
app.include_router(admin_ml_config_router)
app.include_router(project_reports_router)
app.include_router(webhooks_router)
app.include_router(project_workforce_router)
app.include_router(project_activity_router)
app.include_router(project_equipment_router)
app.include_router(project_bim_router)
app.include_router(project_risk_router)
app.include_router(admin_risk_router)
app.include_router(smart_query_router)

@app.on_event("shutdown")
def on_shutdown():
    sched.stop()

    # Save ReID gallery on clean shutdown
    try:
        from .services.reid_persistence import save_gallery
        import app.api.routes.ml_stream_enterprise as _mse
        saved = 0
        for _pid, _mgr in list(_mse._project_faiss_managers.items()):
            _sm   = _mse._project_state_memories.get(_pid)
            _lock = _mse._project_reid_locks.get(_pid)
            if _lock is None:
                continue
            with _lock:
                save_gallery(_mgr, _sm, project_id=_pid)
            saved += 1
        logger.info(f"[main] ReID galleries saved on shutdown ({saved} projects)")
    except Exception as e:
        logger.warning(f"[main] ReID gallery save on shutdown failed: {e}")


# Root route
@app.get("/")
def read_root():
    return {"status": "✅ Server running", "project": "ConstructionSight AI"}

# Example health check
@app.get("/health")
def health_check():
    return {"ok": True, "message": "FastAPI backend is healthy."}
