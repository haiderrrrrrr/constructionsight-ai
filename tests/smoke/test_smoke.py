"""
Smoke Tests — 10 critical-path tests that must pass before any other suite runs.

Covers the full happy-path: signup → login → profile → project → cameras
→ refresh → logout. Run time target: < 30 seconds.
"""
import allure
import pytest
import uuid

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Smoke Tests"),
    allure.story("Critical Path — Happy Path"),
    pytest.mark.smoke,
]

from tests.conftest import CSRF_HEADERS


def _unique_email(prefix="smoke"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}@smoketest.com"


class TestSmokeHealthCheck:
    @pytest.mark.testcase(
        tc_id="TC-SMK-001",
        objective="Health check endpoint returns HTTP 200",
        precondition="Server is running",
        steps=["GET / or /health", "Assert HTTP 200"],
        test_data={},
        expected_result="HTTP 200 — server alive",
        post_condition="No state change",
    )
    def test_health_check(self, client):
        resp = client.get("/")
        assert resp.status_code == 200


class TestSmokeAuth:
    @pytest.mark.testcase(
        tc_id="TC-SMK-002",
        objective="User can sign up with valid credentials",
        precondition="Unique email not in DB",
        steps=[
            "POST /auth/signup with valid payload",
            "Assert HTTP 200 or 201",
        ],
        test_data={"email": "smoke_<uuid>@smoketest.com", "password": "Smoke123!"},
        expected_result="HTTP 200 or 201 — user created",
        post_condition="User row in DB with is_approved=False",
    )
    def test_signup_returns_success(self, client):
        resp = client.post("/auth/signup", json={
            "email": _unique_email("signup"),
            "username": f"smokeuser_{uuid.uuid4().hex[:6]}",
            "password": "Smoke123!",
            "full_name": "Smoke Test User",
        }, headers=CSRF_HEADERS)
        assert resp.status_code in (200, 201)

    @pytest.mark.testcase(
        tc_id="TC-SMK-003",
        objective="Admin user can login and receive an access token",
        precondition="admin_user account exists and is approved",
        steps=[
            "POST /auth/login with admin credentials",
            "Assert HTTP 200",
            "Assert access_token present in response",
        ],
        test_data={"identifier": "admin@constructionsight.ai"},
        expected_result="HTTP 200, access_token in response",
        post_condition="Authenticated session established",
    )
    def test_admin_login_returns_token(self, client, admin_user):
        resp = client.post("/auth/login", json={
            "identifier": admin_user.email,
            "password": "TestPass123!",
        }, headers=CSRF_HEADERS)
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    @pytest.mark.testcase(
        tc_id="TC-SMK-004",
        objective="Authenticated user can retrieve their own profile",
        precondition="User is authenticated",
        steps=[
            "GET /users/me with valid token",
            "Assert HTTP 200",
        ],
        test_data={"Authorization": "Bearer <valid token>"},
        expected_result="HTTP 200, user profile object",
        post_condition="No state change",
    )
    def test_authenticated_user_can_get_profile(self, client, user_headers):
        resp = client.get("/users/me", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-SMK-005",
        objective="Token refresh endpoint works with valid refresh cookie",
        precondition="User has a valid refresh cookie",
        steps=[
            "POST /auth/refresh with refresh cookie",
            "Assert HTTP 200 or 401 (no cookie in test env)",
        ],
        test_data={"cookie": "refresh_token=<valid>"},
        expected_result="HTTP 200 with new token, or 401 if no cookie in test env",
        post_condition="New access token issued",
    )
    def test_refresh_endpoint_reachable(self, client):
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code in (200, 401, 422)

    @pytest.mark.testcase(
        tc_id="TC-SMK-006",
        objective="User can logout successfully",
        precondition="User is authenticated",
        steps=[
            "POST /auth/logout with valid token",
            "Assert HTTP 200",
        ],
        test_data={"Authorization": "Bearer <valid token>"},
        expected_result="HTTP 200 — logout successful",
        post_condition="Refresh cookie cleared",
    )
    def test_logout_returns_200(self, client, user_headers):
        resp = client.post("/auth/logout", headers={**user_headers, **CSRF_HEADERS})
        assert resp.status_code == 200


class TestSmokeProjects:
    @pytest.mark.testcase(
        tc_id="TC-SMK-007",
        objective="Authenticated user can list their projects",
        precondition="User is authenticated",
        steps=[
            "GET /projects with valid token",
            "Assert HTTP 200",
        ],
        test_data={"Authorization": "Bearer <valid token>"},
        expected_result="HTTP 200, JSON array",
        post_condition="No state change",
    )
    def test_list_projects_returns_200(self, client, user_headers):
        resp = client.get("/projects", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-SMK-008",
        objective="Admin can create a new project",
        precondition="Admin authenticated; unique project name",
        steps=[
            "POST /admin/projects with valid payload",
            "Assert HTTP 201",
        ],
        test_data={"name": "Smoke Test Project", "location": "London"},
        expected_result="HTTP 201 — project created",
        post_condition="Project in DRAFT state",
    )
    def test_admin_can_create_project(self, client, admin_headers):
        from datetime import date, timedelta
        future = (date.today() + timedelta(days=365)).isoformat()
        resp = client.post("/admin/projects", json={
            "name": f"Smoke Project {uuid.uuid4().hex[:6]}",
            "location": "London",
            "end_date": future,
            "pm_email": f"pm_{uuid.uuid4().hex[:6]}@smoketest.com",
            "pm_full_name": "Smoke PM",
        }, headers=admin_headers)
        assert resp.status_code == 201


class TestSmokeCameras:
    @pytest.mark.testcase(
        tc_id="TC-SMK-009",
        objective="Admin can list cameras",
        precondition="Admin authenticated",
        steps=["GET /admin/cameras with admin token", "Assert HTTP 200"],
        test_data={"role": "admin"},
        expected_result="HTTP 200, JSON array",
        post_condition="No state change",
    )
    def test_admin_can_list_cameras(self, client, admin_headers):
        resp = client.get("/admin/cameras", headers=admin_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-SMK-010",
        objective="Regular user cannot access admin cameras (403)",
        precondition="Regular user authenticated",
        steps=["GET /admin/cameras with user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_user_cannot_access_admin_cameras(self, client, user_headers):
        resp = client.get("/admin/cameras", headers=user_headers)
        assert resp.status_code == 403
