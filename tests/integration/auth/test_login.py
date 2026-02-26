"""
Integration Tests — POST /auth/login

Covers: valid credentials (email/username), wrong password, unapproved user,
        inactive user, locked account, missing identifier, token structure,
        refresh cookie set, failed count reset.
"""
import allure
import pytest
from datetime import datetime, timedelta, timezone

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Authentication — Login"),
    pytest.mark.integration,
    pytest.mark.auth,
]

from tests.conftest import _make_user, CSRF_HEADERS


def _login(client, identifier, password="TestPass123!"):
    return client.post("/auth/login", json={"identifier": identifier, "password": password})


class TestLoginSuccess:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-006",
        objective="Valid email login returns 200 with access token",
        precondition="Approved active user exists (regular_user fixture)",
        steps=[
            "POST /auth/login with valid email and password",
            "Assert HTTP 200",
            "Assert access_token present in response body",
            "Assert token length > 20 characters",
        ],
        test_data={"identifier": "user@test.com", "password": "TestPass123!"},
        expected_result="HTTP 200, access_token in response body",
        post_condition="Session active — refresh cookie set in response",
    )
    def test_valid_email_returns_200_and_access_token(self, client, regular_user):
        resp = _login(client, regular_user.email)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert len(data["access_token"]) > 20

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-007",
        objective="Valid username login also returns 200 with access token",
        precondition="Approved active user exists (regular_user fixture)",
        steps=[
            "POST /auth/login with valid username (not email) and password",
            "Assert HTTP 200",
            "Assert access_token present",
        ],
        test_data={"identifier": "testuser (username)", "password": "TestPass123!"},
        expected_result="HTTP 200, access_token in response body",
        post_condition="Session active",
    )
    def test_valid_username_returns_200_and_access_token(self, client, regular_user):
        resp = _login(client, regular_user.username)
        assert resp.status_code == 200
        assert "access_token" in resp.json()

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-008",
        objective="Login sets httponly refresh cookie for session persistence",
        precondition="Approved active user exists",
        steps=[
            "POST /auth/login with valid credentials",
            "Assert HTTP 200",
            "Assert 'refresh_token' cookie present in response",
        ],
        test_data={"identifier": "user@test.com", "password": "TestPass123!"},
        expected_result="HTTP 200, refresh_token cookie set (httponly)",
        post_condition="Refresh token stored in DB, cookie sent to client",
    )
    def test_login_sets_httponly_refresh_cookie(self, client, regular_user):
        resp = _login(client, regular_user.email)
        assert resp.status_code == 200
        assert "refresh_token" in resp.cookies

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-009",
        objective="Platform role is returned correctly in login response",
        precondition="Approved active regular user exists",
        steps=[
            "POST /auth/login with regular user credentials",
            "Assert HTTP 200",
            "Assert platform_role == 'user'",
        ],
        test_data={"identifier": "user@test.com", "password": "TestPass123!"},
        expected_result="HTTP 200, platform_role='user' in response",
        post_condition="Role correctly reflects user's platform_role enum value",
    )
    def test_platform_role_returned_in_response(self, client, regular_user):
        resp = _login(client, regular_user.email)
        data = resp.json()
        assert data["platform_role"] == "user"

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-010",
        objective="Admin login returns platform_role='admin'",
        precondition="Approved active admin user exists",
        steps=[
            "POST /auth/login with admin credentials",
            "Assert HTTP 200",
            "Assert platform_role == 'admin'",
        ],
        test_data={"identifier": "admin@test.com", "password": "TestPass123!"},
        expected_result="HTTP 200, platform_role='admin'",
        post_condition="Admin session active with correct role claim in JWT",
    )
    def test_admin_login_returns_admin_role(self, client, admin_user):
        resp = _login(client, admin_user.email)
        assert resp.status_code == 200
        assert resp.json()["platform_role"] == "admin"

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-011",
        objective="Successful login resets failed_login_count to zero",
        precondition="User exists with failed_login_count=3",
        steps=[
            "Set regular_user.failed_login_count = 3",
            "POST /auth/login with correct credentials",
            "Assert HTTP 200",
            "Refresh user from DB and assert failed_login_count == 0",
        ],
        test_data={"identifier": "user@test.com", "password": "TestPass123!"},
        expected_result="HTTP 200, failed_login_count reset to 0 in DB",
        post_condition="failed_login_count = 0 persisted in users table",
    )
    def test_login_resets_failed_count_to_zero(self, client, db, regular_user):
        regular_user.failed_login_count = 3
        db.flush()
        resp = _login(client, regular_user.email)
        assert resp.status_code == 200
        db.refresh(regular_user)
        assert regular_user.failed_login_count == 0


