"""
Integration Tests — /projects endpoints (user-facing project views)

Covers: list projects, get project detail, member access control,
        removed member visibility.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — CRUD & Access Control"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_user, role=ProjectRole.PROJECT_MANAGER):
    membership = ProjectMembership(
        user_id=user_id,
        project_id=project_id,
        project_role=role,
        status=MembershipStatus.ACTIVE,
        invited_by=admin_user.id,
    )
    db.add(membership)
    db.flush()
    return membership


class TestListProjects:
    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-001",
        objective="Authenticated user can list their projects — returns list",
        precondition="Regular user authenticated",
        steps=[
            "GET /projects with valid Bearer token",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"role": "user"},
        expected_result="HTTP 200, JSON array",
        post_condition="No state change",
    )
    def test_authenticated_user_can_list_their_projects(self, client, user_headers):
        resp = client.get("/projects", headers=user_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-002",
        objective="Unauthenticated request to list projects returns 401",
        precondition="No Authorization header",
        steps=[
            "GET /projects with no token",
            "Assert HTTP 401",
        ],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_projects(self, client):
        resp = client.get("/projects")
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-003",
        objective="User only sees projects they are a member of",
        precondition="Two projects exist; user is member of only one",
        steps=[
            "Create project_mine and add regular_user as member",
            "Create project_other without adding regular_user",
            "GET /projects as regular_user",
            "Assert project_mine.id in ids",
        ],
        test_data={"membership": "member of project_mine only"},
        expected_result="project_mine included, project_other excluded",
        post_condition="No state change",
    )
    def test_user_only_sees_their_own_projects(self, client, db, admin_user, regular_user, user_headers):
        project_mine = make_project(db, name="My Project", location="Warsaw",
                                    status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project_mine.id, regular_user.id, admin_user)
        make_project(db, name="Not Mine", location="Budapest",
                     status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get("/projects", headers=user_headers)
        ids = [p["id"] for p in resp.json()]
        assert project_mine.id in ids

    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-004",
        objective="Removed member no longer sees the project in list",
        precondition="User was member but membership.status = REMOVED",
        steps=[
            "Create project, add user as ACTIVE member",
            "Set membership.status = REMOVED",
            "GET /projects as regular_user",
            "Assert project id NOT in response list",
        ],
        test_data={"membership_status": "REMOVED"},
        expected_result="Project excluded from user's project list",
        post_condition="No state change",
    )
    def test_removed_member_cannot_see_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Removed Member Project", location="Athens",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        membership = _add_member(db, project.id, regular_user.id, admin_user)
        membership.status = MembershipStatus.REMOVED
        db.flush()
        resp = client.get("/projects", headers=user_headers)
        ids = [p["id"] for p in resp.json()]
        assert project.id not in ids


class TestGetProjectDetail:
    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-005",
        objective="Project member can get full project detail",
        precondition="ACTIVE project; regular_user is a member",
        steps=[
            "GET /projects/{project.id} as member",
            "Assert HTTP 200",
            "Assert id matches project.id",
        ],
        test_data={"membership": "ACTIVE PROJECT_MANAGER"},
        expected_result="HTTP 200, project detail object with correct id",
        post_condition="No state change",
    )
    def test_member_can_get_project_detail(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Detail Project", location="Lisbon",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == project.id

    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-006",
        objective="Non-member cannot access project detail (403 or 404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{project.id} as non-member user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404 — access denied",
        post_condition="No state change",
    )
    def test_non_member_cannot_get_project_detail(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Forbidden Project", location="Prague",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-PROJ-007",
        objective="Non-existent project returns 403 or 404",
        precondition="No project with id=999999",
        steps=[
            "GET /projects/999999 as authenticated user",
            "Assert HTTP 403 or 404",
        ],
        test_data={"id": 999999},
        expected_result="HTTP 403 or 404",
        post_condition="No state change",
    )
    def test_nonexistent_project_returns_403_or_404(self, client, user_headers):
        resp = client.get("/projects/999999", headers=user_headers)
        assert resp.status_code in (403, 404)
