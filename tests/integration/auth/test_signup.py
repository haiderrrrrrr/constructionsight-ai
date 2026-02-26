"""
Integration Tests — POST /auth/signup

Covers: valid registration, duplicate email, duplicate username,
        new user starts unapproved, password not exposed.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Authentication — Signup"),
    pytest.mark.integration,
    pytest.mark.auth,
]

from tests.conftest import _make_user


def _signup(client, *, email="new@test.com", username="newuser",
            full_name="New User", password="TestPass123!", invite_token=None):
    payload = {"email": email, "username": username,
               "full_name": full_name, "password": password}
    if invite_token:
        payload["invite_token"] = invite_token
    return client.post("/auth/signup", json=payload)


class TestSignupSuccess:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-001",
        objective="Valid signup returns 200 with correct user fields",
        precondition="No existing user with email new@test.com or username newuser",
        steps=[
            "POST /auth/signup with valid email, username, full_name, password",
            "Assert HTTP 200 response",
            "Assert email and username match submitted values",
            "Assert id field is present",
        ],
        test_data={"email": "new@test.com", "username": "newuser",
                   "full_name": "New User", "password": "TestPass123!"},
        expected_result="HTTP 200, response body contains email, username, id",
        post_condition="User record created in users table with is_approved=False",
    )
    def test_valid_signup_returns_200_and_user_fields(self, client):
        resp = _signup(client)
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "new@test.com"
        assert data["username"] == "newuser"
        assert "id" in data

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-002",
        objective="New user is not approved by default and cannot login",
        precondition="No existing user with email new@test.com",
        steps=[
            "POST /auth/signup with valid credentials",
            "Assert signup returns HTTP 200",
            "POST /auth/login with same credentials",
            "Assert login returns HTTP 403 with 'pending approval' message",
        ],
        test_data={"email": "new@test.com", "password": "TestPass123!"},
        expected_result="Signup 200, subsequent login returns 403 pending approval",
        post_condition="User exists but is_approved=False — cannot authenticate",
    )
    def test_new_user_is_not_approved_by_default(self, client):
        resp = _signup(client)
        assert resp.status_code == 200
        login_resp = client.post("/auth/login", json={"identifier": "new@test.com", "password": "TestPass123!"})
        assert login_resp.status_code == 403
        assert "pending approval" in login_resp.json()["detail"].lower()

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-003",
        objective="Password hash is never exposed in signup response",
        precondition="No existing user with email new@test.com",
        steps=[
            "POST /auth/signup with valid credentials",
            "Assert HTTP 200",
            "Assert 'password' key absent from response body",
            "Assert 'password_hash' key absent from response body",
        ],
        test_data={"email": "new@test.com", "password": "TestPass123!"},
        expected_result="Response body contains no password or password_hash field",
        post_condition="User created with hashed password stored in DB — never returned",
    )
    def test_password_not_exposed_in_response(self, client):
        resp = _signup(client)
        data = resp.json()
        assert "password" not in data
        assert "password_hash" not in data


class TestSignupDuplicates:
    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-004",
        objective="Duplicate email signup returns 400 with clear error message",
        precondition="User with email user@test.com already exists (regular_user fixture)",
        steps=[
            "POST /auth/signup with existing email but new username",
            "Assert HTTP 400 response",
            "Assert detail contains 'Email already registered'",
        ],
        test_data={"email": "user@test.com (existing)", "username": "brandnewuser"},
        expected_result="HTTP 400 Conflict, detail='Email already registered'",
        post_condition="No new user created — existing record unchanged",
    )
    def test_duplicate_email_returns_400(self, client, regular_user):
        resp = _signup(client, email=regular_user.email, username="brandnewuser")
        assert resp.status_code == 400
        assert "Email already registered" in resp.json()["detail"]

    @pytest.mark.testcase(
        tc_id="TC-INT-AUTH-005",
        objective="Duplicate username signup returns 400 with clear error message",
        precondition="User with username testuser already exists (regular_user fixture)",
        steps=[
            "POST /auth/signup with new email but existing username",
            "Assert HTTP 400 response",
            "Assert detail contains 'Username already taken'",
        ],
        test_data={"email": "brand@new.com", "username": "testuser (existing)"},
        expected_result="HTTP 400 Conflict, detail='Username already taken'",
        post_condition="No new user created — existing record unchanged",
    )
    def test_duplicate_username_returns_400(self, client, regular_user):
        resp = _signup(client, email="brand@new.com", username=regular_user.username)
        assert resp.status_code == 400
        assert "Username already taken" in resp.json()["detail"]
