# Backend — ConstructionSight-AI

FastAPI backend for the ConstructionSight-AI platform. Handles authentication, project and camera management, real-time ML inference streaming, PPE/workforce/activity/risk analytics, and async report generation via Celery.

---

## Setup

### Prerequisites

- Python 3.12+
- PostgreSQL 14+
- Redis 6+ (for Celery task queue)

### Install & Run

```bash
cd backend

# Create virtual environment
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS/Linux

pip install --upgrade pip setuptools wheel
pip install -r requirements.txt

# Create initial admin account
python -m app.scripts.seed_admin

# Start development server
python -m uvicorn app.main:app --reload
# API:      http://localhost:8000
# Swagger:  http://localhost:8000/docs
# ReDoc:    http://localhost:8000/redoc
```

### Celery Worker

```bash
celery -A app.celery_app worker --loglevel=info -Q ppe,clipper,default
```

---

## Environment Variables (`backend/.env`)

| Variable | Description | Default |
|----------|-------------|---------|
| `ENV` | Runtime environment | `development` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_USER` | Database user | `postgres` |
| `DB_PASSWORD` | Database password | — |
| `DB_NAME` | Database name | `constructionsight` |
| `JWT_SECRET` | Secret key for JWT signing | — (required) |
| `JWT_ALGORITHM` | Signing algorithm | `HS256` |
| `JWT_KEY_ID` | Key ID in JWT header | `current` |
| `JWT_ISSUER` | JWT `iss` claim | `constructionsight-ai` |
| `JWT_AUDIENCE` | JWT `aud` claim | `constructionsight-client` |
| `ACCESS_TOKEN_EXP_MINUTES` | Access token lifetime | `30` |
| `REFRESH_TOKEN_EXP_MINUTES` | Refresh token lifetime | `10080` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `http://localhost:5173` |
| `FRONTEND_URL` | Frontend base URL (email links) | `http://localhost:5173` |
| `REFRESH_COOKIE_NAME` | Name of refresh token cookie | `refresh_token` |
| `REFRESH_COOKIE_SAMESITE` | SameSite policy | `lax` |
| `COOKIE_SECURE` | Secure flag on cookies | `false` |
| `RATE_LIMIT_LOGIN` | Login endpoint rate limit | `5/minute` |
| `RATE_LIMIT_SIGNUP` | Signup endpoint rate limit | `3/minute` |
| `RATE_LIMIT_REFRESH` | Token refresh rate limit | `10/minute` |
| `LOGIN_FAIL_WINDOW_MINUTES` | Lockout window | `15` |
| `LOGIN_FAIL_THRESHOLD` | Fails before soft lockout | `10` |
| `LOCKOUT_THRESHOLD` | Fails before hard lockout | `5` |
| `LOCKOUT_BASE_MINUTES` | Initial lockout duration | `5` |
| `LOCKOUT_MULTIPLIER` | Progressive lockout multiplier | `2` |
| `LOCKOUT_MAX_MINUTES` | Maximum lockout duration | `60` |
| `GMAIL_USER` | Outgoing email address | — |
| `GMAIL_APP_PASSWORD` | Gmail app password | — |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name | — |
| `CLOUDINARY_API_KEY` | Cloudinary API key | — |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret | — |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py                 FastAPI app init, lifespan startup, router registration, SQL migrations
│   ├── celery_app.py           Celery broker/backend config (Redis)
│   ├── api/
│   │   ├── deps.py             Shared dependencies: get_db, get_current_user, require_admin, log_event
│   │   └── routes/
│   │       ├── auth.py                   POST /auth/* (login, logout, refresh, register, reset)
│   │       ├── admin_projects.py         /admin/projects CRUD + lifecycle transitions
│   │       ├── admin_cameras.py          /admin/cameras register, verify, archive, scheduler config
│   │       ├── admin_users.py            /admin/users list, approve, role management
│   │       ├── admin_invitations.py      /admin/invitations platform-level invitation management
│   │       ├── admin_ml_config.py        /admin/ml-config global ML model configuration
│   │       ├── projects.py               /projects/{id} setup wizard, activate, settings
│   │       ├── invitations.py            /invitations/accept/{token} PM invite acceptance
│   │       ├── project_ppe.py            /projects/{id}/ppe incidents, summary, SSE stream
│   │       ├── project_workforce.py      /projects/{id}/workforce tracking, alerts
│   │       ├── project_activity.py       /projects/{id}/activity alerts, snapshots
│   │       ├── project_equipment.py      /projects/{id}/equipment usage, alerts
│   │       ├── project_risk.py           /projects/{id}/risk scoring, events
│   │       ├── project_reports.py        /projects/{id}/reports generate, list, download
│   │       ├── project_features.py       /projects/{id}/features per-camera feature toggles
│   │       ├── project_bim.py            /projects/{id}/bim BIM workspace endpoints
│   │       ├── ml_stream_enterprise.py   SSE real-time ML inference stream
│   │       ├── smart_query.py            /smart-query AI assistant (LangGraph + FAISS)
│   │       └── dev_video_test.py         Dev/debug video feed endpoint
│   ├── core/
│   │   ├── db.py               SQLAlchemy engine, SessionLocal, Base
│   │   ├── security.py         JWT create/decode, Argon2 hash/verify
│   │   └── config.py           Pydantic Settings — reads all .env variables
│   ├── models/                 SQLAlchemy ORM models (27 total)
│   ├── schemas/                Pydantic request/response shapes
│   ├── services/
│   │   ├── email_service.py    Email helper — stub logger (configure provider via .env)
│   │   └── camera_scheduler.py APScheduler background health-check polling
│   ├── tasks/                  Celery async tasks (ML inference, report generation, evidence clips)
│   ├── ml/                     YOLOv11 inference pipeline, Re-ID, FAISS index management
│   └── scripts/
│       └── seed_admin.py       CLI script to create initial admin account
└── requirements.txt
```

---

## Database Models

### Auth & Users

| Model | Key Fields |
|-------|-----------|
| `users` | id, email, full_name, hashed_password, platform_role (admin/user), is_approved, token_version, created_at |
| `refresh_tokens` | id, user_id, token_hash, family_id, expires_at, revoked |
| `auth_events` | id, event_type, user_id, details (JSON), created_at |

### Projects & Teams

| Model | Key Fields |
|-------|-----------|
| `projects` | id, name, location, description, status (DRAFT/SETUP_IN_PROGRESS/ACTIVE/ARCHIVED), site_id, created_by, created_at |
| `sites` | id, name, address, created_at |
| `project_invitations` | id, project_id, email, token, expires_at, status (PENDING/ACCEPTED/EXPIRED) |
| `project_memberships` | id, project_id, user_id, role (pm/member), status (ACTIVE/REMOVED) |

### Cameras

| Model | Key Fields |
|-------|-----------|
| `cameras` | id, name, vendor, model, serial_number, rtsp_url, onvif_host, onvif_port, username, password, site_id, project_id, archived, last_verified_at, health_status |

### Safety & Analytics

| Model | Key Fields |
|-------|-----------|
| `ppe_incidents` | id, project_id, camera_id, violation_type, confidence, image_url, video_url, zone_id, timestamp |
| `activity_alerts` | id, project_id, camera_id, alert_type, severity, timestamp |
| `activity_snapshots` | id, camera_id, snapshot_data (JSON), captured_at |
| `equipment_alerts` | id, project_id, camera_id, equipment_type, alert_type, timestamp |
| `equipment_snapshots` | id, camera_id, snapshot_data (JSON), captured_at |
| `risk_events` | id, project_id, camera_id, risk_score, risk_type, details, timestamp |

### Configuration & Reports

| Model | Key Fields |
|-------|-----------|
| `ml_config` | id=1 singleton, model_path, confidence_threshold, nms_threshold, enabled_classes |
| `project_ml_config` | id, project_id, overrides (JSON) — per-project ML parameter overrides |
| `project_reports` | id, project_id, report_type, file_url, generated_at, status |
| `scheduler_config` | id=1 singleton, enabled, interval_seconds, last_run_at |

---

## API Endpoints

### Authentication (`/auth`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Create new user account (requires admin approval) |
| POST | `/auth/login` | Authenticate — returns access token + sets httponly refresh cookie |
| POST | `/auth/logout` | Revoke refresh cookie, increment token family version |
| POST | `/auth/refresh` | Silent token refresh via cookie |
| POST | `/auth/forgot-password` | Send OTP reset code to email |
| POST | `/auth/reset-password` | Confirm OTP and set new password |
| GET | `/auth/me` | Get current authenticated user profile |

### Admin: Projects (`/admin/projects`) — requires `platform_role == "admin"`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/projects` | Create project + auto-create site (status = DRAFT) |
| GET | `/admin/projects` | List all projects with filters |
| GET | `/admin/projects/{id}` | Get project detail |
| PATCH | `/admin/projects/{id}` | Edit project fields (DRAFT status only) |
| DELETE | `/admin/projects/{id}` | Delete project + cascade-delete site (DRAFT only) |
| PATCH | `/admin/projects/{id}/status` | Archive project (ACTIVE → ARCHIVED) |
| POST | `/admin/projects/{id}/unarchive` | Restore project (ARCHIVED → ACTIVE) |
| POST | `/admin/projects/{id}/invitations` | Invite PM by email |
| POST | `/admin/projects/{id}/invitations/{inv_id}/resend` | Resend invitation email |

### Admin: Cameras (`/admin/cameras`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/cameras` | Register new camera |
| GET | `/admin/cameras` | List all cameras |
| GET | `/admin/cameras/{id}` | Get camera detail |
| PATCH | `/admin/cameras/{id}` | Update identity (name, vendor, model, serial) |
| PATCH | `/admin/cameras/{id}/credentials` | Update connection details (RTSP URL, ONVIF, auth) |
| POST | `/admin/cameras/{id}/verify` | Trigger manual health check |
| POST | `/admin/cameras/{id}/archive` | Archive camera |
| GET | `/admin/cameras/scheduler/config` | Get health-check scheduler config |
| PATCH | `/admin/cameras/scheduler/config` | Update scheduler interval / toggle on/off |

### Admin: Users (`/admin/users`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/users` | List all platform users |
| PATCH | `/admin/users/{id}/approve` | Approve pending user registration |
| PATCH | `/admin/users/{id}/role` | Change user platform role |

### Admin: ML Config (`/admin/ml-config`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/admin/ml-config` | Get global ML model configuration |
| PATCH | `/admin/ml-config` | Update model path, confidence thresholds, enabled classes |

### Projects — PM/Member Routes (`/projects`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects/{id}` | Get project (membership required) |
| PATCH | `/projects/{id}/setup` | Save setup wizard step data |
| POST | `/projects/{id}/activate` | Complete setup → transition to ACTIVE |
| GET | `/projects/{id}/settings/ppe` | Get PPE detection settings |
| PATCH | `/projects/{id}/settings/ppe` | Update PPE thresholds per camera |
| GET/PATCH | `/projects/{id}/settings/workforce` | Workforce tracking settings |
| GET/PATCH | `/projects/{id}/settings/activity` | Activity detection settings |
| GET/PATCH | `/projects/{id}/settings/equipment` | Equipment monitoring settings |
| GET/PATCH | `/projects/{id}/settings/general` | General project settings |
| GET/PATCH | `/projects/{id}/settings/reports` | Report generation settings |

### Invitations

| Method | Path | Description |
|--------|------|-------------|
| POST | `/invitations/accept/{token}` | PM accepts invite → creates ACTIVE membership, transitions project to SETUP_IN_PROGRESS |

### PPE Analytics (`/projects/{id}/ppe`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/projects/{id}/ppe/summary` | Violation counts by type and date range |
| GET | `/projects/{id}/ppe/incidents` | Paginated incident list with filters |
| GET | `/projects/{id}/ppe/trend` | Time-series trend data |
| GET | `/projects/{id}/ppe/zones` | Violations breakdown by zone |
| GET | `/projects/{id}/ppe/cameras` | Violations breakdown by camera |
| GET | `/projects/{id}/ppe/stream` | SSE stream — real-time PPE events |

> Workforce, activity, equipment, and risk follow the same pattern under their respective path prefixes.

### Reports (`/projects/{id}/reports`)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/projects/{id}/reports/generate` | Queue async Celery task to generate PDF/Excel report |
| GET | `/projects/{id}/reports` | List all generated reports for project |
| GET | `/projects/{id}/reports/{report_id}/download` | Download report file |

### Smart Query

| Method | Path | Description |
|--------|------|-------------|
| POST | `/smart-query` | Natural-language query against project data |

---

## Authentication & Security

**JWT Token Claims:**
```json
{
  "sub": "user_id",
  "platform_role": "admin | user",
  "exp": 1234567890,
  "iat": 1234567890,
  "iss": "constructionsight-ai",
  "aud": "constructionsight-client",
  "jti": "unique-token-id",
  "ver": 3
}
```

**Token Family Revocation:** Each user has a `token_version` counter. On logout, the counter increments, invalidating all existing refresh tokens for that user across all devices.

**Password Security:** Argon2id hashing (not bcrypt). Configured via `passlib`.

**Refresh Cookies:** httponly, SameSite=lax, Secure=true in production. Unreadable by JavaScript — immune to XSS token theft.

**Rate Limiting:** Configurable per-endpoint limits via `.env`. Progressive lockout after repeated login failures (base + multiplier × attempt, capped at max).

---

## Database Migrations

This project does **not** use Alembic. All schema changes are raw SQL in `app/main.py → on_startup()`.

**Rules:**
- Always use `ADD COLUMN IF NOT EXISTS` — migrations must be idempotent (safe to run on every restart)
- Always use `CREATE TABLE IF NOT EXISTS`
- Drop unused columns only after confirming no code references them

**Example:**
```python
@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("""
            ALTER TABLE projects
            ADD COLUMN IF NOT EXISTS client_name VARCHAR(255)
        """))
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS project_zones (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                name VARCHAR(255) NOT NULL,
                coordinates JSONB,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
            )
        """))
```

---

## Adding a New API Endpoint

1. **Define schema** in `app/schemas/myfeature.py`:
   ```python
   from pydantic import BaseModel

   class MyFeatureCreate(BaseModel):
       name: str
   ```

2. **Create route file** `app/api/routes/myfeature.py`:
   ```python
   from fastapi import APIRouter, Depends
   from sqlalchemy.orm import Session
   from ..deps import get_db, require_admin, log_event
   from ...models.user import User

   router = APIRouter(prefix="/admin/myfeature", tags=["admin-myfeature"])

   @router.post("", status_code=201)
   def create_feature(
       body: MyFeatureCreate,
       db: Session = Depends(get_db),
       admin: User = Depends(require_admin),
   ):
       feature = MyFeature(name=body.name, created_by=admin.id)
       db.add(feature)
       log_event(db, "feature_created", admin.id, {"name": body.name})
       db.commit()
       db.refresh(feature)
       return feature
   ```

3. **Register in `main.py`**:
   ```python
   from .api.routes.myfeature import router as myfeature_router
   app.include_router(myfeature_router)
   ```

4. Add the corresponding SQL migration in `on_startup()`.

---

## Audit Logging

All state-changing operations call `log_event()`:

```python
from ..deps import log_event

log_event(db, "project_created", admin.id, {"project_name": body.name})
log_event(db, "pm_invited", admin.id, {"project_id": project.id, "pm_email": email})
log_event(db, "camera_archived", admin.id, {"camera_id": camera.id})
```

Events are persisted to `auth_events` table with timestamp. Useful for audit trails and debugging production issues.

---

## Email Service

Emails are always sent **after `db.commit()`** — never before. This ensures DB state is durable before any email attempt. Email failures do not roll back committed DB changes.

Default implementation: stub logger (prints to console). Configure a real provider:

```env
GMAIL_USER=yourapp@gmail.com
GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

---

## Running Tests

```bash
# From the backend directory
pytest tests/unit -v
pytest tests/integration -v
pytest tests/security -v

# From the project root (uses Makefile)
make test-unit
make test-integration
make test-security
make test-smoke
make test-all-allure     # Run all + generate Allure HTML report
make allure-open         # Open Allure report in browser
```

See [tests/TEST_PLAN.md](../tests/TEST_PLAN.md) for the full test catalogue.

---

## Project Lifecycle

```
DRAFT
  │  Admin creates project
  ▼
SETUP_IN_PROGRESS
  │  PM accepts invitation → membership created
  ▼
ACTIVE
  │  PM completes setup wizard → POST /activate
  ▼
ARCHIVED
     Admin archives (or: admin can unarchive → ACTIVE)
```

The `projects.status` field gates all mutations. ARCHIVED projects return `400` on any write operation.
