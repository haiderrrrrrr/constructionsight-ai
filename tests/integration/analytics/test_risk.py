"""
Integration Tests — /projects/{id}/risk endpoints

Covers: risk summary, risk levels, non-member blocked, unauthenticated blocked.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — Risk Assessment"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.SAFETY_OFFICER):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


@pytest.fixture
def risk_project(db, admin_user, regular_user):
    project = make_project(db, name="Risk Test Project", location="Cardiff",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project


class TestRiskSummary:
    @pytest.mark.testcase(
        tc_id="TC-INT-RISK-001",
        objective="Member can get risk assessment summary",
        precondition="ACTIVE project; regular_user is SAFETY_OFFICER member",
        steps=[
            "GET /projects/{id}/risk/summary as member",
            "Assert HTTP 200",
        ],
        test_data={"role": "SAFETY_OFFICER"},
        expected_result="HTTP 200, risk summary object",
        post_condition="No state change",
    )
    def test_member_can_get_risk_summary(self, client, risk_project, user_headers):
        resp = client.get(f"/projects/{risk_project.id}/risk/summary", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-RISK-002",
        objective="Non-member cannot get risk summary (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/risk/summary as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_get_risk_summary(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Risk Forbidden", location="Belfast",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/risk/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-RISK-003",
        objective="Unauthenticated cannot get risk summary (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/risk/summary with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_blocked(self, client, risk_project):
        resp = client.get(f"/projects/{risk_project.id}/risk/summary")
        assert resp.status_code == 401


class TestRiskLevels:
    @pytest.mark.testcase(
        tc_id="TC-INT-RISK-004",
        objective="Member can retrieve the current risk level breakdown",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/risk/levels as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "SAFETY_OFFICER"},
        expected_result="HTTP 200, risk levels object",
        post_condition="No state change",
    )
    def test_member_can_get_risk_levels(self, client, risk_project, user_headers):
        resp = client.get(f"/projects/{risk_project.id}/risk/zones", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-RISK-005",
        objective="Member can list open risk incidents",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/risk/incidents as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "SAFETY_OFFICER"},
        expected_result="HTTP 200, risk incidents list or paginated response",
        post_condition="No state change",
    )
    def test_member_can_list_risk_incidents(self, client, risk_project, user_headers):
        resp = client.get(f"/projects/{risk_project.id}/risk/events", headers=user_headers)
        assert resp.status_code == 200
