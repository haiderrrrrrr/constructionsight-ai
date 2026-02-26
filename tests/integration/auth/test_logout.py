"""
Integration Tests — POST /auth/logout and POST /auth/logout-all

Covers: logout clears cookie, logout without cookie succeeds, logout-all
        increments token_version, old access token rejected after logout-all.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Authentication — Logout"),
    pytest.mark.integration,
    pytest.mark.auth,
]

from tests.conftest import CSRF_HEADERS, _auth_headers


def _do_login(client, user):
    resp = client.post("/auth/login", json={"identifier": user.email, "password": "TestPass123!"})
    assert resp.status_code == 200
    return resp.json()["access_token"]


class TestLogout:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-023",
        objective="Logout returns {ok: true} HTTP 200",
        precondition="User is logged in with valid refresh cookie",
        steps=[
            "POST /auth/login to set refresh cookie",
            "POST /auth/logout with Origin header",
            "Assert HTTP 200",
            "Assert response body {ok: true}",
        ],
        test_data={"origin": "http://localhost:5173"},
        expected_result="HTTP 200, {ok: true}",
        post_condition="Refresh token record deleted from DB, cookie cleared",
    )
    def test_logout_returns_ok_true(self, client, regular_user):
        _do_login(client, regular_user)
        resp = client.post("/auth/logout", headers=CSRF_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-024",
        objective="After logout, refresh endpoint returns 401 (cookie cleared)",
        precondition="User is logged in",
        steps=[
            "POST /auth/login",
            "POST /auth/logout",
            "POST /auth/refresh",
            "Assert HTTP 401 on refresh",
        ],
        test_data={"origin": "http://localhost:5173"},
        expected_result="Refresh returns HTTP 401 after logout",
        post_condition="Session fully terminated",
    )
    def test_logout_clears_refresh_cookie(self, client, regular_user):
        _do_login(client, regular_user)
        client.post("/auth/logout", headers=CSRF_HEADERS)
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-025",
        objective="Logout without a cookie still returns {ok: true} (idempotent)",
        precondition="No refresh cookie in client",
        steps=[
            "POST /auth/logout without any cookies",
            "Assert HTTP 200",
            "Assert {ok: true}",
        ],
        test_data={"cookies": "none"},
        expected_result="HTTP 200, {ok: true} — logout is idempotent",
        post_condition="No state changed",
    )
    def test_logout_without_cookie_still_returns_ok(self, client):
        resp = client.post("/auth/logout", headers=CSRF_HEADERS)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True


class TestLogoutAll:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-026",
        objective="Logout-all returns {ok: true} HTTP 200",
        precondition="User is logged in with valid access token",
        steps=[
            "POST /auth/login to get access token",
            "POST /auth/logout-all with Bearer token and Origin header",
            "Assert HTTP 200 and {ok: true}",
        ],
        test_data={"Authorization": "Bearer <valid_token>"},
        expected_result="HTTP 200, {ok: true}",
        post_condition="token_version incremented — all existing tokens invalidated",
    )
    def test_logout_all_returns_ok_true(self, client, regular_user):
        token = _do_login(client, regular_user)
        headers = {**CSRF_HEADERS, "Authorization": f"Bearer {token}"}
        resp = client.post("/auth/logout-all", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-027",
        objective="Logout-all increments user token_version by 1",
        precondition="User is logged in; token_version recorded before operation",
        steps=[
            "Record user.token_version before logout-all",
            "POST /auth/login to get access token",
            "POST /auth/logout-all with token",
            "Refresh user from DB",
            "Assert token_version == original + 1",
        ],
        test_data={"expected_delta": "+1"},
        expected_result="token_version incremented by exactly 1",
        post_condition="All refresh tokens from old family are invalid",
    )
    def test_logout_all_increments_token_version(self, client, db, regular_user):
        original_version = regular_user.token_version
        token = _do_login(client, regular_user)
        headers = {**CSRF_HEADERS, "Authorization": f"Bearer {token}"}
        client.post("/auth/logout-all", headers=headers)
        db.refresh(regular_user)
        assert regular_user.token_version == original_version + 1

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-028",
        objective="Old access token is rejected by GET /users/me after logout-all",
        precondition="User has a valid access token",
        steps=[
            "POST /auth/login to get access token",
            "POST /auth/logout-all",
            "GET /users/me with the old access token",
            "Assert HTTP 401",
        ],
        test_data={"old_token": "<captured before logout-all>"},
        expected_result="HTTP 401 — old token rejected after token_version bump",
        post_condition="Session fully invalidated across all devices",
    )
    def test_old_token_rejected_after_logout_all(self, client, regular_user):
        token = _do_login(client, regular_user)
        headers = {**CSRF_HEADERS, "Authorization": f"Bearer {token}"}
        client.post("/auth/logout-all", headers=headers)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-029",
        objective="Logout-all without valid token returns 401",
        precondition="No valid Bearer token",
        steps=[
            "POST /auth/logout-all with fake Bearer token",
            "Assert HTTP 401",
        ],
        test_data={"Authorization": "Bearer fake.token.here"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No token_version change",
    )
    def test_logout_all_requires_valid_token(self, client):
        resp = client.post("/auth/logout-all",
                           headers={**CSRF_HEADERS, "Authorization": "Bearer fake.token.here"})
        assert resp.status_code == 401
