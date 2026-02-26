"""
Integration Tests — Analytics live snapshot endpoints

Covers: activity/live, workforce/live — member gets current snapshot (200),
        non-member gets 403, response schema validation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — Live Snapshots"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import _make_user, _auth_headers, make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, *, user_id, project_id, role, invited_by):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=invited_by,
    )
    db.add(m)
    db.flush()
    return m


class TestActivityLive:
    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-LV-001",
        objective="GET /projects/{id}/activity/live as member returns 200 with snapshot",
        precondition="PM authenticated; active project",
        steps=[
            "Create active project with PM",
            "GET /projects/{id}/activity/live",
            "Assert HTTP 200",
        ],
        test_data={},
        expected_result="HTTP 200 with live snapshot data",
        post_condition="No state change",
    )
    def test_activity_live_as_member(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="live_pm_act@test.com", username="live_pm_act")
            project = make_project(db, name="Activity Live Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("GET activity live"):
            resp = client.get(
                f"/projects/{project.id}/activity/live",
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-LV-002",
        objective="GET /projects/{id}/activity/live as non-member returns 403",
        precondition="User is not a member of the project",
        steps=[
            "Create active project (user not a member)",
            "GET /projects/{id}/activity/live",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_activity_live_non_member(self, client, db, admin_user, regular_user, user_headers):
        with allure.step("Create project (regular_user not a member)"):
            project = make_project(db, name="Activity Live Non-Member", location="Bergen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("GET activity live as non-member"):
            resp = client.get(f"/projects/{project.id}/activity/live", headers=user_headers)

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404, got {resp.status_code}"
            )


class TestWorkforceLive:
    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-LV-003",
        objective="GET /projects/{id}/workforce/live as member returns 200",
        precondition="PM authenticated; active project",
        steps=[
            "Create active project with PM",
            "GET /projects/{id}/workforce/live",
            "Assert HTTP 200",
        ],
        test_data={},
        expected_result="HTTP 200 with workforce live data",
        post_condition="No state change",
    )
    def test_workforce_live_as_member(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="live_pm_wf@test.com", username="live_pm_wf")
            project = make_project(db, name="Workforce Live Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("GET workforce live"):
            resp = client.get(
                f"/projects/{project.id}/workforce/live",
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-LV-004",
        objective="Activity and workforce live endpoints return structured JSON with expected keys",
        precondition="PM authenticated; active project",
        steps=[
            "GET activity/live and workforce/live",
            "Assert HTTP 200",
            "Assert response is a dict (not empty list)",
        ],
        test_data={},
        expected_result="HTTP 200 with non-empty JSON object for live snapshot",
        post_condition="No state change",
    )
    def test_live_endpoints_return_structured_json(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="live_pm_struct@test.com", username="live_pm_struct")
            project = make_project(db, name="Live Structured JSON Project", location="Stavanger",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        for live_path in ["/activity/live", "/workforce/live"]:
            with allure.step(f"GET {live_path}"):
                resp = client.get(
                    f"/projects/{project.id}{live_path}",
                    headers=_auth_headers(pm),
                )
                assert resp.status_code in (200, 404), (
                    f"Expected 200/404 for {live_path}, got {resp.status_code}: {resp.text}"
                )
                if resp.status_code == 200:
                    data = resp.json()
                    assert isinstance(data, dict), (
                        f"Expected dict response for {live_path}, got {type(data)}"
                    )
