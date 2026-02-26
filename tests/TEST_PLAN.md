# Test Plan — ConstructionSight-AI

**Version:** 1.0  
**Last Updated:** 2026-05-14  
**Scope:** Backend API, Frontend UI, ML Pipeline, Authentication, RBAC

---

## Overview

This document defines the testing strategy, test layers, critical test scenarios, and execution procedures for the ConstructionSight-AI platform. The philosophy is **defense-in-depth**: each layer catches different failure modes. No single layer is sufficient on its own.

### What Is Tested

- All API endpoints (auth, projects, cameras, PPE, analytics, reports)
- Project lifecycle state machine (DRAFT → SETUP_IN_PROGRESS → ACTIVE → ARCHIVED)
- Authentication security (JWT, refresh token family revocation, rate limiting, lockout)
- Role-Based Access Control (admin vs. PM vs. member vs. unauthenticated)
- Camera registration, health checks, and scheduler
- PPE/Workforce/Activity/Equipment/Risk data ingestion and retrieval
- Real-time SSE stream delivery
- Frontend wizard flows (project creation, camera edit)
- Report generation (async Celery jobs)
- Performance under concurrent load

### What Is Out of Scope

- Third-party email delivery (Gmail SMTP) — email sending is stubbed in tests
- Cloudinary upload performance — network calls are mocked
- GPU/CUDA ML inference timing — ML pipeline tested with CPU fallback in CI
- Mobile application (separate test suite)

### Test Environments

| Environment | Database | Notes |
|-------------|----------|-------|
| Local dev | Isolated PostgreSQL test DB | Runs against `tests/accessories/.env.test` |
| CI | PostgreSQL service container | Triggered on every push |
| Staging | Staging PostgreSQL | Smoke + E2E only |

---

## Test Architecture

```
tests/
├── unit/               Isolated component tests — mocked DB, external services
├── integration/        API endpoint tests against a real PostgreSQL test database
├── security/           Auth attacks, RBAC bypass attempts, injection, token manipulation
├── smoke/              Minimal critical-path tests — run on every deployment
├── contract/           Fuzz testing via Schemathesis (auto-generates from OpenAPI spec)
├── load/               Locust performance scenarios (concurrent users)
└── accessories/
    ├── .env.test        Isolated test environment config
    ├── conftest.py      pytest fixtures: test DB session, TestClient, seeded users/projects
    └── reports/         Allure HTML report output directory

frontend/e2e/           Playwright browser E2E tests
```

---

## Test Layers & Tools

| Layer | Tool | What It Covers | When to Run |
|-------|------|----------------|-------------|
| Unit | pytest + mocks | Models, services, utility functions in isolation | On every file save (watch mode) |
| Integration | pytest + real PostgreSQL | API → DB round trips, response shapes, status codes | Before every commit |
| Security | pytest | Auth flows, RBAC, token attacks, injection | Before every PR merge |
| Smoke | pytest | Critical endpoints — login, project create, camera verify | On every deployment |
| Contract/Fuzz | Schemathesis | Auto-generate edge-case requests from OpenAPI spec | Weekly / on schema changes |
| Load | Locust | 50–500 concurrent users on analytics, camera, reports | Before major releases |
| E2E | Playwright | Full browser flows — login → create project → invite PM → activate | Before every PR merge |
| Frontend Unit | Vitest + RTL | React components, hooks, utility functions | On every file save |
| Coverage | pytest-cov + @vitest/coverage-v8 | Line/branch coverage reporting | On every CI run |
| Reporting | Allure + Playwright HTML | HTML reports with history, metrics, screenshots | After every CI run |

---

## Running Tests

### Backend

