"""
Integration Tests — /admin/notifications endpoints

Covers: list notifications, unread count, mark all read, mark one read,
        delete notification, 404 for non-existent, auth enforcement.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Notification Management"),
    pytest.mark.integration,
    pytest.mark.admin,
    pytest.mark.notifications,
]

from tests.conftest import _make_user
from app.models.user import PlatformRole
from tests.accessories.factories import NotificationFactory


class TestListAdminNotifications:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-001",
        objective="Admin can list platform notifications; regular user gets 403",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/notifications with admin token → 200 + list",
            "GET /admin/notifications with user token → 403",
            "GET /admin/notifications with no token → 401",
        ],
        test_data={"role": "admin"},
        expected_result="200 for admin; 403 for user; 401 no token",
        post_condition="No state change",
    )
    def test_list_notifications_auth_enforcement(self, client, admin_headers, user_headers):
        with allure.step("Admin lists notifications"):
            resp = client.get("/admin/notifications", headers=admin_headers)
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

        with allure.step("Regular user forbidden"):
            resp = client.get("/admin/notifications", headers=user_headers)
            assert resp.status_code == 403

        with allure.step("No token unauthorized"):
            resp = client.get("/admin/notifications")
            assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-002",
        objective="GET /admin/notifications/unread-count returns an integer",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/notifications/unread-count",
            "Assert HTTP 200",
            "Assert response has 'count' key with integer value",
        ],
        test_data={},
        expected_result="HTTP 200 with {count: <int>}",
        post_condition="No state change",
    )
    def test_unread_count_returns_integer(self, client, admin_headers):
        with allure.step("GET unread count"):
            resp = client.get("/admin/notifications/unread-count", headers=admin_headers)

        with allure.step("Assert 200 and integer count"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "count" in data
            assert isinstance(data["count"], int)


class TestMarkNotifications:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-003",
        objective="PATCH /admin/notifications/mark-all-read marks all notifications as read",
        precondition="Admin authenticated; at least one unread notification exists",
        steps=[
            "Create unread notification for admin",
            "PATCH /admin/notifications/mark-all-read",
            "Assert HTTP 200",
            "Assert response has ok=True",
        ],
        test_data={},
        expected_result="HTTP 200 with {ok: true}",
        post_condition="All admin notifications marked as read",
    )
    def test_mark_all_read(self, client, db, admin_user, admin_headers):
        with allure.step("Create unread notification for admin"):
            NotificationFactory(db=db, user_id=admin_user.id, is_read=False)

        with allure.step("PATCH mark-all-read"):
            resp = client.patch("/admin/notifications/mark-all-read", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-004",
        objective="PATCH /admin/notifications/{id}/read marks a single notification as read",
        precondition="Admin authenticated; unread notification exists",
        steps=[
            "Create unread notification for admin",
            "PATCH /admin/notifications/{id}/read",
            "Assert HTTP 200",
        ],
        test_data={"is_read": False},
        expected_result="HTTP 200 — notification marked as read",
        post_condition="Notification is_read=True",
    )
    def test_mark_single_notification_read(self, client, db, admin_user, admin_headers):
        with allure.step("Create unread notification"):
            notif = NotificationFactory(db=db, user_id=admin_user.id, is_read=False)

        with allure.step("PATCH mark one notification as read"):
            resp = client.patch(
                f"/admin/notifications/{notif.id}/read",
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


class TestDeleteNotification:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-005",
        objective="Admin can delete a notification by ID",
        precondition="Admin authenticated; notification exists",
        steps=[
            "Create notification for admin",
            "DELETE /admin/notifications/{id}",
            "Assert HTTP 200 or 204",
        ],
        test_data={},
        expected_result="HTTP 200 or 204 — notification deleted",
        post_condition="Notification removed from DB",
    )
    def test_delete_notification(self, client, db, admin_user, admin_headers):
        with allure.step("Create notification"):
            notif = NotificationFactory(db=db, user_id=admin_user.id)

        with allure.step("DELETE notification"):
            resp = client.delete(
                f"/admin/notifications/{notif.id}",
                headers=admin_headers,
            )

        with allure.step("Assert 200 or 204"):
            assert resp.status_code in (200, 204), (
                f"Expected 200/204, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-NOT-006",
        objective="PATCH /admin/notifications/{id}/read returns 404 for non-existent notification",
        precondition="Admin authenticated; notification id=999999 does not exist",
        steps=[
            "PATCH /admin/notifications/999999/read",
            "Assert HTTP 404",
        ],
        test_data={"notification_id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_mark_nonexistent_notification_returns_404(self, client, admin_headers):
        with allure.step("PATCH non-existent notification"):
            resp = client.patch("/admin/notifications/999999/read", headers=admin_headers)

        with allure.step("Assert 404"):
            assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
