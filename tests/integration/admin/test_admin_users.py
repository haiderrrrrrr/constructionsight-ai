"""
Integration Tests — /admin/users endpoints

Covers: list users, stats, approve/unapprove, activate/deactivate,
        role change, force-logout — all admin-only.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — User Management"),
    pytest.mark.integration,
    pytest.mark.admin,
]

from tests.conftest import _make_user
from app.models.user import PlatformRole


class TestListUsers:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-001",
        objective="Admin can list all users — returns list",
        precondition="Admin authenticated; at least one user exists",
        steps=[
            "GET /admin/users with admin Bearer token",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"role": "admin"},
        expected_result="HTTP 200, JSON array of user objects",
        post_condition="No state change",
    )
    def test_admin_can_list_users(self, client, admin_headers, regular_user):
        resp = client.get("/admin/users", headers=admin_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-002",
        objective="Regular user cannot list users (403)",
        precondition="Regular (non-admin) user authenticated",
        steps=[
            "GET /admin/users with regular user token",
            "Assert HTTP 403 Forbidden",
        ],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_regular_user_cannot_list_users(self, client, user_headers):
        resp = client.get("/admin/users", headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-003",
        objective="Unauthenticated request to list users returns 401",
        precondition="No Authorization header",
        steps=[
            "GET /admin/users with no token",
            "Assert HTTP 401 Unauthorized",
        ],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_users(self, client):
        resp = client.get("/admin/users")
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-004",
        objective="Listed users include the regular_user fixture",
        precondition="regular_user fixture exists; admin authenticated",
        steps=[
            "GET /admin/users",
            "Extract ids from response",
            "Assert regular_user.id in ids",
        ],
        test_data={"expected_id": "<regular_user.id>"},
        expected_result="regular_user present in list",
        post_condition="No state change",
    )
    def test_list_includes_created_user(self, client, admin_headers, regular_user):
        resp = client.get("/admin/users", headers=admin_headers)
        ids = [u["id"] for u in resp.json()]
        assert regular_user.id in ids


class TestUserStats:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-005",
        objective="Admin user stats endpoint returns expected keys",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/users/stats",
            "Assert HTTP 200",
            "Assert keys: active, inactive, pending, admins present",
        ],
        test_data={"endpoint": "/admin/users/stats"},
        expected_result="HTTP 200, dict with active/inactive/pending/admins keys",
        post_condition="No state change",
    )
    def test_admin_gets_stats(self, client, admin_headers):
        resp = client.get("/admin/users/stats", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "active" in data
        assert "inactive" in data
        assert "pending" in data
        assert "admins" in data

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-006",
        objective="All stat values are integers",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/users/stats",
            "For each key in response, assert value is int",
        ],
        test_data={"expected_type": "int"},
        expected_result="All stat values are integers",
        post_condition="No state change",
    )
    def test_stats_counts_are_integers(self, client, admin_headers):
        resp = client.get("/admin/users/stats", headers=admin_headers)
        for key, val in resp.json().items():
            assert isinstance(val, int), f"{key} should be int"

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-007",
        objective="Regular user cannot access stats (403)",
        precondition="Regular user authenticated",
        steps=[
            "GET /admin/users/stats with regular user token",
            "Assert HTTP 403",
        ],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_user_cannot_get_stats(self, client, user_headers):
        resp = client.get("/admin/users/stats", headers=user_headers)
        assert resp.status_code == 403


class TestApproveUser:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-008",
        objective="Admin can approve a pending user — is_approved becomes True",
        precondition="Unapproved user exists; admin authenticated",
        steps=[
            "PATCH /admin/users/{id}/approve",
            "Assert HTTP 200",
            "Assert is_approved == True in response",
        ],
        test_data={"action": "approve"},
        expected_result="HTTP 200, is_approved=True",
        post_condition="User can now log in",
    )
    def test_admin_can_approve_pending_user(self, client, db, admin_headers, unapproved_user):
        resp = client.patch(f"/admin/users/{unapproved_user.id}/approve", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_approved"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-009",
        objective="Admin can unapprove (toggle) an already-approved user",
        precondition="Approved regular user exists; admin authenticated",
        steps=[
            "PATCH /admin/users/{id}/approve on approved user",
            "Assert HTTP 200",
            "Assert is_approved == False",
        ],
        test_data={"action": "toggle approval off"},
        expected_result="HTTP 200, is_approved=False",
        post_condition="User can no longer log in",
    )
    def test_admin_can_unapprove_user(self, client, db, admin_headers, regular_user):
        resp = client.patch(f"/admin/users/{regular_user.id}/approve", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_approved"] is False

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-010",
        objective="Approving non-existent user returns 404",
        precondition="No user with id=999999",
        steps=[
            "PATCH /admin/users/999999/approve",
            "Assert HTTP 404",
        ],
        test_data={"id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_approve_nonexistent_user_returns_404(self, client, admin_headers):
        resp = client.patch("/admin/users/999999/approve", headers=admin_headers)
        assert resp.status_code == 404

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-011",
        objective="Regular user cannot approve another user (403)",
        precondition="Regular user authenticated; unapproved user exists",
        steps=[
            "PATCH /admin/users/{id}/approve with regular user token",
            "Assert HTTP 403",
        ],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No approval change",
    )
    def test_user_cannot_approve(self, client, user_headers, unapproved_user):
        resp = client.patch(f"/admin/users/{unapproved_user.id}/approve", headers=user_headers)
        assert resp.status_code == 403


class TestActivateUser:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-012",
        objective="Admin can deactivate an active user — is_active becomes False",
        precondition="Active regular user exists; admin authenticated",
        steps=[
            "PATCH /admin/users/{id}/activate on active user",
            "Assert HTTP 200",
            "Assert is_active == False",
        ],
        test_data={"action": "deactivate"},
        expected_result="HTTP 200, is_active=False",
        post_condition="User cannot authenticate until reactivated",
    )
    def test_admin_can_deactivate_user(self, client, admin_headers, regular_user):
        resp = client.patch(f"/admin/users/{regular_user.id}/activate", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_active"] is False

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-013",
        objective="Admin can reactivate a deactivated user",
        precondition="Inactive user exists; admin authenticated",
        steps=[
            "PATCH /admin/users/{id}/activate on inactive user",
            "Assert HTTP 200",
            "Assert is_active == True",
        ],
        test_data={"action": "reactivate"},
        expected_result="HTTP 200, is_active=True",
        post_condition="User can authenticate again",
    )
    def test_admin_can_reactivate_user(self, client, admin_headers, inactive_user):
        resp = client.patch(f"/admin/users/{inactive_user.id}/activate", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_active"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-014",
        objective="Admin cannot deactivate themselves (400)",
        precondition="Admin authenticated; target is self",
        steps=[
            "PATCH /admin/users/{admin_user.id}/activate",
            "Assert HTTP 400",
        ],
        test_data={"self_action": True},
        expected_result="HTTP 400 Bad Request — self-deactivation blocked",
        post_condition="Admin account unchanged",
    )
    def test_admin_cannot_deactivate_themselves(self, client, db, admin_user, admin_headers):
        resp = client.patch(f"/admin/users/{admin_user.id}/activate", headers=admin_headers)
        assert resp.status_code == 400


class TestChangeRole:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-015",
        objective="Admin can promote a regular user to admin role",
        precondition="Regular user exists; admin authenticated",
        steps=[
            "PATCH /admin/users/{id}/role with {role: 'admin'}",
            "Assert HTTP 200",
            "Assert platform_role == 'admin'",
        ],
        test_data={"role": "admin"},
        expected_result="HTTP 200, platform_role='admin'",
        post_condition="User now has admin privileges",
    )
    def test_admin_can_promote_user_to_admin(self, client, admin_headers, regular_user):
        resp = client.patch(f"/admin/users/{regular_user.id}/role",
                            json={"role": "admin"}, headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["platform_role"] == "admin"

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-016",
        objective="Admin cannot change their own role (400)",
        precondition="Admin authenticated; target is self",
        steps=[
            "PATCH /admin/users/{admin_user.id}/role",
            "Assert HTTP 400",
        ],
        test_data={"self_action": True, "role": "user"},
        expected_result="HTTP 400 Bad Request",
        post_condition="Admin role unchanged",
    )
    def test_admin_cannot_change_own_role(self, client, admin_headers, admin_user):
        resp = client.patch(f"/admin/users/{admin_user.id}/role",
                            json={"role": "user"}, headers=admin_headers)
        assert resp.status_code == 400


class TestForceLogout:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-017",
        objective="Admin can force-logout a user by incrementing their token_version",
        precondition="Regular user exists; admin authenticated",
        steps=[
            "Record user.token_version",
            "POST /admin/users/{id}/force-logout",
            "Assert HTTP 200",
            "Refresh user from DB",
            "Assert token_version == original + 1",
        ],
        test_data={"action": "force-logout"},
        expected_result="HTTP 200, user.token_version incremented by 1",
        post_condition="All existing sessions for the user are invalidated",
    )
    def test_admin_can_force_logout_user(self, client, db, admin_headers, regular_user):
        original_version = regular_user.token_version
        resp = client.post(f"/admin/users/{regular_user.id}/force-logout", headers=admin_headers)
        assert resp.status_code == 200
        db.refresh(regular_user)
        assert regular_user.token_version == original_version + 1

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-018",
        objective="Admin cannot force-logout themselves (400)",
        precondition="Admin authenticated; target is self",
        steps=[
            "POST /admin/users/{admin_user.id}/force-logout",
            "Assert HTTP 400",
        ],
        test_data={"self_action": True},
        expected_result="HTTP 400 Bad Request",
        post_condition="Admin session unchanged",
    )
    def test_admin_cannot_force_logout_themselves(self, client, admin_headers, admin_user):
        resp = client.post(f"/admin/users/{admin_user.id}/force-logout", headers=admin_headers)
        assert resp.status_code == 400