```bash
# From the project root — uses Makefile targets
make test-unit           # pytest tests/unit
make test-integration    # pytest tests/integration  (requires PostgreSQL + Redis)
make test-security       # pytest tests/security
make test-smoke          # pytest tests/smoke
make test-contract       # schemathesis (requires running API server)
make test-load           # locust scenarios
make test-all            # all of the above sequentially
make test-all-allure     # all + generate Allure HTML report
make allure-open         # open Allure report in browser

# Run a specific file
pytest tests/integration/test_auth.py -v

# Run with coverage
pytest tests/ --cov=app --cov-report=html
```

### Frontend

```bash
cd frontend
npm run test              # Vitest unit tests (once)
npm run test:watch        # Vitest watch mode
npm run test:ui           # Vitest UI dashboard
npm run test:coverage     # Coverage report
npm run test:e2e          # Playwright E2E
npm run test:e2e:report   # Open last Playwright HTML report
```

### Environment Requirements

- PostgreSQL running (separate test DB, configured in `tests/accessories/.env.test`)
- Redis running (for Celery integration tests)
- Backend server running on `:8000` (for contract and E2E tests)
- Frontend server running on `:5173` (for E2E tests)

---

## Test Fixtures (`tests/accessories/conftest.py`)

| Fixture | Scope | Description |
|---------|-------|-------------|
| `db` | function | Fresh DB session; rolls back after each test |
| `client` | function | FastAPI TestClient with test DB injected |
| `admin_user` | session | Seeded admin account + valid access token |
| `pm_user` | session | Seeded PM (user) account + valid access token |
| `draft_project` | function | Project in DRAFT status, owned by admin |
| `active_project` | function | Project in ACTIVE status with PM membership |
| `camera` | function | Registered camera linked to active_project |
| `admin_headers` | function | `Authorization: Bearer <admin_token>` dict |
| `pm_headers` | function | `Authorization: Bearer <pm_token>` dict |

---

## Critical Test Scenarios

### Authentication (TC-AUTH)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-AUTH-01 | Login with valid credentials | 200 + access token in body + `refresh_token` httponly cookie set |
| TC-AUTH-02 | Login with wrong password | 401 Unauthorized |
| TC-AUTH-03 | Login fails N times within window | 429 / lockout response after threshold |
| TC-AUTH-04 | POST /auth/refresh with valid cookie | 200 + new access token; old refresh token revoked |
| TC-AUTH-05 | POST /auth/refresh with expired cookie | 401 Unauthorized |
| TC-AUTH-06 | POST /auth/logout | 200; subsequent refresh with old cookie returns 401 |
| TC-AUTH-07 | Token family revocation | After logout, ALL existing refresh cookies for that user return 401 |
| TC-AUTH-08 | Expired access token used | 401; frontend auto-retries with refreshed token |
| TC-AUTH-09 | Access token with tampered signature | 401 |
| TC-AUTH-10 | Access token with wrong audience claim | 401 |
| TC-AUTH-11 | POST /auth/forgot-password with unknown email | 200 (no enumeration) |
| TC-AUTH-12 | POST /auth/reset-password with valid OTP | 200; password changed; all sessions invalidated |
| TC-AUTH-13 | POST /auth/reset-password with expired OTP | 400 |

### Project Lifecycle (TC-PROJ)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-PROJ-01 | Admin creates project | 201; status=DRAFT; site auto-created |
| TC-PROJ-02 | Admin edits DRAFT project | 200; fields updated |
| TC-PROJ-03 | Admin attempts to edit ACTIVE project | 400 (status guard) |
| TC-PROJ-04 | Admin attempts to edit ARCHIVED project | 400 (status guard) |
| TC-PROJ-05 | Admin deletes DRAFT project | 200; project + site deleted; GET returns 404 |
| TC-PROJ-06 | Admin attempts to delete ACTIVE project | 400 |
| TC-PROJ-07 | Admin invites PM by email | 201; invitation record created; email stub called |
| TC-PROJ-08 | PM accepts valid invitation | 200; membership created (ACTIVE); status → SETUP_IN_PROGRESS |
| TC-PROJ-09 | PM completes setup wizard + POST /activate | 200; status → ACTIVE |
| TC-PROJ-10 | Admin archives ACTIVE project | 200; status → ARCHIVED |
| TC-PROJ-11 | Write to ARCHIVED project | 400 |
| TC-PROJ-12 | Admin unarchives ARCHIVED project | 200; status → ACTIVE; writes allowed again |
| TC-PROJ-13 | Admin resends invitation | 200; new expiry; email stub called again |

