"""
Integration Tests — Project membership and role-based access control

Covers: active member access, non-member access denied, removed member access denied,
        role-specific endpoint permissions (PM, Safety Officer, Stakeholder).
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Membership & RBAC"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project, _make_user
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.PROJECT_MANAGER,
                status=MembershipStatus.ACTIVE):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=status, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


class TestMemberAccess:
    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-001",
        objective="Active member can access project detail",
        precondition="ACTIVE project; regular_user is an ACTIVE member",
        steps=[
            "Add regular_user as ACTIVE PROJECT_MANAGER member",
            "GET /projects/{id} as regular_user",
            "Assert HTTP 200",
        ],
        test_data={"membership_status": "ACTIVE"},
        expected_result="HTTP 200, project detail returned",
        post_condition="No state change",
    )
    def test_active_member_can_access_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Member Access Project", location="Zurich",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-002",
        objective="Non-member cannot access project detail (403/404)",
        precondition="ACTIVE project; regular_user has no membership",
        steps=[
            "GET /projects/{id} as non-member regular_user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_access_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Non Member Project", location="Geneva",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-003",
        objective="REMOVED member cannot access project detail (403/404)",
        precondition="ACTIVE project; regular_user membership status = REMOVED",
        steps=[
            "Add member then set status=REMOVED",
            "GET /projects/{id}",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership_status": "REMOVED"},
        expected_result="HTTP 403 or 404",
        post_condition="Removed member has no access",
    )
    def test_removed_member_cannot_access_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Removed Member Project", location="Basel",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id,
                    status=MembershipStatus.REMOVED)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code in (403, 404)


class TestRoleSpecificAccess:
    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-004",
        objective="PM role can list project tasks",
        precondition="ACTIVE project; regular_user has PROJECT_MANAGER role",
        steps=[
            "Add regular_user as PROJECT_MANAGER",
            "GET /projects/{id}/tasks",
            "Assert HTTP 200",
        ],
        test_data={"role": "PROJECT_MANAGER"},
        expected_result="HTTP 200",
        post_condition="No state change",
    )
    def test_pm_can_list_project_tasks(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="PM Tasks Project", location="Bern",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id,
                    role=ProjectRole.PROJECT_MANAGER)
        resp = client.get(f"/projects/{project.id}/tasks", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-005",
        objective="STAKEHOLDER role can read project (view-only)",
        precondition="ACTIVE project; regular_user has STAKEHOLDER role",
        steps=[
            "Add regular_user as STAKEHOLDER",
            "GET /projects/{id}",
            "Assert HTTP 200",
        ],
        test_data={"role": "STAKEHOLDER"},
        expected_result="HTTP 200",
        post_condition="No state change",
    )
    def test_stakeholder_can_read_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Stakeholder Project", location="Lausanne",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id,
                    role=ProjectRole.STAKEHOLDER)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-RBAC-006",
        objective="SAFETY_OFFICER role can list PPE incidents",
        precondition="ACTIVE project; regular_user has SAFETY_OFFICER role",
        steps=[
            "Add regular_user as SAFETY_OFFICER",
            "GET /projects/{id}/ppe/incidents",
            "Assert HTTP 200",
        ],
        test_data={"role": "SAFETY_OFFICER"},
        expected_result="HTTP 200",
        post_condition="No state change",
    )
    def test_safety_officer_can_list_ppe_incidents(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Safety Officer Project", location="Interlaken",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id,
                    role=ProjectRole.SAFETY_OFFICER)
        resp = client.get(f"/projects/{project.id}/ppe/incidents", headers=user_headers)
        assert resp.status_code == 200
