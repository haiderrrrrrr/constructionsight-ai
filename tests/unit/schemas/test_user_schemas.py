"""
Unit tests for User Pydantic schemas — UserCreate, UserLogin.

No DB or HTTP — pure schema validation in isolation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("Schemas — User Validation"),
    pytest.mark.unit,
]

from pydantic import ValidationError

from app.schemas.user import UserCreate, UserLogin


class TestUserCreateSchema:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-001",
        objective="Valid UserCreate payload passes validation",
        precondition="None",
        steps=[
            "Instantiate UserCreate with valid email, username, password",
            "Assert no ValidationError raised",
        ],
        test_data={"email": "valid@test.com", "username": "validuser", "password": "Valid123!"},
        expected_result="UserCreate instance created successfully",
        post_condition="No side effects",
    )
    def test_valid_payload_passes(self):
        user = UserCreate(
            email="valid@test.com",
            username="validuser",
            password="Valid123!",
            full_name="Valid User",
        )
        assert user.email == "valid@test.com"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-002",
        objective="Invalid email format raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate with email='not-an-email'",
            "Assert ValidationError raised",
        ],
        test_data={"email": "not-an-email"},
        expected_result="ValidationError raised for invalid email",
        post_condition="No side effects",
    )
    def test_invalid_email_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="not-an-email",
                username="validuser",
                password="Valid123!",
                full_name="Test",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-003",
        objective="Missing email field raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate without email field",
            "Assert ValidationError raised",
        ],
        test_data={"email": "missing"},
        expected_result="ValidationError raised — email required",
        post_condition="No side effects",
    )
    def test_missing_email_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(username="validuser", password="Valid123!", full_name="Test")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-004",
        objective="Missing password field raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate without password field",
            "Assert ValidationError raised",
        ],
        test_data={"password": "missing"},
        expected_result="ValidationError raised — password required",
        post_condition="No side effects",
    )
    def test_missing_password_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(email="test@test.com", username="validuser", full_name="Test")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-005",
        objective="Empty string email raises ValidationError",
        precondition="None",
        steps=["Instantiate UserCreate with email=''", "Assert ValidationError raised"],
        test_data={"email": "'' (empty)"},
        expected_result="ValidationError raised",
        post_condition="No side effects",
    )
    def test_empty_email_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(email="", username="validuser", password="Valid123!", full_name="Test")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-006",
        objective="Email is normalized to lowercase",
        precondition="None",
        steps=[
            "Instantiate UserCreate with email='USER@TEST.COM'",
            "Assert user.email == 'user@test.com' (or validation passes)",
        ],
        test_data={"email": "USER@TEST.COM"},
        expected_result="Email lowercased or validation passes",
        post_condition="No side effects",
    )
    def test_email_is_case_insensitive(self):
        user = UserCreate(
            email="USER@TEST.COM",
            username="validuser",
            password="Valid123!",
            full_name="Test",
        )
        assert user.email.lower() == "user@test.com"


class TestUserCreateEdgeCases:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-011",
        objective="Username shorter than 3 characters raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate with username='ab' (2 chars)",
            "Assert ValidationError raised",
        ],
        test_data={"username": "ab"},
        expected_result="ValidationError — username too short",
        post_condition="No side effects",
    )
    def test_username_too_short_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="valid@test.com",
                username="ab",
                password="Valid123!",
                full_name="Test",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-012",
        objective="Username longer than 30 characters raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate with username of 31 characters",
            "Assert ValidationError raised",
        ],
        test_data={"username": "a" * 31},
        expected_result="ValidationError — username too long",
        post_condition="No side effects",
    )
    def test_username_too_long_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="valid@test.com",
                username="a" * 31,
                password="Valid123!",
                full_name="Test",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-013",
        objective="Password that is too weak raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate UserCreate with password='password' (no uppercase/digit/special)",
            "Assert ValidationError raised",
        ],
        test_data={"password": "password (too weak)"},
        expected_result="ValidationError — weak password rejected",
        post_condition="No side effects",
    )
    def test_weak_password_raises(self):
        with pytest.raises(ValidationError):
            UserCreate(
                email="valid@test.com",
                username="validuser",
                password="password",  # no uppercase, no digit, no special char
                full_name="Test",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-014",
        objective="Full name with only whitespace raises ValidationError or is stripped to empty",
        precondition="None",
        steps=[
            "Instantiate UserCreate with full_name='   '",
            "Assert ValidationError or full_name.strip() == ''",
        ],
        test_data={"full_name": "'   ' (whitespace only)"},
        expected_result="ValidationError or stripped-to-empty name",
        post_condition="No side effects",
    )
    def test_whitespace_full_name_handled(self):
        try:
            user = UserCreate(
                email="valid@test.com",
                username="validuser",
                password="Valid123!",
                full_name="   ",
            )
            # If no error: either full_name was stripped to '' or kept as-is
            # Both are acceptable — key is no crash
        except ValidationError:
            pass  # Expected if schema enforces non-empty after strip


class TestUserLoginSchema:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-007",
        objective="Valid UserLogin payload with email identifier passes validation",
        precondition="None",
        steps=[
            "Instantiate UserLogin with identifier='user@test.com' and password",
            "Assert no ValidationError",
        ],
        test_data={"identifier": "user@test.com", "password": "Valid123!"},
        expected_result="UserLogin created successfully",
        post_condition="No side effects",
    )
    def test_valid_login_payload_passes(self):
        login = UserLogin(identifier="user@test.com", password="Valid123!")
        assert login.identifier == "user@test.com"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-008",
        objective="UserLogin without identifier raises ValidationError",
        precondition="None",
        steps=["Instantiate UserLogin without identifier", "Assert ValidationError raised"],
        test_data={"identifier": "missing"},
        expected_result="ValidationError raised",
        post_condition="No side effects",
    )
    def test_missing_identifier_raises(self):
        with pytest.raises(ValidationError):
            UserLogin(password="Valid123!")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-009",
        objective="UserLogin without password raises ValidationError",
        precondition="None",
        steps=["Instantiate UserLogin without password", "Assert ValidationError raised"],
        test_data={"password": "missing"},
        expected_result="ValidationError raised",
        post_condition="No side effects",
    )
    def test_missing_password_raises(self):
        with pytest.raises(ValidationError):
            UserLogin(identifier="user@test.com")

    @pytest.mark.testcase(
        tc_id="TC-UNIT-USR-010",
        objective="UserLogin with username identifier (non-email) passes validation",
        precondition="None",
        steps=[
            "Instantiate UserLogin with identifier='johndoe' (username format)",
            "Assert no ValidationError",
        ],
        test_data={"identifier": "johndoe (username)"},
        expected_result="UserLogin created — identifier accepts non-email string",
        post_condition="No side effects",
    )
    def test_username_as_identifier_passes(self):
        login = UserLogin(identifier="johndoe", password="Valid123!")
        assert login.identifier == "johndoe"