### Camera Management (TC-CAM)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-CAM-01 | Register camera with RTSP URL | 201; camera appears in GET /admin/cameras |
| TC-CAM-02 | PATCH /admin/cameras/{id} identity fields | 200; updated fields returned |
| TC-CAM-03 | PATCH /admin/cameras/{id}/credentials | 200; RTSP URL and auth updated |
| TC-CAM-04 | POST /admin/cameras/{id}/verify | 200; health_status and last_verified_at updated |
| TC-CAM-05 | POST /admin/cameras/{id}/archive | 200; camera excluded from non-archived lists |
| TC-CAM-06 | GET scheduler config | 200; returns singleton config row |
| TC-CAM-07 | PATCH scheduler config — disable | 200; background health-checks stop |
| TC-CAM-08 | PATCH scheduler config — update interval | 200; new interval applied without restart |

### PPE & Safety Analytics (TC-PPE)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-PPE-01 | GET /projects/{id}/ppe/summary | 200; violation counts match seeded incidents |
| TC-PPE-02 | GET /projects/{id}/ppe/incidents with date filter | 200; only incidents in range returned |
| TC-PPE-03 | GET /projects/{id}/ppe/incidents with type filter | 200; only matching violation_type returned |
| TC-PPE-04 | GET /projects/{id}/ppe/trend | 200; time-series buckets returned |
| TC-PPE-05 | GET /projects/{id}/ppe/zones | 200; grouped by zone_id |
| TC-PPE-06 | GET /projects/{id}/ppe/cameras | 200; grouped by camera_id |
| TC-PPE-07 | SSE stream connection established | HTTP 200 with `Content-Type: text/event-stream` |
| TC-PPE-08 | New incident created → SSE event delivered | `data:` event received within 3s by connected client |

### Access Control / RBAC (TC-RBAC)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-RBAC-01 | Unauthenticated request to /admin/* | 401 Unauthorized |
| TC-RBAC-02 | PM (non-admin) accesses /admin/projects | 403 Forbidden |
| TC-RBAC-03 | Admin accesses another user's project data | 200 (admin has platform-wide access) |
| TC-RBAC-04 | PM accesses a project they are NOT a member of | 403 or 404 |
| TC-RBAC-05 | PM accesses their own project | 200 |
| TC-RBAC-06 | Removed project member attempts access | 403 |
| TC-RBAC-07 | Unapproved user attempts login | 403 (account not approved) |
| TC-RBAC-08 | PM attempts to delete a project | 403 (admin-only endpoint) |

### Invitation Flow (TC-INV)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-INV-01 | Accept valid, unexpired invitation | 200; membership ACTIVE; invitation ACCEPTED |
| TC-INV-02 | Accept expired invitation token | 400 |
| TC-INV-03 | Accept already-ACCEPTED invitation | 400 |
| TC-INV-04 | Accept invitation for non-existent token | 404 |
| TC-INV-05 | Resend invitation generates new token | 200; old token no longer valid; new expiry set |

### Reports (TC-RPT)

| ID | Scenario | Expected Result |
|----|----------|----------------|
| TC-RPT-01 | POST /projects/{id}/reports/generate | 202 Accepted; Celery job queued |
| TC-RPT-02 | GET /projects/{id}/reports after generation | 200; report status=COMPLETED; file_url populated |
| TC-RPT-03 | GET /projects/{id}/reports/{id}/download | 200; file stream returned |
| TC-RPT-04 | Generate report for ARCHIVED project | 400 (archived project read-only) |

