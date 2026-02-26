"""
Integration Tests — POST /auth/refresh

Covers: valid refresh cookie → new token, missing cookie → 401,
        revoked token → 401, token_version mismatch → 401, cookie rotation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Authentication — Token Refresh"),
    pytest.mark.integration,
    pytest.mark.auth,
]

from tests.conftest import CSRF_HEADERS


def _do_login(client, user):
    resp = client.post("/auth/login", json={"identifier": user.email, "password": "TestPass123!"})
    assert resp.status_code == 200
    return resp


class TestRefreshSuccess:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-018",
        objective="Valid refresh cookie yields new access token",
        precondition="User is logged in — refresh cookie set in client",
        steps=[
            "POST /auth/login to set refresh cookie",
            "POST /auth/refresh with Origin header",
            "Assert HTTP 200",
            "Assert access_token present in response",
        ],
        test_data={"origin": "http://localhost:5173"},
        expected_result="HTTP 200, new access_token returned",
        post_condition="New refresh cookie issued, old one rotated",
    )
    def test_valid_refresh_cookie_returns_new_access_token(self, client, regular_user):
        _do_login(client, regular_user)
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code == 200
        data = resp.json()
        assert "access_token" in data
        assert len(data["access_token"]) > 20

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-019",
        objective="Refresh rotates the refresh cookie (new value each time)",
        precondition="User is logged in — refresh cookie set",
        steps=[
            "POST /auth/login to set refresh cookie",
            "Capture old cookie value",
            "POST /auth/refresh",
            "Capture new cookie value",
            "Assert new != old",
        ],
        test_data={"origin": "http://localhost:5173"},
        expected_result="New refresh cookie value differs from old one",
        post_condition="Old refresh token invalidated, new one stored in DB",
    )
    def test_refresh_rotates_cookie(self, client, regular_user):
        _do_login(client, regular_user)
        old_cookie = client.cookies.get("refresh_token")
        client.post("/auth/refresh", headers=CSRF_HEADERS)
        new_cookie = client.cookies.get("refresh_token")
        assert new_cookie is not None
        assert new_cookie != old_cookie


class TestRefreshFailures:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-020",
        objective="Missing refresh cookie returns 401 with 'Missing refresh token' detail",
        precondition="No refresh cookie in client jar",
        steps=[
            "POST /auth/refresh without any cookies",
            "Assert HTTP 401",
            "Assert detail contains 'Missing refresh token'",
        ],
        test_data={"cookies": "none"},
        expected_result="HTTP 401 Unauthorized, detail='Missing refresh token'",
        post_condition="No session changes",
    )
    def test_missing_cookie_returns_401(self, client):
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code == 401
        assert "Missing refresh token" in resp.json()["detail"]

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-021",
        objective="Invalid/fake refresh cookie returns 401",
        precondition="Client has a fake refresh_token cookie value",
        steps=[
            "Set refresh_token cookie to 'totally-fake-token-value'",
            "POST /auth/refresh",
            "Assert HTTP 401",
        ],
        test_data={"refresh_token": "totally-fake-token-value"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No session changes",
    )
    def test_invalid_cookie_value_returns_401(self, client):
        client.cookies.set("refresh_token", "totally-fake-token-value")
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-022",
        objective="token_version mismatch (simulated logout-all) invalidates old cookie",
        precondition="User is logged in; token_version bumped server-side after cookie issued",
        steps=[
            "POST /auth/login to obtain refresh cookie",
            "Increment user.token_version in DB to simulate logout-all",
            "POST /auth/refresh with old cookie",
            "Assert HTTP 401",
        ],
        test_data={"token_version_delta": "+1"},
        expected_result="HTTP 401 — refresh token from old family rejected",
        post_condition="Old session invalidated, user must log in again",
    )
    def test_token_version_mismatch_returns_401(self, client, db, regular_user):
        _do_login(client, regular_user)
        regular_user.token_version = (regular_user.token_version or 1) + 1
        db.flush()
        resp = client.post("/auth/refresh", headers=CSRF_HEADERS)
        assert resp.status_code == 401
