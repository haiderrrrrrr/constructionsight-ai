"""
Integration Tests — /notifications endpoints (user-facing)

Covers: list notifications, unread count, mark one read, mark all read,
        delete notification, SSE stream auth, 401 without token.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("User — Notification Management"),
    pytest.mark.integration,
    pytest.mark.notifications,
]

from tests.conftest import _make_user, _auth_headers
from tests.accessories.factories import NotificationFactory


class TestListNotifications:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-001",
        objective="GET /notifications returns list of notifications for current user",
        precondition="User authenticated; at least one notification exists for user",
        steps=[
            "Create notification for user",
            "GET /notifications with user token",
            "Assert HTTP 200 with list",
        ],
        test_data={},
        expected_result="HTTP 200, list of notification objects",
        post_condition="No state change",
    )
    def test_list_notifications(self, client, db, regular_user, user_headers):
        with allure.step("Create notification for user"):
            NotificationFactory(db=db, user_id=regular_user.id)

        with allure.step("GET /notifications"):
            resp = client.get("/notifications", headers=user_headers)

        with allure.step("Assert 200 and list"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-007",
        objective="GET /notifications without token returns 401",
        precondition="No authorization header",
        steps=[
            "GET /notifications with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_list_notifications_requires_auth(self, client):
        with allure.step("GET without token"):
            resp = client.get("/notifications")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestUnreadCount:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-002",
        objective="GET /notifications/unread-count returns an integer count",
        precondition="User authenticated",
        steps=[
            "GET /notifications/unread-count",
            "Assert HTTP 200",
            "Assert response has 'count' key with integer value",
        ],
        test_data={},
        expected_result="HTTP 200 with {count: <int>}",
        post_condition="No state change",
    )
    def test_unread_count_returns_integer(self, client, user_headers):
        with allure.step("GET unread count"):
            resp = client.get("/notifications/unread-count", headers=user_headers)

        with allure.step("Assert 200 and integer count"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "count" in data
            assert isinstance(data["count"], int)


class TestMarkNotifications:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-003",
        objective="PATCH /notifications/{id}/read marks single notification as read",
        precondition="User authenticated; unread notification exists",
        steps=[
            "Create unread notification for user",
            "PATCH /notifications/{id}/read",
            "Assert HTTP 200",
        ],
        test_data={"is_read": False},
        expected_result="HTTP 200 — notification marked as read",
        post_condition="notification is_read=True",
    )
    def test_mark_single_notification_read(self, client, db, regular_user, user_headers):
        with allure.step("Create unread notification"):
            notif = NotificationFactory(db=db, user_id=regular_user.id, is_read=False)

        with allure.step("PATCH mark as read"):
            resp = client.patch(
                f"/notifications/{notif.id}/read",
                headers=user_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-004",
        objective="PATCH /notifications/mark-all-read marks all user notifications as read",
        precondition="User authenticated; multiple unread notifications exist",
        steps=[
            "Create 2 unread notifications for user",
            "PATCH /notifications/mark-all-read",
            "Assert HTTP 200",
        ],
        test_data={},
        expected_result="HTTP 200 — all notifications marked read",
        post_condition="All user notifications is_read=True",
    )
    def test_mark_all_read(self, client, db, regular_user, user_headers):
        with allure.step("Create two unread notifications"):
            NotificationFactory(db=db, user_id=regular_user.id, is_read=False)
            NotificationFactory(db=db, user_id=regular_user.id, is_read=False)

        with allure.step("PATCH mark-all-read"):
            resp = client.patch("/notifications/mark-all-read", headers=user_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


class TestDeleteNotification:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-005",
        objective="DELETE /notifications/{id} removes the notification",
        precondition="User authenticated; notification exists",
        steps=[
            "Create notification for user",
            "DELETE /notifications/{id}",
            "Assert HTTP 200",
        ],
        test_data={},
        expected_result="HTTP 200 — notification deleted",
        post_condition="Notification removed from DB",
    )
    def test_delete_notification(self, client, db, regular_user, user_headers):
        with allure.step("Create notification"):
            notif = NotificationFactory(db=db, user_id=regular_user.id)

        with allure.step("DELETE notification"):
            resp = client.delete(
                f"/notifications/{notif.id}",
                headers=user_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"


class TestNotificationStream:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-NTF-006",
        objective="GET /notifications/stream without token returns 401; with valid token returns 200 SSE",
        precondition="Valid access token available",
        steps=[
            "GET /notifications/stream with no token → 401 or 422",
            "GET /notifications/stream?token=<valid_token> → 200 with text/event-stream",
        ],
        test_data={"stream_auth": "query param token"},
        expected_result="401 without token; 200 text/event-stream with valid token",
        post_condition="Stream connection opened and immediately closable",
    )
    def test_notification_stream_auth(self, client, db, regular_user):
        from tests.conftest import _token_for

        with allure.step("GET stream with no token → expect 401 or 422"):
            resp = client.get("/notifications/stream")
            assert resp.status_code in (401, 422), (
                f"Expected 401/422 for unauthenticated stream, got {resp.status_code}"
            )

        # Valid-token stream opens an SSE loop with asyncio.wait_for(25s) that
        # cannot be interrupted by TestClient disconnect — skip to avoid hang.
        pytest.skip("Valid-token SSE stream blocks TestClient — requires real async HTTP client")