---

## Load Test Scenarios (Locust)

All scenarios target a staging environment with realistic seed data.

| Scenario | File | Target | Pass Criteria |
|----------|------|--------|---------------|
| Analytics Dashboard | `load/test_analytics.py` | 200 concurrent users | p95 < 500ms |
| Smart Query | `load/test_smart_query.py` | 50 concurrent users | p95 < 2s |
| Report Generation | `load/test_reports.py` | 20 concurrent users | p95 < 5s |
| Camera Verify | `load/test_camera_verify.py` | 100 concurrent users | p95 < 1s |
| Main API (mixed) | `load/test_main.py` | 500 concurrent users | error rate < 1% |

---

## End-to-End Test Scenarios (Playwright)

| Scenario | File | Steps |
|----------|------|-------|
| Admin full project flow | `e2e/project-lifecycle.spec.js` | Login as admin → create project → invite PM → verify DRAFT status |
| PM onboarding | `e2e/pm-onboarding.spec.js` | Accept invite → complete setup wizard → activate project |
| Camera registration | `e2e/camera-management.spec.js` | Login as admin → add camera → trigger verify → check health status |
| PPE dashboard | `e2e/ppe-dashboard.spec.js` | Login as PM → open project → view PPE dashboard → filter incidents |
| Auth guard | `e2e/auth-guard.spec.js` | Visit protected route without token → redirected to login |
| Token refresh | `e2e/token-refresh.spec.js` | Wait for access token to expire → silent refresh → no user disruption |

---

## Coverage Targets

| Area | Minimum Coverage |
|------|-----------------|
| `app/api/routes/*` (route handlers) | 80% |
| `app/core/security.py` (JWT + hashing) | 95% |
| `app/api/deps.py` (auth dependencies) | 90% |
| `app/services/*` (email, scheduler) | 80% |
| `app/models/*` (ORM models) | 70% |
| Frontend `utils/api.js` | 80% |
| Frontend `utils/errorHandler.js` | 75% |
| Frontend hooks (`useAuthGuard`, `useFormPersist`) | 70% |

---

## Allure Reporting

Tests are tagged with Allure decorators for organized HTML reports:

```python
import allure

@allure.feature("Authentication")
@allure.story("Token Refresh")
@allure.severity(allure.severity_level.CRITICAL)
def test_refresh_token_rotation():
    ...
```

Reports include:
- Pass/fail metrics per feature area
- Execution history (trend over time)
- Screenshot/video attachments on E2E failures
- Full request/response bodies on integration failures

Generated to: `tests/accessories/reports/`

---

## Adding a New Test

### Backend Integration Test

```python
# tests/integration/test_my_feature.py
import pytest
from fastapi.testclient import TestClient

def test_create_feature(client: TestClient, admin_headers: dict):
    response = client.post(
        "/admin/myfeature",
        json={"name": "Test Feature"},
        headers=admin_headers
    )
    assert response.status_code == 201
    assert response.json()["name"] == "Test Feature"
```

### Frontend Unit Test (Vitest)

```js
// src/utils/__tests__/errorHandler.test.js
import { describe, it, expect } from 'vitest'
import { parseApiError } from '../errorHandler'

describe('parseApiError', () => {
  it('extracts detail string from FastAPI response', () => {
    const err = { response: { data: { detail: 'Not found' } } }
    expect(parseApiError(err)).toBe('Not found')
  })
})
```

### E2E Test (Playwright)

```js
// frontend/e2e/my-flow.spec.js
import { test, expect } from '@playwright/test'

test('admin can create a project', async ({ page }) => {
  await page.goto('/login')
  await page.fill('[name=email]', 'admin@example.com')
  await page.fill('[name=password]', 'password')
  await page.click('button[type=submit]')
  await page.goto('/admin/projects/create')
  await expect(page.locator('h1')).toContainText('Create Project')
})
```
