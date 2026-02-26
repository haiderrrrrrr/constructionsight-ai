"""
Security Tests — Cross-cutting authorization enforcement.

Verifies: admin routes return 403 for regular users, authenticated routes
          return 401 for missing/malformed tokens, token version invalidation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("Authorization — 401/403 Enforcement"),
    pytest.mark.security,
]

from tests.conftest import CSRF_HEADERS

ADMIN_ONLY_GET = [
    "/admin/users",
    "/admin/users/stats",
    "/admin/cameras",
    "/admin/invitations",
    "/admin/sites",
    "/admin/notifications",
    "/admin/ml-config",
    "/admin/risk/scheduler/status",
]

AUTH_REQUIRED_GET = [
    "/users/me",
    "/projects",
    "/notifications",
    "/invitations/me",
]


class TestAdminRoutesReturnForbiddenForUsers:
    @pytest.mark.testcase(
        tc_id="TC-SEC-030",
        objective="Regular user gets 403 on admin GET endpoints",
        precondition="regular_user authenticated with platform_role='user'",
        steps=[
            "Parametrize over /admin/users, /admin/users/stats, /admin/cameras",
            "GET each path with user_headers",
            "Assert HTTP 403",
        ],
        test_data={"paths": "/admin/users, /admin/users/stats, /admin/cameras"},
        expected_result="HTTP 403 Forbidden for all admin GET routes",
        post_condition="No data exposed",
    )
    @pytest.mark.parametrize("path", ADMIN_ONLY_GET)
    def test_regular_user_gets_403_on_admin_get(self, client, user_headers, path):
        resp = client.get(path, headers=user_headers)
        assert resp.status_code == 403, f"Expected 403 on GET {path}, got {resp.status_code}"

    @pytest.mark.testcase(
        tc_id="TC-SEC-031",
        objective="Regular user gets 403 on POST /admin/projects",
        precondition="regular_user authenticated; POST /admin/projects requires admin",
        steps=["POST /admin/projects with user_headers", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No project created",
    )
    def test_regular_user_gets_403_on_create_project(self, client, user_headers):
        resp = client.post(
            "/admin/projects",
            json={"name": "X", "location": "Y", "pm_email": "pm@x.com", "pm_full_name": "PM"},
            headers=user_headers,
        )
        assert resp.status_code == 403


class TestUnauthenticatedReturns401:
    @pytest.mark.testcase(
        tc_id="TC-SEC-032",
        objective="All authenticated GET routes return 401 with no token",
        precondition="No Authorization header",
        steps=[
            "Parametrize over /users/me, /projects, /notifications, /invitations/me",
            "GET each path without auth header",
            "Assert HTTP 401",
        ],
        test_data={"paths": "/users/me, /projects, /notifications, /invitations/me"},
        expected_result="HTTP 401 for all authenticated routes without token",
        post_condition="No data exposed",
    )
    @pytest.mark.parametrize("path", AUTH_REQUIRED_GET)
    def test_no_token_returns_401(self, client, path):
        resp = client.get(path)
        assert resp.status_code == 401, f"Expected 401 on GET {path}, got {resp.status_code}"

    @pytest.mark.testcase(
        tc_id="TC-SEC-033",
        objective="Malformed bearer token returns 401",
        precondition="Authorization: Bearer not.a.real.jwt.token",
        steps=["GET /users/me with invalid JWT", "Assert HTTP 401"],
        test_data={"token": "not.a.real.jwt.token"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_malformed_bearer_token_returns_401(self, client):
        headers = {"Authorization": "Bearer not.a.real.jwt.token"}
        resp = client.get("/users/me", headers=headers)
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-034",
        objective="Token without 'Bearer ' prefix returns 401",
        precondition="Authorization header set to raw token string (no Bearer prefix)",
        steps=["GET /users/me with token but no 'Bearer ' prefix", "Assert HTTP 401"],
        test_data={"Authorization": "<token-without-prefix>"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_missing_bearer_prefix_returns_401(self, client, regular_user):
        from tests.conftest import _token_for
        token = _token_for(regular_user)
        headers = {"Authorization": token}
        resp = client.get("/users/me", headers=headers)
        assert resp.status_code == 401


class TestTokenVersionInvalidation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-035",
        objective="Old token rejected after token_version bump (simulates logout-all)",
        precondition="Valid token issued; token_version bumped server-side afterwards",
        steps=[
            "Issue token with current token_version",
            "Bump regular_user.token_version in DB",
            "GET /users/me with old token",
            "Assert HTTP 401",
        ],
        test_data={"token_version": "stale"},
        expected_result="HTTP 401 — token family revoked",
        post_condition="Session invalidated across all devices",
    )
    def test_old_token_rejected_after_token_version_bump(self, client, db, regular_user):
        from tests.conftest import _token_for
        old_token = _token_for(regular_user)
        regular_user.token_version = (regular_user.token_version or 1) + 1
        db.flush()
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {old_token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-036",
        objective="New token issued after version bump is accepted",
        precondition="Token issued with bumped token_version",
        steps=[
            "Bump regular_user.token_version",
            "Issue new token for regular_user",
            "GET /users/me",
            "Assert HTTP 200",
        ],
        test_data={"token_version": "current (bumped)"},
        expected_result="HTTP 200 — new token valid",
        post_condition="User can still access resources with new token",
    )
    def test_new_token_accepted_after_version_bump(self, client, db, regular_user):
        from tests.conftest import _token_for
        regular_user.token_version = (regular_user.token_version or 1) + 1
        db.flush()
        new_token = _token_for(regular_user)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {new_token}"})
        assert resp.status_code == 200
