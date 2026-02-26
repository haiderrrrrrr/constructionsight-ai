"""
Integration Tests — Project status lifecycle transitions and pinning

Covers: newly created project has DRAFT status, cannot edit ARCHIVED project,
        cannot delete ACTIVE project, archived project cannot be archived again,
        user can pin/unpin projects.
"""
import allure
import pytest
from datetime import date, timedelta

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Lifecycle Transitions"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project, make_site
from app.models.project import ProjectStatus

_FUTURE = (date.today() + timedelta(days=365)).isoformat()


class TestProjectStatusTransitions:
    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-001",
        objective="Admin-created project starts in DRAFT status",
        precondition="Admin authenticated; unique project name",
        steps=[
            "POST /admin/projects with valid payload",
            "Assert HTTP 201",
            "Assert status == 'draft'",
        ],
        test_data={"name": "Lifecycle Test Project", "location": "Dublin"},
        expected_result="HTTP 201, status='draft'",
        post_condition="Project in DRAFT state — editable but not active",
    )
    def test_newly_created_project_has_draft_status(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "Lifecycle Test Project",
            "location": "Dublin",
            "end_date": _FUTURE,
            "pm_email": "pm@lifecycle.com",
            "pm_full_name": "Lifecycle PM",
        }, headers=admin_headers)
        assert resp.status_code == 201
        assert resp.json()["status"] == "draft"

    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-002",
        objective="ARCHIVED project cannot be edited (400/403/422)",
        precondition="ARCHIVED project exists; admin authenticated",
        steps=[
            "Create ARCHIVED project via DB",
            "PATCH /admin/projects/{id} with new name",
            "Assert HTTP 400, 403, or 422",
        ],
        test_data={"current_status": "archived"},
        expected_result="HTTP 400/403/422 — write blocked on archived project",
        post_condition="Project unchanged",
    )
    def test_cannot_edit_archived_project(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Frozen Project", location="Cairo",
                               status=ProjectStatus.ARCHIVED, created_by=admin_user.id)
        resp = client.patch(f"/admin/projects/{project.id}",
                            json={"name": "Try Edit", "location": "Cairo", "end_date": _FUTURE},
                            headers=admin_headers)
        assert resp.status_code in (400, 403, 422)

    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-003",
        objective="ACTIVE project cannot be deleted (400/403)",
        precondition="ACTIVE project exists; admin authenticated",
        steps=[
            "Create ACTIVE project via DB",
            "DELETE /admin/projects/{id}",
            "Assert HTTP 400 or 403",
        ],
        test_data={"current_status": "active"},
        expected_result="HTTP 400 or 403 — cannot delete active project",
        post_condition="Project unchanged",
    )
    def test_cannot_delete_active_project(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Active No Delete", location="Seoul",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.delete(f"/admin/projects/{project.id}", headers=admin_headers)
        assert resp.status_code in (400, 403)

    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-004",
        objective="Already-ARCHIVED project cannot be archived again",
        precondition="ARCHIVED project exists; admin authenticated",
        steps=[
            "Create ARCHIVED project via DB",
            "PATCH /admin/projects/{id}/status with status='archived'",
            "Assert HTTP 400, 409, or 422",
        ],
        test_data={"current_status": "archived", "target_status": "archived"},
        expected_result="HTTP 400/409/422 — cannot re-archive",
        post_condition="Project status unchanged",
    )
    def test_archived_project_cannot_be_archived_again(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Read Only Project", location="Bangkok",
                               status=ProjectStatus.ARCHIVED, created_by=admin_user.id)
        resp = client.patch(f"/admin/projects/{project.id}/status",
                            json={"status": "archived"}, headers=admin_headers)
        assert resp.status_code in (400, 409, 422)


class TestProjectPinning:
    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-005",
        objective="User can pin a project they are a member of",
        precondition="ACTIVE project exists; regular_user is PM member",
        steps=[
            "Create ACTIVE project, add regular_user as member",
            "POST /projects/{id}/pin as regular_user",
            "Assert HTTP 200 or 201",
        ],
        test_data={"action": "pin"},
        expected_result="HTTP 200 or 201 — project pinned",
        post_condition="PinnedProject row created for (user_id, project_id)",
    )
    def test_user_can_pin_their_project(self, client, db, admin_user, regular_user, user_headers):
        from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
        project = make_project(db, name="Pin This", location="Stockholm",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        db.add(ProjectMembership(
            user_id=regular_user.id, project_id=project.id,
            project_role=ProjectRole.PROJECT_MANAGER,
            status=MembershipStatus.ACTIVE, invited_by=admin_user.id,
        ))
        db.flush()
        resp = client.post(f"/projects/{project.id}/pin", headers=user_headers)
        assert resp.status_code in (200, 201)

    @pytest.mark.testcase(
        tc_id="TC-INT-LIFE-006",
        objective="User can unpin a previously pinned project",
        precondition="Project is pinned by regular_user",
        steps=[
            "Create ACTIVE project, add member",
            "POST /projects/{id}/pin",
            "DELETE /projects/{id}/pin",
            "Assert HTTP 200",
        ],
        test_data={"action": "unpin"},
        expected_result="HTTP 200 — project unpinned",
        post_condition="PinnedProject row removed",
    )
    def test_user_can_unpin_project(self, client, db, admin_user, regular_user, user_headers):
        from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
        project = make_project(db, name="Unpin This", location="Copenhagen",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        db.add(ProjectMembership(
            user_id=regular_user.id, project_id=project.id,
            project_role=ProjectRole.PROJECT_MANAGER,
            status=MembershipStatus.ACTIVE, invited_by=admin_user.id,
        ))
        db.flush()
        client.post(f"/projects/{project.id}/pin", headers=user_headers)
        resp = client.delete(f"/projects/{project.id}/pin", headers=user_headers)
        assert resp.status_code == 200
