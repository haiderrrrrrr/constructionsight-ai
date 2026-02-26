"""
Integration Tests — /projects/{id}/activity endpoints

Covers: activity summary (member/non-member/unauthenticated),
        alerts listing (paginated), settings get/update.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — Activity Monitoring"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=ProjectRole.DATA_ANALYST,
        status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


@pytest.fixture
def act_project(db, admin_user, regular_user):
    project = make_project(db, name="Activity Test Project", location="Sheffield",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project


class TestActivitySummary:
    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-001",
        objective="Member can get activity summary",
        precondition="ACTIVE project; regular_user is DATA_ANALYST member",
        steps=[
            "GET /projects/{id}/activity/summary as member",
            "Assert HTTP 200",
        ],
        test_data={"role": "DATA_ANALYST"},
        expected_result="HTTP 200, activity summary object",
        post_condition="No state change",
    )
    def test_member_can_get_summary(self, client, act_project, user_headers):
        resp = client.get(f"/projects/{act_project.id}/activity/summary", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-002",
        objective="Non-member cannot get activity summary (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/activity/summary as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_blocked(self, client, db, admin_user, user_headers):
        project = make_project(db, name="ACT Forbidden", location="Nottingham",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/activity/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-003",
        objective="Unauthenticated cannot get activity summary (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/activity/summary with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_blocked(self, client, act_project):
        resp = client.get(f"/projects/{act_project.id}/activity/summary")
        assert resp.status_code == 401


class TestActivityAlerts:
    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-004",
        objective="Member can list activity alerts — paginated response",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/activity/alerts as member",
            "Assert HTTP 200",
            "Assert response has 'items' list and 'total' count",
        ],
        test_data={"membership": "DATA_ANALYST"},
        expected_result="HTTP 200, {items: [], total: N}",
        post_condition="No state change",
    )
    def test_member_can_list_alerts(self, client, act_project, user_headers):
        resp = client.get(f"/projects/{act_project.id}/activity/alerts", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)


class TestActivitySettings:
    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-005",
        objective="Member can retrieve activity detection settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/activity/settings as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "DATA_ANALYST"},
        expected_result="HTTP 200, settings object",
        post_condition="No state change",
    )
    def test_member_can_get_settings(self, client, act_project, user_headers):
        resp = client.get(f"/projects/{act_project.id}/activity/settings", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-ACT-006",
        objective="Member can update activity detection settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "PATCH /projects/{id}/activity/settings with idle_threshold_seconds=120",
            "Assert HTTP 200",
        ],
        test_data={"idle_threshold_seconds": 120},
        expected_result="HTTP 200, updated settings",
        post_condition="Settings persisted in DB",
    )
    def test_member_can_update_settings(self, client, act_project, user_headers):
        resp = client.patch(
            f"/projects/{act_project.id}/activity/settings",
            json={"idle_threshold_seconds": 120},
            headers=user_headers,
        )
        assert resp.status_code == 200
