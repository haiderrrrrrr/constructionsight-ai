"""
Unit Tests — Notification Service

Tests notification creation and retrieval via the ORM (DB-level).
Uses the test DB session with rollback so no persistent state.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("Notification Service"),
    pytest.mark.unit,
    pytest.mark.notifications,
]

from app.models.notification import Notification
from tests.conftest import _make_user


class TestNotificationCreation:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-NOT-001",
        objective="Notification row is persisted to DB with correct field values",
        precondition="Test DB available; user exists",
        steps=[
            "Create a user",
            "Create a Notification row with type, title, message",
            "Flush to DB",
            "Query and assert all fields match",
        ],
        test_data={"type": "system_alert", "title": "Test Alert", "message": "Body text"},
        expected_result="Notification row exists in DB with is_read=False by default",
        post_condition="Transaction rolled back after test",
    )
    def test_notification_persisted_with_correct_fields(self, db):
        with allure.step("Create a user"):
            user = _make_user(db, email="notif_user@test.com", username="notif_user")

        with allure.step("Create and flush notification"):
            notif = Notification(
                user_id=user.id,
                type="system_alert",
                title="Test Alert",
                message="Body text",
                category="general",
                priority="medium",
            )
            db.add(notif)
            db.flush()

        with allure.step("Query and assert fields"):
            stored = db.query(Notification).filter_by(id=notif.id).first()
            assert stored is not None
            assert stored.user_id == user.id
            assert stored.type == "system_alert"
            assert stored.title == "Test Alert"
            assert stored.message == "Body text"
            assert stored.is_read is False

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-NOT-002",
        objective="is_read defaults to False for new notifications",
        precondition="Test DB available; user exists",
        steps=[
            "Create notification without setting is_read",
            "Assert is_read is False",
        ],
        test_data={"is_read": "not set (default)"},
        expected_result="is_read == False",
        post_condition="Transaction rolled back",
    )
    def test_is_read_defaults_false(self, db):
        user = _make_user(db, email="notif_user2@test.com", username="notif_user2")
        notif = Notification(user_id=user.id, type="info", title="Hello", message="World")
        db.add(notif)
        db.flush()
        assert notif.is_read is False

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-NOT-003",
        objective="Notification with action_url and priority stores correctly",
        precondition="Test DB available; user exists",
        steps=[
            "Create notification with action_url='http://example.com' and priority='critical'",
            "Flush and query",
            "Assert action_url and priority match",
        ],
        test_data={"action_url": "http://example.com", "priority": "critical"},
        expected_result="action_url and priority stored correctly",
        post_condition="Transaction rolled back",
    )
    def test_notification_with_action_url_and_priority(self, db):
        user = _make_user(db, email="notif_user3@test.com", username="notif_user3")
        notif = Notification(
            user_id=user.id,
            type="risk_alert",
            title="High Risk",
            message="Zone A has critical risk",
            action_url="http://example.com/project/1",
            priority="critical",
            category="ppe",
        )
        db.add(notif)
        db.flush()

        stored = db.query(Notification).filter_by(id=notif.id).first()
        assert stored.action_url == "http://example.com/project/1"
        assert stored.priority == "critical"
        assert stored.category == "ppe"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-NOT-004",
        objective="Multiple notifications for same user are all retrievable",
        precondition="Test DB available; user exists",
        steps=[
            "Create 3 notifications for the same user",
            "Query all notifications for that user",
            "Assert count is 3",
        ],
        test_data={"count": 3},
        expected_result="3 notifications returned for user",
        post_condition="Transaction rolled back",
    )
    def test_multiple_notifications_for_user(self, db):
        user = _make_user(db, email="notif_multi@test.com", username="notif_multi")
        for i in range(3):
            db.add(Notification(
                user_id=user.id,
                type="info",
                title=f"Notification {i}",
                message=f"Message {i}",
            ))
        db.flush()

        notifs = db.query(Notification).filter_by(user_id=user.id).all()
        assert len(notifs) == 3

    @pytest.mark.testcase(
        tc_id="TC-UNIT-SVC-NOT-005",
        objective="Marking notification as read updates is_read flag",
        precondition="Test DB available; notification exists",
        steps=[
            "Create notification (is_read=False)",
            "Set is_read=True and flush",
            "Query and assert is_read is True",
        ],
        test_data={"is_read": True},
        expected_result="is_read updated to True",
        post_condition="Transaction rolled back",
    )
    def test_mark_notification_read(self, db):
        user = _make_user(db, email="notif_read@test.com", username="notif_read")
        notif = Notification(user_id=user.id, type="info", title="Test", message="Body")
        db.add(notif)
        db.flush()

        notif.is_read = True
        db.flush()

        stored = db.query(Notification).filter_by(id=notif.id).first()
        assert stored.is_read is True
