"""
Integration Tests — /projects/{id}/workforce endpoints

Covers: workforce summary (member/non-member/unauthenticated),
        alerts listing (paginated), settings get/update.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — Workforce Monitoring"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=ProjectRole.SITE_SUPERVISOR,
        status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


@pytest.fixture
def wf_project(db, admin_user, regular_user):
    project = make_project(db, name="Workforce Test Project", location="Birmingham",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project


class TestWorkforceSummary:
    @pytest.mark.testcase(
        tc_id="TC-INT-WF-001",
        objective="Site Supervisor member can get workforce summary",
        precondition="ACTIVE project; regular_user is SITE_SUPERVISOR member",
        steps=[
            "GET /projects/{id}/workforce/summary as member",
            "Assert HTTP 200",
        ],
        test_data={"role": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, workforce summary object",
        post_condition="No state change",
    )
    def test_member_can_get_summary(self, client, wf_project, user_headers):
        resp = client.get(f"/projects/{wf_project.id}/workforce/summary", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-WF-002",
        objective="Non-member cannot get workforce summary (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/workforce/summary as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_blocked(self, client, db, admin_user, user_headers):
        project = make_project(db, name="WF Forbidden", location="Bristol",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/workforce/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-WF-003",
        objective="Unauthenticated cannot get workforce summary (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/workforce/summary with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_blocked(self, client, wf_project):
        resp = client.get(f"/projects/{wf_project.id}/workforce/summary")
        assert resp.status_code == 401


class TestWorkforceAlerts:
    @pytest.mark.testcase(
        tc_id="TC-INT-WF-004",
        objective="Member can list workforce alerts — paginated response",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/workforce/alerts as member",
            "Assert HTTP 200",
            "Assert response has 'items' list and 'total' count",
        ],
        test_data={"membership": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, {items: [], total: N}",
        post_condition="No state change",
    )
    def test_member_can_list_alerts(self, client, wf_project, user_headers):
        resp = client.get(f"/projects/{wf_project.id}/workforce/alerts", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)


class TestWorkforceSettings:
    @pytest.mark.testcase(
        tc_id="TC-INT-WF-005",
        objective="Member can retrieve workforce capacity settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/workforce/settings as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, settings object",
        post_condition="No state change",
    )
    def test_member_can_get_settings(self, client, wf_project, user_headers):
        resp = client.get(f"/projects/{wf_project.id}/workforce/settings", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-WF-006",
        objective="Member can update workforce capacity settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "PATCH /projects/{id}/workforce/settings with required_workers=5, max_workers=20",
            "Assert HTTP 200",
        ],
        test_data={"required_workers": 5, "max_workers": 20},
        expected_result="HTTP 200, updated settings",
        post_condition="Settings persisted in DB",
    )
    def test_member_can_update_settings(self, client, wf_project, user_headers):
        resp = client.patch(
            f"/projects/{wf_project.id}/workforce/settings",
            json={"required_workers": 5, "max_workers": 20},
            headers=user_headers,
        )
        assert resp.status_code == 200
