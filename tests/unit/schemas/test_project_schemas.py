"""
Unit tests for Project Pydantic schemas — ProjectCreate, ProjectSetup.

No DB or HTTP — pure schema validation in isolation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Unit Tests"),
    allure.story("Schemas — Project Validation"),
    pytest.mark.unit,
]

from datetime import date, timedelta
from pydantic import ValidationError

from app.schemas.project import ProjectCreate


_FUTURE = (date.today() + timedelta(days=365)).isoformat()
_PAST = (date.today() - timedelta(days=1)).isoformat()


class TestProjectCreateSchema:
    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-001",
        objective="Valid ProjectCreate payload with pm_email passes validation",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with name, location, end_date, pm_email, pm_full_name",
            "Assert no ValidationError raised",
        ],
        test_data={"name": "Site Alpha", "location": "London",
                   "pm_email": "pm@test.com", "pm_full_name": "PM Name"},
        expected_result="ProjectCreate instance created successfully",
        post_condition="No side effects",
    )
    def test_valid_payload_with_pm_email_passes(self):
        proj = ProjectCreate(
            name="Site Alpha",
            location="London",
            end_date=_FUTURE,
            pm_email="pm@test.com",
            pm_full_name="PM Name",
        )
        assert proj.name == "Site Alpha"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-002",
        objective="Missing project name raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate without name field",
            "Assert ValidationError raised",
        ],
        test_data={"name": "missing"},
        expected_result="ValidationError raised — name required",
        post_condition="No side effects",
    )
    def test_missing_name_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                location="London",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-003",
        objective="Missing location raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate without location field",
            "Assert ValidationError raised",
        ],
        test_data={"location": "missing"},
        expected_result="ValidationError raised — location required",
        post_condition="No side effects",
    )
    def test_missing_location_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="Site Alpha",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-004",
        objective="Empty project name raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with name=''",
            "Assert ValidationError raised",
        ],
        test_data={"name": "'' (empty)"},
        expected_result="ValidationError raised — name cannot be empty",
        post_condition="No side effects",
    )
    def test_empty_name_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="",
                location="London",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-005",
        objective="Invalid pm_email format raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with pm_email='not-an-email'",
            "Assert ValidationError raised",
        ],
        test_data={"pm_email": "not-an-email"},
        expected_result="ValidationError raised — invalid email format",
        post_condition="No side effects",
    )
    def test_invalid_pm_email_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="Site Alpha",
                location="London",
                end_date=_FUTURE,
                pm_email="not-an-email",
                pm_full_name="PM Name",
            )

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-006",
        objective="Name field is stripped of leading/trailing whitespace",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with name='  Site Alpha  '",
            "Assert proj.name == 'Site Alpha'",
        ],
        test_data={"name": "  Site Alpha  (with whitespace)"},
        expected_result="proj.name == 'Site Alpha'",
        post_condition="No side effects",
    )
    def test_name_is_stripped(self):
        proj = ProjectCreate(
            name="  Site Alpha  ",
            location="London",
            end_date=_FUTURE,
            pm_email="pm@test.com",
            pm_full_name="PM Name",
        )
        assert proj.name == "Site Alpha"

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-007",
        objective="Very long project name is handled (no crash)",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with name of 300 characters",
            "Assert either ValidationError (length limit) or success",
        ],
        test_data={"name": "A * 300"},
        expected_result="ValidationError or success — no 500 error",
        post_condition="No side effects",
    )
    def test_very_long_name_does_not_crash(self):
        try:
            ProjectCreate(
                name="A" * 300,
                location="London",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )
        except ValidationError:
            pass  # Expected if schema enforces max length

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-007b",
        objective="Location with exactly 300 characters is handled (no crash)",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate with location of 300 characters",
            "Assert either ValidationError (max length) or success",
        ],
        test_data={"location": "A * 300"},
        expected_result="ValidationError or success — not a crash",
        post_condition="No side effects",
    )
    def test_location_max_length_does_not_crash(self):
        try:
            ProjectCreate(
                name="Site Alpha",
                location="A" * 300,
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )
        except ValidationError:
            pass  # Acceptable if schema enforces max length

    @pytest.mark.testcase(
        tc_id="TC-UNIT-PROJ-008",
        objective="Missing end_date raises ValidationError",
        precondition="None",
        steps=[
            "Instantiate ProjectCreate without end_date",
            "Assert ValidationError raised",
        ],
        test_data={"end_date": "missing"},
        expected_result="ValidationError raised — end_date required",
        post_condition="No side effects",
    )
    def test_missing_end_date_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="Site Alpha",
                location="London",
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    def test_numeric_only_project_name_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="123456",
                location="London",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    def test_numeric_only_location_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="Site Alpha",
                location="123456",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="PM Name",
            )

    def test_numeric_only_pm_full_name_raises(self):
        with pytest.raises(ValidationError):
            ProjectCreate(
                name="Site Alpha",
                location="London",
                end_date=_FUTURE,
                pm_email="pm@test.com",
                pm_full_name="123456",
            )

    def test_project_name_can_mix_letters_and_numbers(self):
        proj = ProjectCreate(
            name="Tower 7-A",
            location="Sector 12 Islamabad",
            end_date=_FUTURE,
            pm_email="pm@test.com",
            pm_full_name="PM Name",
        )
        assert proj.name == "Tower 7-A"
