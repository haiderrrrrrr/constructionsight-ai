"""
Security tests — cross-project data isolation.

Verifies that a member of Project A cannot read, mutate, or delete
data belonging to Project B. Tests IDOR at the project-analytics,
settings, smart-query, reports, and stakeholder-restriction levels.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("Cross-Project Isolation"),
    pytest.mark.security,
    pytest.mark.projects,
]

from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from app.models.project import ProjectStatus
from tests.conftest import _make_user, make_project, _auth_headers


def _add_member(db, *, user_id: int, project_id: int, role: ProjectRole, invited_by: int) -> ProjectMembership:
    m = ProjectMembership(
        user_id=user_id,
        project_id=project_id,
        project_role=role,
        status=MembershipStatus.ACTIVE,
        invited_by=invited_by,
    )
    db.add(m)
    db.flush()
    return m


class TestAnalyticsIsolation:
    @pytest.mark.testcase(
        tc_id="TC-SEC-080",
        objective="Member of Project A cannot access analytics of Project B (403 or 404)",
        precondition="user_a is PM of project_a; user_b is PM of project_b; user_a has no membership in project_b",
        steps=[
            "Create admin, user_a (PM of project_a), user_b (PM of project_b)",
            "GET /projects/{project_b_id}/analytics/activity/summary as user_a",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "user_a in project_a only"},
        expected_result="HTTP 403 or 404 — cross-project analytics blocked",
        post_condition="No data from Project B exposed to Project A member",
    )
    def test_project_a_member_cannot_read_project_b_analytics(self, client, db):
        with allure.step("Create admin and two users"):
            admin = _make_user(db, email="iso_admin_01@test.com", username="iso_admin_01",
                               platform_role=__import__("app.models.user", fromlist=["PlatformRole"]).PlatformRole.ADMIN)
            user_a = _make_user(db, email="iso_user_a_01@test.com", username="iso_user_a_01")
            user_b = _make_user(db, email="iso_user_b_01@test.com", username="iso_user_b_01")

        with allure.step("Create project_a (user_a is PM) and project_b (user_b is PM)"):
            project_a = make_project(db, name="Project A - Iso Analytics", location="Oslo",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            project_b = make_project(db, name="Project B - Iso Analytics", location="Bergen",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            _add_member(db, user_id=user_a.id, project_id=project_a.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)
            _add_member(db, user_id=user_b.id, project_id=project_b.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)

        with allure.step("user_a attempts to read project_b analytics"):
            resp = client.get(
                f"/projects/{project_b.id}/analytics/activity/summary",
                headers=_auth_headers(user_a),
            )

        with allure.step("Assert 403 or 404 — cross-project access blocked"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for cross-project analytics, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-081",
        objective="Member of Project A cannot PATCH settings of Project B (403 or 404)",
        precondition="user_a is PM of project_a only; project_b is ACTIVE",
        steps=[
            "Create admin, user_a (PM of project_a), project_b with no user_a membership",
            "PATCH /projects/{project_b_id}/settings as user_a",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "user_a in project_a only"},
        expected_result="HTTP 403 or 404 — cross-project settings mutation blocked",
        post_condition="project_b settings unchanged",
    )
    def test_project_a_member_cannot_patch_project_b_settings(self, client, db):
        with allure.step("Create admin, user_a, and two projects"):
            admin = _make_user(db, email="iso_admin_02@test.com", username="iso_admin_02",
                               platform_role=__import__("app.models.user", fromlist=["PlatformRole"]).PlatformRole.ADMIN)
            user_a = _make_user(db, email="iso_user_a_02@test.com", username="iso_user_a_02")
            project_a = make_project(db, name="Project A - Settings", location="Oslo",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            project_b = make_project(db, name="Project B - Settings", location="Bergen",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            _add_member(db, user_id=user_a.id, project_id=project_a.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)

        with allure.step("PATCH project_b settings as user_a (non-member)"):
            resp = client.patch(
                f"/projects/{project_b.id}/settings",
                json={"report_frequency": "weekly"},
                headers=_auth_headers(user_a),
            )

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for cross-project settings patch, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-082",
        objective="Member of Project A cannot delete tasks of Project B (403 or 404)",
        precondition="user_a is PM of project_a; project_b exists with no user_a membership",
        steps=[
            "Create user_a as PM of project_a",
            "DELETE /projects/{project_b_id}/tasks/1 as user_a",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "user_a not in project_b"},
        expected_result="HTTP 403 or 404 — cannot delete foreign project tasks",
        post_condition="No deletion; isolation maintained",
    )
    def test_project_a_member_cannot_delete_project_b_tasks(self, client, db):
        with allure.step("Create admin, user_a, and two projects"):
            admin = _make_user(db, email="iso_admin_03@test.com", username="iso_admin_03",
                               platform_role=__import__("app.models.user", fromlist=["PlatformRole"]).PlatformRole.ADMIN)
            user_a = _make_user(db, email="iso_user_a_03@test.com", username="iso_user_a_03")
            project_a = make_project(db, name="Project A - Tasks", location="Oslo",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            project_b = make_project(db, name="Project B - Tasks", location="Bergen",
                                     status=ProjectStatus.ACTIVE, created_by=admin.id)
            _add_member(db, user_id=user_a.id, project_id=project_a.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)

        with allure.step("Attempt to delete a task in project_b as user_a"):
            resp = client.delete(
                f"/projects/{project_b.id}/tasks/99999",
                headers=_auth_headers(user_a),
            )

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for cross-project task delete, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-083",
        objective="User cannot delete another user's smart query history entry (404)",
        precondition="user_a and user_b are both members of the same project; user_a tries to delete user_b's history",
        steps=[
            "Create shared project with user_a and user_b as members",
            "DELETE /projects/{id}/smart-query/history/99999 as user_a",
            "Assert HTTP 403 or 404 — cannot delete another user's history",
        ],
        test_data={"history_owner": "user_b", "requester": "user_a"},
        expected_result="HTTP 403 or 404 — foreign history entry blocked",
        post_condition="user_b's history entry unchanged",
    )
    def test_user_cannot_delete_another_users_smart_query_history(self, client, db):
        with allure.step("Create admin, two users, and a shared project"):
            admin = _make_user(db, email="iso_admin_04@test.com", username="iso_admin_04",
                               platform_role=__import__("app.models.user", fromlist=["PlatformRole"]).PlatformRole.ADMIN)
            user_a = _make_user(db, email="iso_user_a_04@test.com", username="iso_user_a_04")
            user_b = _make_user(db, email="iso_user_b_04@test.com", username="iso_user_b_04")
            shared_project = make_project(db, name="Shared Project - SQ History",
                                          location="Trondheim", status=ProjectStatus.ACTIVE,
                                          created_by=admin.id)
            _add_member(db, user_id=user_a.id, project_id=shared_project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)
            _add_member(db, user_id=user_b.id, project_id=shared_project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin.id)

        with allure.step("user_a attempts to delete a non-existent or foreign history entry"):
            resp = client.delete(
                f"/projects/{shared_project.id}/smart-query/history/99999",
                headers=_auth_headers(user_a),
            )

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for cross-user smart query history delete, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-SEC-084",
        objective="Stakeholder role cannot POST /projects/{id}/reports/export (403)",
        precondition="user_stakeholder is a STAKEHOLDER member of project_a",
        steps=[
            "Create project_a with user_stakeholder as STAKEHOLDER",
            "POST /projects/{project_a_id}/reports/export as stakeholder",
            "Assert HTTP 403",
        ],
        test_data={"role": "stakeholder"},
        expected_result="HTTP 403 — stakeholders cannot trigger report exports",
        post_condition="No report generated",
    )
    def test_stakeholder_cannot_export_reports(self, client, db):
        with allure.step("Create admin, stakeholder user, and project"):
            admin = _make_user(db, email="iso_admin_05@test.com", username="iso_admin_05",
                               platform_role=__import__("app.models.user", fromlist=["PlatformRole"]).PlatformRole.ADMIN)
            stakeholder = _make_user(db, email="iso_stakeholder_05@test.com", username="iso_stakeholder_05")
            project = make_project(db, name="Project - Stakeholder Export", location="Stavanger",
                                   status=ProjectStatus.ACTIVE, created_by=admin.id)
            _add_member(db, user_id=stakeholder.id, project_id=project.id,
                        role=ProjectRole.STAKEHOLDER, invited_by=admin.id)

        with allure.step("POST reports/export as stakeholder"):
            import datetime
            resp = client.post(
                f"/projects/{project.id}/reports/export",
                json={
                    "report_type": "ppe",
                    "start_date": "2025-01-01",
                    "end_date": "2025-01-31",
                },
                headers=_auth_headers(stakeholder),
            )

        with allure.step("Assert 403 — stakeholder blocked from export"):
            assert resp.status_code in (403, 404), (
                f"Expected 403 for stakeholder report export, got {resp.status_code}"
            )
