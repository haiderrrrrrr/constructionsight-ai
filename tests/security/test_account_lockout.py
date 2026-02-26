"""
Security tests — account lockout enforcement.

Covers: locked_until enforcement, progressive lockout on repeated failures,
        auto-reset on successful login, failed_login_count incrementing.
"""
import allure
import pytest
from datetime import datetime, timedelta, timezone

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("Account Lockout"),
    pytest.mark.security,
    pytest.mark.lockout,
]

from tests.conftest import _make_user


class TestAccountLockoutEnforcement:
    @pytest.mark.testcase(
        tc_id="TC-SEC-060",
        objective="Account with locked_until in the future returns 423 on login attempt",
        precondition="User exists with locked_until = now + 30 minutes",
        steps=[
            "Create user with locked_until set 30 minutes in the future",
            "POST /auth/login with correct credentials",
            "Assert HTTP 423",
            "Assert response detail contains 'locked'",
        ],
        test_data={"locked_until": "now + 30 min", "password": "correct"},
        expected_result="HTTP 423 with 'Account temporarily locked' message",
        post_condition="No tokens issued; lockout preserved",
    )
    def test_locked_account_returns_423(self, client, db):
        with allure.step("Create a user with locked_until in the future"):
            future = datetime.now(timezone.utc) + timedelta(minutes=30)
            user = _make_user(
                db,
                email="locked_user@test.com",
                username="locked_user",
                password="TestPass123!",
            )
            user.locked_until = future
            db.flush()

        with allure.step("Attempt login with correct credentials"):
            resp = client.post(
                "/auth/login",
                json={"identifier": "locked_user@test.com", "password": "TestPass123!"},
            )

        with allure.step("Assert HTTP 423 and lockout message"):
            assert resp.status_code == 423
            assert "locked" in resp.json().get("detail", "").lower()

    @pytest.mark.testcase(
        tc_id="TC-SEC-061",
        objective="Five consecutive wrong passwords set locked_until and increment failed_login_count to threshold",
        precondition="User exists with failed_login_count=0 and no active lockout",
        steps=[
            "Create a user with failed_login_count=0",
            "POST /auth/login with wrong password 5 times",
            "Query DB for user.locked_until and user.failed_login_count",
            "Assert locked_until is set (non-None) and failed_login_count >= 5",
        ],
        test_data={"wrong_password": "WrongPass999!", "attempts": 5},
        expected_result="locked_until is set in DB; failed_login_count >= 5",
        post_condition="Account is locked until locked_until expires",
    )
    def test_five_wrong_passwords_triggers_lockout(self, client, db):
        with allure.step("Create user with no lockout"):
            user = _make_user(
                db,
                email="lockout_target@test.com",
                username="lockout_target",
                password="TestPass123!",
            )
            user.failed_login_count = 0
            user.locked_until = None
            db.flush()
            user_id = user.id

        with allure.step("Submit 5 incorrect login attempts"):
            for _ in range(5):
                client.post(
                    "/auth/login",
                    json={"identifier": "lockout_target@test.com", "password": "WrongPass999!"},
                )

        with allure.step("Reload user from DB and verify lockout fields"):
            db.expire(user)
            db.refresh(user)
            assert user.failed_login_count >= 5, (
                f"Expected failed_login_count >= 5, got {user.failed_login_count}"
            )
            assert user.locked_until is not None, "Expected locked_until to be set after 5 failures"
            assert user.locked_until > datetime.now(timezone.utc), (
                "Expected locked_until to be in the future"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-062",
        objective="Correct login after lockout expiry succeeds and resets failed_login_count",
        precondition="User exists with expired locked_until (past timestamp)",
        steps=[
            "Create user with locked_until = now - 1 second (expired)",
            "POST /auth/login with correct credentials",
            "Assert HTTP 200",
            "Query DB: failed_login_count == 0 and locked_until is None",
        ],
        test_data={"locked_until": "now - 1 sec (expired)", "password": "correct"},
        expected_result="HTTP 200; failed_login_count reset to 0; locked_until cleared",
        post_condition="User can log in normally; lockout state cleared",
    )
    def test_login_after_lockout_expiry_succeeds_and_resets(self, client, db):
        with allure.step("Create user with expired lockout"):
            past = datetime.now(timezone.utc) - timedelta(seconds=1)
            user = _make_user(
                db,
                email="expired_lock@test.com",
                username="expired_lock",
                password="TestPass123!",
            )
            user.locked_until = past
            user.failed_login_count = 5
            db.flush()

        with allure.step("Login with correct credentials after lockout expiry"):
            resp = client.post(
                "/auth/login",
                json={"identifier": "expired_lock@test.com", "password": "TestPass123!"},
            )

        with allure.step("Assert login succeeds"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        with allure.step("Verify DB: failed_login_count reset and locked_until cleared"):
            db.expire(user)
            db.refresh(user)
            assert user.failed_login_count == 0, (
                f"Expected failed_login_count=0, got {user.failed_login_count}"
            )
            assert user.locked_until is None, (
                f"Expected locked_until=None, got {user.locked_until}"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-063",
        objective="Successful login resets failed_login_count to 0",
        precondition="User exists with failed_login_count=3 but not yet locked",
        steps=[
            "Create user with failed_login_count=3, locked_until=None",
            "POST /auth/login with correct credentials",
            "Assert HTTP 200",
            "Query DB: failed_login_count == 0",
        ],
        test_data={"failed_login_count": 3, "password": "correct"},
        expected_result="HTTP 200; failed_login_count reset to 0",
        post_condition="Counter cleared; account fully functional",
    )
    def test_successful_login_resets_failed_count(self, client, db):
        with allure.step("Create user with partial failure count (no lockout yet)"):
            user = _make_user(
                db,
                email="partial_fail@test.com",
                username="partial_fail",
                password="TestPass123!",
            )
            user.failed_login_count = 3
            user.locked_until = None
            db.flush()

        with allure.step("Login successfully"):
            resp = client.post(
                "/auth/login",
                json={"identifier": "partial_fail@test.com", "password": "TestPass123!"},
            )

        with allure.step("Assert HTTP 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        with allure.step("Verify failed_login_count reset to 0"):
            db.expire(user)
            db.refresh(user)
            assert user.failed_login_count == 0, (
                f"Expected failed_login_count=0 after success, got {user.failed_login_count}"
            )