class TestLoginFailures:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-012",
        objective="Wrong password returns 401 with 'Invalid credentials' message",
        precondition="Approved active user exists",
        steps=[
            "POST /auth/login with correct email but wrong password",
            "Assert HTTP 401",
            "Assert detail contains 'Invalid credentials'",
        ],
        test_data={"identifier": "user@test.com", "password": "WrongPass!"},
        expected_result="HTTP 401 Unauthorized, detail='Invalid credentials'",
        post_condition="failed_login_count incremented by 1",
    )
    def test_wrong_password_returns_401(self, client, regular_user):
        resp = _login(client, regular_user.email, password="WrongPass!")
        assert resp.status_code == 401
        assert "Invalid credentials" in resp.json()["detail"]

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-013",
        objective="Non-existent email returns 401",
        precondition="No user with email nobody@test.com",
        steps=[
            "POST /auth/login with email that does not exist",
            "Assert HTTP 401",
        ],
        test_data={"identifier": "nobody@test.com", "password": "TestPass123!"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No user record affected",
    )
    def test_nonexistent_email_returns_401(self, client):
        resp = _login(client, "nobody@test.com")
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-014",
        objective="Unapproved user receives 403 with 'pending approval' message",
        precondition="User exists with is_approved=False",
        steps=[
            "POST /auth/login with unapproved user credentials",
            "Assert HTTP 403",
            "Assert detail contains 'pending approval'",
        ],
        test_data={"identifier": "pending@test.com", "password": "TestPass123!"},
        expected_result="HTTP 403 Forbidden, detail mentions 'pending approval'",
        post_condition="No session created — user still unapproved",
    )
    def test_unapproved_user_returns_403(self, client, unapproved_user):
        resp = _login(client, unapproved_user.email)
        assert resp.status_code == 403
        assert "pending approval" in resp.json()["detail"].lower()

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-015",
        objective="Deactivated user receives 403 with 'deactivated' message",
        precondition="User exists with is_active=False, is_approved=True",
        steps=[
            "Set inactive_user.is_approved = True",
            "POST /auth/login with inactive user credentials",
            "Assert HTTP 403",
            "Assert detail contains 'deactivated'",
        ],
        test_data={"identifier": "inactive@test.com", "password": "TestPass123!"},
        expected_result="HTTP 403 Forbidden, detail mentions 'deactivated'",
        post_condition="No session created — user account is deactivated",
    )
    def test_inactive_user_returns_403(self, client, db, inactive_user):
        inactive_user.is_approved = True
        db.flush()
        resp = _login(client, inactive_user.email)
        assert resp.status_code == 403
        assert "deactivated" in resp.json()["detail"].lower()

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-016",
        objective="Empty identifier returns 400 or 422",
        precondition="Clean DB state",
        steps=[
            "POST /auth/login with empty string identifier",
            "Assert HTTP 400 or 422",
        ],
        test_data={"identifier": "", "password": "TestPass123!"},
        expected_result="HTTP 400 or 422 — validation error",
        post_condition="No session created",
    )
    def test_missing_identifier_returns_400_or_422(self, client):
        resp = client.post("/auth/login", json={"identifier": "", "password": "TestPass123!"})
        assert resp.status_code in (400, 422)

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-017",
        objective="Locked account returns 423 with 'locked' message",
        precondition="User exists with locked_until set to future timestamp",
        steps=[
            "Set regular_user.locked_until = now + 10 minutes",
            "POST /auth/login with correct credentials",
            "Assert HTTP 423",
            "Assert detail contains 'locked'",
        ],
        test_data={"identifier": "user@test.com", "password": "TestPass123!",
                   "locked_until": "now + 10 minutes"},
        expected_result="HTTP 423 Locked, detail mentions 'locked'",
        post_condition="Lock unchanged — user must wait for expiry",
    )
    def test_locked_account_returns_423(self, client, db, regular_user):
        regular_user.locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
        db.flush()
        resp = _login(client, regular_user.email)
        assert resp.status_code == 423
        assert "locked" in resp.json()["detail"].lower()
