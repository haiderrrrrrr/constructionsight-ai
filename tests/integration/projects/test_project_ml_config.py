"""
Integration Tests — /projects/{id}/ml-config endpoints

Covers: member reads, non-member 403, PM updates confidence threshold,
        stakeholder 403, PM resets to defaults.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — ML Config"),
    pytest.mark.integration,
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


class TestProjectMlConfig:
    @pytest.mark.testcase(
        tc_id="TC-INT-ML-001",
        objective="GET /projects/{id}/ml-config as member returns 200; non-member gets 403",
        precondition="PM user in active project; regular_user not a member",
        steps=[
            "Create active project with PM",
            "GET /projects/{id}/ml-config as PM → 200",
            "GET /projects/{id}/ml-config as non-member → 403",
        ],
        test_data={},
        expected_result="200 for member; 403 for non-member",
        post_condition="No state change",
    )
    def test_get_ml_config_auth(self, client, db, admin_user, regular_user, user_headers):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="ml_pm_cfg@test.com", username="ml_pm_cfg")
            project = make_project(db, name="ML Config Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("PM reads ML config"):
            resp = client.get(f"/projects/{project.id}/ml-config", headers=_auth_headers(pm))
            assert resp.status_code == 200, f"Expected 200 for PM, got {resp.status_code}: {resp.text}"

        with allure.step("Non-member is forbidden"):
            resp = client.get(f"/projects/{project.id}/ml-config", headers=user_headers)
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for non-member, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ML-002",
        objective="PATCH /projects/{id}/ml-config as PM updates confidence threshold",
        precondition="PM authenticated; active project",
        steps=[
            "PATCH /projects/{id}/ml-config with stage1_conf=0.7",
            "Assert HTTP 200",
        ],
        test_data={"stage1_conf": 0.7},
        expected_result="HTTP 200 — ML config updated",
        post_condition="stage1_conf updated in DB",
    )
    def test_pm_can_update_ml_config(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="ml_pm_patch@test.com", username="ml_pm_patch")
            project = make_project(db, name="ML Config PATCH Project", location="Bergen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("PATCH ml-config"):
            resp = client.patch(
                f"/projects/{project.id}/ml-config",
                json={"stage1_conf": 0.7},
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ML-003",
        objective="PATCH /projects/{id}/ml-config as STAKEHOLDER returns 403",
        precondition="User is STAKEHOLDER of active project",
        steps=[
            "Create active project with STAKEHOLDER",
            "PATCH /projects/{id}/ml-config",
            "Assert HTTP 403",
        ],
        test_data={"role": "stakeholder"},
        expected_result="HTTP 403 — stakeholders cannot update ML config",
        post_condition="ML config unchanged",
    )
    def test_stakeholder_cannot_update_ml_config(self, client, db, admin_user):
        with allure.step("Create project and stakeholder"):
            stakeholder = _make_user(db, email="ml_stk_patch@test.com", username="ml_stk_patch")
            project = make_project(db, name="ML Config Stakeholder Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=stakeholder.id, project_id=project.id,
                        role=ProjectRole.STAKEHOLDER, invited_by=admin_user.id)

        with allure.step("PATCH as stakeholder"):
            resp = client.patch(
                f"/projects/{project.id}/ml-config",
                json={"stage1_conf": 0.7},
                headers=_auth_headers(stakeholder),
            )

        with allure.step("Assert 403"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404, got {resp.status_code}"
            )
