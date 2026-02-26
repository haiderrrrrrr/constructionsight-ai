"""
Integration Tests — /notifications endpoints

Covers: authenticated user can list notifications, unauthenticated blocked,
        mark-read idempotent (no 404 for missing IDs), delete idempotent,
        auth required for all mutations.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Notifications"),
    pytest.mark.integration,
]


class TestListNotifications:
    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-001",
        objective="Authenticated user can list their notifications",
        precondition="User is authenticated",
        steps=[
            "GET /notifications with valid token",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"Authorization": "Bearer <valid token>"},
        expected_result="HTTP 200, JSON array of notifications",
        post_condition="No state change",
    )
    def test_authenticated_user_can_list_notifications(self, client, user_headers):
        resp = client.get("/notifications", headers=user_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-002",
        objective="Unauthenticated cannot list notifications (401)",
        precondition="No Authorization header",
        steps=["GET /notifications with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_notifications(self, client):
        resp = client.get("/notifications")
        assert resp.status_code == 401


class TestMarkNotificationRead:
    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-003",
        objective="Mark-read is idempotent — non-existent ID returns ok:true",
        precondition="No notification with id=999999",
        steps=[
            "PATCH /notifications/999999/read",
            "Assert HTTP 200",
            "Assert ok == True in response",
        ],
        test_data={"notification_id": 999999},
        expected_result="HTTP 200, {ok: true}",
        post_condition="No state change",
    )
    def test_mark_read_is_idempotent_for_missing_notification(self, client, user_headers):
        resp = client.patch("/notifications/999999/read", headers=user_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-004",
        objective="Mark-read requires authentication (401)",
        precondition="No Authorization header",
        steps=["PATCH /notifications/1/read with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No state change",
    )
    def test_mark_read_requires_auth(self, client):
        resp = client.patch("/notifications/1/read")
        assert resp.status_code == 401


class TestDeleteNotification:
    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-005",
        objective="Delete notification is idempotent — non-existent ID returns ok:true",
        precondition="No notification with id=999999",
        steps=[
            "DELETE /notifications/999999",
            "Assert HTTP 200",
            "Assert ok == True in response",
        ],
        test_data={"notification_id": 999999},
        expected_result="HTTP 200, {ok: true}",
        post_condition="No state change",
    )
    def test_delete_is_idempotent_for_missing_notification(self, client, user_headers):
        resp = client.delete("/notifications/999999", headers=user_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    @pytest.mark.testcase(
        tc_id="TC-INT-NTF-006",
        objective="Delete notification requires authentication (401)",
        precondition="No Authorization header",
        steps=["DELETE /notifications/1 with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No state change",
    )
    def test_delete_requires_auth(self, client):
        resp = client.delete("/notifications/1")
        assert resp.status_code == 401
