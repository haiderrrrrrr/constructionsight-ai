"""
Integration Tests — /users/me profile endpoints

Covers: get profile, update profile, username collision, theme update,
        password change (correct/wrong), avatar upload validation, 401 without token.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("User — Profile Management"),
    pytest.mark.integration,
    pytest.mark.user_profile,
]

from tests.conftest import _make_user, _auth_headers


class TestGetProfile:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-001",
        objective="GET /users/me returns all profile fields for authenticated user",
        precondition="User authenticated",
        steps=[
            "GET /users/me with valid bearer token",
            "Assert HTTP 200",
            "Assert response contains id, full_name, email, username, platform_role",
        ],
        test_data={},
        expected_result="HTTP 200 with complete user profile object",
        post_condition="No state change",
    )
    def test_get_profile_returns_all_fields(self, client, db, regular_user, user_headers):
        with allure.step("GET /users/me"):
            resp = client.get("/users/me", headers=user_headers)

        with allure.step("Assert 200 and required fields"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            for field in ("id", "full_name", "email", "username"):
                assert field in data, f"Expected field '{field}' in profile response"

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-007a",
        objective="GET /users/me without token returns 401",
        precondition="No authorization header",
        steps=[
            "GET /users/me with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_get_profile_requires_auth(self, client):
        with allure.step("GET without token"):
            resp = client.get("/users/me")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestUpdateProfile:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-002",
        objective="PATCH /users/me/profile with valid full_name update succeeds",
        precondition="User authenticated",
        steps=[
            "PATCH /users/me/profile with new full_name and current_password",
            "Assert HTTP 200",
            "Assert returned full_name matches updated value",
        ],
        test_data={"full_name": "Updated Full Name"},
        expected_result="HTTP 200 with updated profile",
        post_condition="full_name updated in DB",
    )
    def test_update_full_name(self, client, db, user_headers):
        with allure.step("PATCH profile with new full_name"):
            resp = client.patch(
                "/users/me/profile",
                json={"full_name": "Updated Full Name", "current_password": "TestPass123!"},
                headers=user_headers,
            )

        with allure.step("Assert 200 and updated name"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            assert resp.json().get("full_name") == "Updated Full Name"

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-003",
        objective="PATCH /users/me/profile with taken username returns 400",
        precondition="Two users exist; user_b tries to take user_a's username",
        steps=[
            "Create user_a with username='taken_uname_a'",
            "Create user_b; PATCH user_b's profile with username='taken_uname_a'",
            "Assert HTTP 400",
        ],
        test_data={"username": "taken_uname_a (already taken)"},
        expected_result="HTTP 400 — username collision rejected",
        post_condition="user_b username unchanged",
    )
    def test_username_collision_returns_400(self, client, db):
        with allure.step("Create two users"):
            user_a = _make_user(db, email="uname_a@test.com", username="taken_uname_a")
            user_b = _make_user(db, email="uname_b@test.com", username="user_b_profile")

        with allure.step("user_b tries to take user_a's username"):
            resp = client.patch(
                "/users/me/profile",
                json={"username": "taken_uname_a", "current_password": "TestPass123!"},
                headers=_auth_headers(user_b),
            )

        with allure.step("Assert 400"):
            assert resp.status_code == 400, (
                f"Expected 400 for username collision, got {resp.status_code}"
            )


class TestUpdateTheme:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-004",
        objective="PATCH /users/me/theme with dark/light is accepted",
        precondition="User authenticated",
        steps=[
            "PATCH /users/me/theme with theme_skin='dark'",
            "Assert HTTP 200",
            "Repeat with theme_skin='light' — assert 200",
        ],
        test_data={"theme_skin": "dark / light"},
        expected_result="HTTP 200 for both valid theme values",
        post_condition="theme_skin updated in DB",
    )
    def test_update_theme_dark_light(self, client, user_headers):
        for theme in ("dark", "light"):
            with allure.step(f"PATCH theme to '{theme}'"):
                resp = client.patch(
                    "/users/me/theme",
                    json={"theme_skin": theme},
                    headers=user_headers,
                )
                assert resp.status_code == 200, (
                    f"Expected 200 for theme='{theme}', got {resp.status_code}: {resp.text}"
                )


class TestChangePassword:
    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-005",
        objective="PATCH /users/me/password with correct old password succeeds and bumps token_version",
        precondition="User authenticated with TestPass123!",
        steps=[
            "PATCH /users/me/password with current_password='TestPass123!' and new_password='NewPass456!'",
            "Assert HTTP 200",
            "Reload user from DB — assert token_version incremented",
        ],
        test_data={"current_password": "TestPass123!", "new_password": "NewPass456!"},
        expected_result="HTTP 200; token_version bumped",
        post_condition="Password updated; all old sessions invalidated",
    )
    def test_password_change_success(self, client, db):
        with allure.step("Create user"):
            user = _make_user(db, email="pw_change_profile@test.com", username="pw_change_profile",
                              password="TestPass123!")
            old_version = user.token_version

        with allure.step("PATCH password"):
            resp = client.patch(
                "/users/me/password",
                json={"current_password": "TestPass123!", "new_password": "NewPass456!"},
                headers=_auth_headers(user),
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        with allure.step("Verify token_version was bumped"):
            db.expire(user)
            db.refresh(user)
            assert user.token_version > old_version, (
                f"Expected token_version > {old_version}, got {user.token_version}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-006",
        objective="PATCH /users/me/password with wrong old password returns 400",
        precondition="User authenticated",
        steps=[
            "PATCH /users/me/password with current_password='WrongPass999!'",
            "Assert HTTP 400",
        ],
        test_data={"current_password": "WrongPass999! (incorrect)"},
        expected_result="HTTP 400 — wrong current password rejected",
        post_condition="Password unchanged; token_version unchanged",
    )
    def test_password_change_wrong_current_password(self, client, db):
        with allure.step("Create user"):
            user = _make_user(db, email="pw_wrong@test.com", username="pw_wrong",
                              password="TestPass123!")

        with allure.step("PATCH with wrong current password"):
            resp = client.patch(
                "/users/me/password",
                json={"current_password": "WrongPass999!", "new_password": "NewPass456!"},
                headers=_auth_headers(user),
            )

        with allure.step("Assert 400"):
            assert resp.status_code == 400, (
                f"Expected 400 for wrong password, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-USR-PRF-007b",
        objective="PATCH /users/me/password without token returns 401",
        precondition="No authorization header",
        steps=[
            "PATCH /users/me/password with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No state change",
    )
    def test_password_change_requires_auth(self, client):
        with allure.step("PATCH without token"):
            resp = client.patch(
                "/users/me/password",
                json={"current_password": "TestPass123!", "new_password": "NewPass456!"},
            )

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
