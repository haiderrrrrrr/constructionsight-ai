"""
Security edge-case tests — authentication & authorization attack vectors.

Covers: IDOR, JWT role escalation, token version invalidation,
        account state enforcement, CSRF enforcement, input validation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("Auth — Edge Cases & Attack Vectors"),
    pytest.mark.security,
]

from datetime import datetime, timedelta, timezone
from jose import jwt

from app.core.config import settings
from app.core.security import create_access_token
from tests.conftest import _make_user, make_project, make_site, CSRF_HEADERS


def _forge_token(sub: str, platform_role: str, token_version: int = 1,
                 secret: str = None, audience: str = None, issuer: str = None) -> str:
    payload = {
        "sub": sub,
        "platform_role": platform_role,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
        "iat": int(datetime.now(timezone.utc).timestamp()),
        "iss": issuer or settings.jwt_issuer,
        "aud": audience or settings.jwt_audience,
        "jti": "attack-token-jti",
        "ver": token_version,
    }
    return jwt.encode(
        payload,
        secret or settings.jwt_secret,
        algorithm=settings.jwt_algorithm,
    )


class TestRoleEscalation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-001",
        objective="Forged admin token (wrong secret) is rejected with 401",
        precondition="Attacker has regular_user's ID; uses wrong signing secret",
        steps=[
            "Forge JWT with platform_role='admin' using wrong secret",
            "GET /admin/users with forged token",
            "Assert HTTP 401",
        ],
        test_data={"platform_role": "admin (forged)", "secret": "attacker-guessed-wrong"},
        expected_result="HTTP 401 — signature verification failed",
        post_condition="No data exposed",
    )
    def test_user_with_forged_admin_role_is_rejected(self, client, db, regular_user):
        evil_token = _forge_token(
            sub=str(regular_user.id),
            platform_role="admin",
            secret="wrong-secret-that-attacker-guesses-32ch!",
        )
        resp = client.get("/admin/users", headers={"Authorization": f"Bearer {evil_token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-002",
        objective="Valid user token cannot access admin routes (403)",
        precondition="regular_user has platform_role='user'",
        steps=["GET /admin/users with valid user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_valid_user_token_cannot_access_admin_routes(self, client, user_headers):
        resp = client.get("/admin/users", headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-SEC-003",
        objective="Valid user token cannot create a project (403)",
        precondition="regular_user authenticated; POST /admin/projects requires admin",
        steps=["POST /admin/projects with user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No project created",
    )
    def test_valid_user_token_cannot_create_project(self, client, user_headers):
        resp = client.post(
            "/admin/projects",
            json={"name": "Hack Project", "location": "X", "pm_email": "x@x.com", "pm_full_name": "X"},
            headers=user_headers,
        )
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-SEC-004",
        objective="Valid user token cannot list cameras (403)",
        precondition="regular_user authenticated; GET /admin/cameras requires admin",
        steps=["GET /admin/cameras with user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_valid_user_token_cannot_list_cameras(self, client, user_headers):
        resp = client.get("/admin/cameras", headers=user_headers)
        assert resp.status_code == 403


class TestIDOR:
    @pytest.mark.testcase(
        tc_id="TC-SEC-005",
        objective="User cannot access another user's project (IDOR)",
        precondition="regular_user is NOT a member of the project",
        steps=[
            "Create project owned by admin_user",
            "GET /projects/{id} as regular_user (non-member)",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404 — IDOR blocked",
        post_condition="No data exposed",
    )
    def test_user_cannot_access_another_users_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Private Project IDOR", location="Oslo",
                               created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-SEC-006",
        objective="User cannot list tasks of a foreign project (IDOR)",
        precondition="regular_user is NOT a member of the project",
        steps=[
            "Create project owned by admin_user",
            "GET /projects/{id}/tasks as regular_user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_user_cannot_list_tasks_of_foreign_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Foreign Tasks Project", location="Vienna",
                               created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/tasks", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-SEC-007",
        objective="User cannot read notes of a foreign project (IDOR)",
        precondition="regular_user is NOT a member of the project",
        steps=[
            "Create project owned by admin_user",
            "GET /projects/{id}/notes as regular_user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_user_cannot_read_notes_of_foreign_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Foreign Notes Project", location="Warsaw",
                               created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/notes", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-SEC-008",
        objective="User cannot read PPE data of a foreign project (IDOR)",
        precondition="regular_user is NOT a member of the project",
        steps=[
            "Create project owned by admin_user",
            "GET /projects/{id}/ppe/summary as regular_user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_user_cannot_read_ppe_of_foreign_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Foreign PPE Project", location="Riga",
                               created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/ppe/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-SEC-009",
        objective="User cannot read workforce data of a foreign project (IDOR)",
        precondition="regular_user is NOT a member of the project",
        steps=[
            "Create project owned by admin_user",
            "GET /projects/{id}/workforce/summary as regular_user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_user_cannot_read_workforce_of_foreign_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Foreign WF Project", location="Tallinn",
                               created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/workforce/summary", headers=user_headers)
        assert resp.status_code in (403, 404)


class TestTokenVersionInvalidation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-010",
        objective="Stale token (old token_version) is rejected after logout-all",
        precondition="regular_user's token_version bumped server-side after token issued",
        steps=[
            "Issue token with current token_version",
            "Bump regular_user.token_version in DB",
            "GET /users/me with old token",
            "Assert HTTP 401",
        ],
        test_data={"token_version": "stale (bumped server-side)"},
        expected_result="HTTP 401 — stale token rejected",
        post_condition="Session hijack prevented",
    )
    def test_stale_token_version_is_rejected(self, client, db, regular_user):
        old_token = create_access_token(
            str(regular_user.id), "user", token_version=regular_user.token_version
        )
        regular_user.token_version = (regular_user.token_version or 1) + 1
        db.flush()
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {old_token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-011",
        objective="Token with ver=0 is rejected (minimum valid version is 1)",
        precondition="Forged token with ver=0",
        steps=[
            "Forge JWT with ver=0 using correct secret",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"ver": 0},
        expected_result="HTTP 401 — version 0 always mismatches real token_version",
        post_condition="No data exposed",
    )
    def test_token_version_zero_mismatch_is_rejected(self, client, db, regular_user):
        zero_token = _forge_token(
            sub=str(regular_user.id),
            platform_role="user",
            token_version=0,
        )
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {zero_token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-012",
        objective="Token with far-future ver=9999 is rejected",
        precondition="Forged token with ver=9999",
        steps=[
            "Forge JWT with ver=9999",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"ver": 9999},
        expected_result="HTTP 401 — ver=9999 never matches real token_version",
        post_condition="No data exposed",
    )
    def test_future_token_version_is_rejected(self, client, db, regular_user):
        future_token = _forge_token(
            sub=str(regular_user.id),
            platform_role="user",
            token_version=9999,
        )
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {future_token}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-013",
        objective="New token issued after version bump is accepted",
        precondition="regular_user.token_version bumped; new token issued with new version",
        steps=[
            "Bump regular_user.token_version",
            "Issue new token with updated version",
            "GET /users/me",
            "Assert HTTP 200",
        ],
        test_data={"token_version": "bumped + new token"},
        expected_result="HTTP 200 — new token valid",
        post_condition="Session continues with new token family",
    )
    def test_new_token_after_version_bump_is_accepted(self, client, db, regular_user):
        regular_user.token_version = (regular_user.token_version or 1) + 1
        db.flush()
        new_token = create_access_token(
            str(regular_user.id), "user", token_version=regular_user.token_version
        )
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {new_token}"})
        assert resp.status_code == 200


class TestAccountStateEnforcement:
    @pytest.mark.testcase(
        tc_id="TC-SEC-014",
        objective="Inactive user token is rejected with 403",
        precondition="User exists with is_active=False",
        steps=[
            "Create user with is_active=False",
            "Issue valid JWT for that user",
            "GET /users/me",
            "Assert HTTP 403",
        ],
        test_data={"is_active": False},
        expected_result="HTTP 403 — inactive user blocked",
        post_condition="No data exposed",
    )
    def test_inactive_user_token_is_rejected(self, client, db):
        user = _make_user(db, email="inactive_sec@test.com", username="inactive_sec",
                          is_active=False, is_approved=True)
        token = create_access_token(str(user.id), "user", token_version=user.token_version)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-SEC-015",
        objective="Unapproved user token is rejected with 403",
        precondition="User exists with is_approved=False",
        steps=[
            "Create user with is_approved=False",
            "Issue valid JWT for that user",
            "GET /users/me",
            "Assert HTTP 403",
        ],
        test_data={"is_approved": False},
        expected_result="HTTP 403 — unapproved user blocked",
        post_condition="No data exposed",
    )
    def test_unapproved_user_token_is_rejected(self, client, db):
        user = _make_user(db, email="unapproved_sec@test.com", username="unapproved_sec",
                          is_active=True, is_approved=False)
        token = create_access_token(str(user.id), "user", token_version=user.token_version)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-SEC-016",
        objective="Token for a deleted/non-existent user ID returns 401 or 404",
        precondition="JWT with sub='999999999' (no matching user in DB)",
        steps=[
            "Forge JWT with sub='999999999'",
            "GET /users/me",
            "Assert HTTP 401 or 404",
        ],
        test_data={"sub": "999999999 (ghost user)"},
        expected_result="HTTP 401 or 404 — user not found",
        post_condition="No data exposed",
    )
    def test_deleted_user_id_in_token_returns_error(self, client):
        ghost_token = _forge_token(sub="999999999", platform_role="user")
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {ghost_token}"})
        assert resp.status_code in (401, 404)


class TestMalformedTokens:
    @pytest.mark.testcase(
        tc_id="TC-SEC-017",
        objective="No Authorization header returns 401",
        precondition="Request sent without any Authorization header",
        steps=["GET /users/me with no header", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_no_authorization_header_returns_401(self, client):
        resp = client.get("/users/me")
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-018",
        objective="Empty bearer value returns 401",
        precondition="Authorization: Bearer <empty>",
        steps=["GET /users/me with 'Bearer ' (no token)", "Assert HTTP 401"],
        test_data={"Authorization": "Bearer (empty)"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_empty_bearer_value_returns_401(self, client):
        resp = client.get("/users/me", headers={"Authorization": "Bearer "})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-019",
        objective="Random garbage JWT token returns 401",
        precondition="Authorization: Bearer garbage.token.here",
        steps=["GET /users/me with garbage token", "Assert HTTP 401"],
        test_data={"token": "garbage.token.here"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_random_garbage_token_returns_401(self, client):
        resp = client.get("/users/me", headers={"Authorization": "Bearer garbage.token.here"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-020",
        objective="Expired token returns 401",
        precondition="Token issued with expires_minutes=-5 (already expired)",
        steps=[
            "create_access_token with expires_minutes=-5",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"expires_minutes": -5},
        expected_result="HTTP 401 — expired token rejected",
        post_condition="No data exposed",
    )
    def test_expired_token_returns_401(self, client, regular_user):
        expired = create_access_token(str(regular_user.id), "user", expires_minutes=-5)
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {expired}"})
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-SEC-021",
        objective="Token signed with wrong secret returns 401",
        precondition="JWT encoded with secret 'wrong-secret-32-chars-minimum!!!'",
        steps=[
            "Manually encode JWT with wrong secret",
            "GET /users/me",
            "Assert HTTP 401",
        ],
        test_data={"secret": "wrong-secret-32-chars-minimum!!!"},
        expected_result="HTTP 401 — signature mismatch",
        post_condition="No data exposed",
    )
    def test_token_signed_with_wrong_secret_returns_401(self, client, regular_user):
        evil = jwt.encode(
            {
                "sub": str(regular_user.id),
                "platform_role": "user",
                "exp": datetime.now(timezone.utc) + timedelta(minutes=30),
                "iat": int(datetime.now(timezone.utc).timestamp()),
                "iss": settings.jwt_issuer,
                "aud": settings.jwt_audience,
                "jti": "evil-jti",
                "ver": regular_user.token_version,
            },
            "wrong-secret-32-chars-minimum!!!",
            algorithm="HS256",
        )
        resp = client.get("/users/me", headers={"Authorization": f"Bearer {evil}"})
        assert resp.status_code == 401


class TestCsrfEnforcement:
    @pytest.mark.testcase(
        tc_id="TC-SEC-022",
        objective="Refresh endpoint without cookie returns 401/403/422",
        precondition="No httponly refresh cookie; no origin header",
        steps=["POST /auth/refresh with no cookie or origin", "Assert HTTP 401/403/422"],
        test_data={"cookie": "none", "origin": "none"},
        expected_result="HTTP 401, 403, or 422",
        post_condition="No token issued",
    )
    def test_refresh_without_origin_header_is_blocked(self, client):
        resp = client.post("/auth/refresh")
        assert resp.status_code in (401, 403, 422)

    @pytest.mark.testcase(
        tc_id="TC-SEC-023",
        objective="Logout-all without bearer token returns 401",
        precondition="No Authorization header",
        steps=["POST /auth/logout-all with CSRF_HEADERS only", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No session revoked",
    )
    def test_logout_all_without_token_returns_401(self, client):
        resp = client.post("/auth/logout-all", headers=CSRF_HEADERS)
        assert resp.status_code == 401


class TestInputValidation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-024",
        objective="SQL injection in login identifier returns 400/401/422, not 500",
        precondition="Attacker submits SQL injection string as identifier",
        steps=[
            "POST /auth/login with identifier=\"' OR '1'='1\"",
            "Assert HTTP 400/401/422",
            "Assert HTTP != 500",
        ],
        test_data={"identifier": "' OR '1'='1", "password": "' OR '1'='1"},
        expected_result="HTTP 400/401/422 — not 500",
        post_condition="No data leak; no crash",
    )
    def test_sql_injection_in_login_identifier_does_not_crash(self, client):
        resp = client.post(
            "/auth/login",
            json={"identifier": "' OR '1'='1", "password": "' OR '1'='1"},
        )
        assert resp.status_code in (400, 401, 422)
        assert resp.status_code != 500

    @pytest.mark.testcase(
        tc_id="TC-SEC-025",
        objective="Oversized login payload returns 400/401/422, not 500",
        precondition="Attacker sends 10,000-character identifier and password",
        steps=[
            "POST /auth/login with 10000-char strings",
            "Assert HTTP 400/401/422",
            "Assert HTTP != 500",
        ],
        test_data={"identifier": "a * 10000", "password": "b * 10000"},
        expected_result="HTTP 400/401/422 — no crash",
        post_condition="No data leak",
    )
    def test_oversized_login_payload_does_not_crash(self, client):
        resp = client.post(
            "/auth/login",
            json={"identifier": "a" * 10_000, "password": "b" * 10_000},
        )
        assert resp.status_code in (400, 401, 422)
        assert resp.status_code != 500

    @pytest.mark.testcase(
        tc_id="TC-SEC-026",
        objective="Login with missing password field returns 422",
        precondition="Request body has identifier but no password",
        steps=["POST /auth/login without password", "Assert HTTP 422"],
        test_data={"password": "missing"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No state change",
    )
    def test_login_with_missing_password_returns_422(self, client):
        resp = client.post("/auth/login", json={"identifier": "user@example.com"})
        assert resp.status_code == 422

    @pytest.mark.testcase(
        tc_id="TC-SEC-027",
        objective="Login with missing identifier field returns 422",
        precondition="Request body has password but no identifier",
        steps=["POST /auth/login without identifier", "Assert HTTP 422"],
        test_data={"identifier": "missing"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No state change",
    )
    def test_login_with_missing_identifier_returns_422(self, client):
        resp = client.post("/auth/login", json={"password": "SomePass123!"})
        assert resp.status_code == 422
