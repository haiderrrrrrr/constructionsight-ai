"""
Integration Tests — /projects/{id}/equipment endpoints

Covers: equipment summary, alerts (paginated), settings get/update,
        non-member blocked, unauthenticated blocked.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — Equipment Monitoring"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.SITE_SUPERVISOR):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


@pytest.fixture
def eq_project(db, admin_user, regular_user):
    project = make_project(db, name="Equipment Test Project", location="Glasgow",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project


class TestEquipmentSummary:
    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-001",
        objective="Member can get equipment monitoring summary",
        precondition="ACTIVE project; regular_user is SITE_SUPERVISOR member",
        steps=[
            "GET /projects/{id}/equipment/summary as member",
            "Assert HTTP 200",
        ],
        test_data={"role": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, equipment summary object",
        post_condition="No state change",
    )
    def test_member_can_get_summary(self, client, eq_project, user_headers):
        resp = client.get(f"/projects/{eq_project.id}/equipment/summary", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-002",
        objective="Non-member cannot get equipment summary (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/equipment/summary as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_get_summary(self, client, db, admin_user, user_headers):
        project = make_project(db, name="EQ Forbidden", location="Edinburgh",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/equipment/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-003",
        objective="Unauthenticated cannot get equipment summary (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/equipment/summary with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_blocked(self, client, eq_project):
        resp = client.get(f"/projects/{eq_project.id}/equipment/summary")
        assert resp.status_code == 401


class TestEquipmentAlerts:
    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-004",
        objective="Member can list equipment alerts — paginated response",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/equipment/alerts as member",
            "Assert HTTP 200",
            "Assert response has 'items' and 'total'",
        ],
        test_data={"membership": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, {items: [], total: N}",
        post_condition="No state change",
    )
    def test_member_can_list_alerts(self, client, eq_project, user_headers):
        resp = client.get(f"/projects/{eq_project.id}/equipment/alerts", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)


class TestEquipmentSettings:
    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-005",
        objective="Member can retrieve equipment detection settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/equipment/settings as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "SITE_SUPERVISOR"},
        expected_result="HTTP 200, settings object",
        post_condition="No state change",
    )
    def test_member_can_get_settings(self, client, eq_project, user_headers):
        resp = client.get(f"/projects/{eq_project.id}/equipment/settings", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-EQ-006",
        objective="Member can update equipment detection settings",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "PATCH /projects/{id}/equipment/settings",
            "Assert HTTP 200",
        ],
        test_data={"detect_unauthorized": True},
        expected_result="HTTP 200, updated settings",
        post_condition="Settings persisted in DB",
    )
    def test_member_can_update_settings(self, client, eq_project, user_headers):
        resp = client.patch(
            f"/projects/{eq_project.id}/equipment/settings",
            json={"detect_unauthorized": True},
            headers=user_headers,
        )
        assert resp.status_code == 200
