"""
Integration Tests — /admin/projects endpoints

Covers: create project, edit DRAFT project, delete DRAFT project,
        archive (ACTIVE→ARCHIVED), unarchive (ARCHIVED→ACTIVE),
        duplicate name guard, PM assignment by id or email.
"""
import allure
import pytest
from datetime import date, timedelta

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Project Management"),
    pytest.mark.integration,
    pytest.mark.admin,
    pytest.mark.projects,
]

from tests.conftest import _make_user, make_project, make_site
from app.models.project import ProjectStatus

_FUTURE = (date.today() + timedelta(days=365)).isoformat()


def _create_payload(name="Test Project Alpha", location="London", **kwargs):
    base = {
        "name": name,
        "location": location,
        "end_date": _FUTURE,
        "pm_email": "pm@example.com",
        "pm_full_name": "PM Person",
    }
    base.update(kwargs)
    return base


class TestCreateProject:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-001",
        objective="Admin creates a project and receives HTTP 201",
        precondition="Authenticated admin user, valid project payload",
        steps=[
            "POST /admin/projects with name, location, end_date, pm_email",
            "Assert HTTP 201 Created",
        ],
        test_data={"name": "Test Project Alpha", "location": "London",
                   "pm_email": "pm@example.com"},
        expected_result="HTTP 201, project object returned",
        post_condition="Project row in DB with status=draft, site auto-created",
    )
    def test_admin_creates_project_returns_201(self, client, admin_headers):
        resp = client.post("/admin/projects", json=_create_payload(), headers=admin_headers)
        assert resp.status_code == 201

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-002",
        objective="Newly created project has DRAFT status",
        precondition="Authenticated admin, unique project name",
        steps=[
            "POST /admin/projects with unique name",
            "Assert HTTP 201",
            "Assert status == 'draft'",
        ],
        test_data={"name": "Draft Status Project"},
        expected_result="HTTP 201, status field == 'draft'",
        post_condition="Project starts in DRAFT lifecycle state",
    )
    def test_created_project_has_draft_status(self, client, admin_headers):
        resp = client.post("/admin/projects", json=_create_payload(name="Draft Status Project"),
                           headers=admin_headers)
        assert resp.status_code == 201
        assert resp.json()["status"] == "draft"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-003",
        objective="Creating a project auto-creates a site row",
        precondition="Authenticated admin",
        steps=[
            "Count sites before POST",
            "POST /admin/projects",
            "Count sites after POST",
            "Assert count increased by 1",
        ],
        test_data={"name": "SiteAutoProject"},
        expected_result="Site count incremented by 1",
        post_condition="New site record linked to the created project",
    )
    def test_create_auto_creates_site(self, client, db, admin_headers):
        from app.models.site import Site
        before = db.query(Site).count()
        client.post("/admin/projects", json=_create_payload(name="SiteAutoProject"),
                    headers=admin_headers)
        after = db.query(Site).count()
        assert after == before + 1

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-004",
        objective="Duplicate project name returns HTTP 409",
        precondition="Project named 'UniqueProj' already exists",
        steps=[
            "POST /admin/projects with name='UniqueProj'",
            "POST /admin/projects with same name again",
            "Assert second request returns HTTP 409",
        ],
        test_data={"name": "UniqueProj (duplicate)"},
        expected_result="HTTP 409 Conflict on second create",
        post_condition="Only one project with that name exists",
    )
    def test_duplicate_project_name_returns_409(self, client, admin_headers):
        client.post("/admin/projects", json=_create_payload(name="UniqueProj"),
                    headers=admin_headers)
        resp = client.post("/admin/projects", json=_create_payload(name="UniqueProj"),
                           headers=admin_headers)
        assert resp.status_code == 409

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-005",
        objective="Regular user cannot create a project (403)",
        precondition="Authenticated regular (non-admin) user",
        steps=[
            "POST /admin/projects with regular user token",
            "Assert HTTP 403 Forbidden",
        ],
        test_data={"role": "user (non-admin)"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No project created",
    )
    def test_regular_user_cannot_create_project(self, client, user_headers):
        resp = client.post("/admin/projects", json=_create_payload(), headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-006",
        objective="Creating project with existing PM user_id succeeds",
        precondition="Regular user exists; admin authenticated",
        steps=[
            "POST /admin/projects with pm_user_id = regular_user.id",
            "Assert HTTP 201",
        ],
        test_data={"pm_user_id": "<regular_user.id>"},
        expected_result="HTTP 201, project created with existing PM assigned",
        post_condition="PM invitation skipped; membership or invitation created",
    )
    def test_create_with_existing_pm_user_id(self, client, db, admin_headers, regular_user):
        payload = {
            "name": "PM User Project",
            "location": "Paris",
            "end_date": _FUTURE,
            "pm_user_id": regular_user.id,
        }
        resp = client.post("/admin/projects", json=payload, headers=admin_headers)
        assert resp.status_code == 201

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-007",
        objective="Creating project with non-existent pm_user_id returns 404",
        precondition="No user with id=999999 in DB",
        steps=[
            "POST /admin/projects with pm_user_id=999999",
            "Assert HTTP 404 Not Found",
        ],
        test_data={"pm_user_id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No project created",
    )
    def test_create_with_nonexistent_pm_user_id_returns_404(self, client, admin_headers):
        payload = {
            "name": "Ghost PM Project",
            "location": "Tokyo",
            "end_date": _FUTURE,
            "pm_user_id": 999999,
        }
        resp = client.post("/admin/projects", json=payload, headers=admin_headers)
        assert resp.status_code == 404


class TestEditProject:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-008",
        objective="Admin can edit a DRAFT project's name and location",
        precondition="DRAFT project exists; admin authenticated",
        steps=[
            "PATCH /admin/projects/{id} with new name",
            "Assert HTTP 200",
        ],
        test_data={"name": "Edited Name", "location": "Berlin"},
        expected_result="HTTP 200, updated project returned",
        post_condition="Project name updated in DB",
    )
    def test_admin_can_edit_draft_project(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Edit Me", location="Berlin", created_by=admin_user.id)
        resp = client.patch(f"/admin/projects/{project.id}",
                            json={"name": "Edited Name", "location": "Berlin",
                                  "end_date": _FUTURE},
                            headers=admin_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-009",
        objective="Editing non-existent project returns 404",
        precondition="No project with id=999999",
        steps=[
            "PATCH /admin/projects/999999 with valid body",
            "Assert HTTP 404",
        ],
        test_data={"id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No changes made",
    )
    def test_edit_nonexistent_project_returns_404(self, client, admin_headers):
        resp = client.patch("/admin/projects/999999",
                            json={"name": "Ghost Project", "location": "Nowhere",
                                  "end_date": _FUTURE},
                            headers=admin_headers)
        assert resp.status_code == 404


class TestDeleteProject:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-010",
        objective="Admin can delete a DRAFT project via API",
        precondition="DRAFT project created via API (so all related rows exist)",
        steps=[
            "POST /admin/projects to create project",
            "DELETE /admin/projects/{id}",
            "Assert HTTP 200",
        ],
        test_data={"name": "Delete Me Via API"},
        expected_result="HTTP 200, project deleted",
        post_condition="Project row and associated site row removed from DB",
    )
    def test_admin_can_delete_draft_project(self, client, admin_headers):
        create_resp = client.post("/admin/projects",
                                  json=_create_payload(name="Delete Me Via API"),
                                  headers=admin_headers)
        assert create_resp.status_code == 201, create_resp.text
        project_id = create_resp.json()["id"]
        resp = client.delete(f"/admin/projects/{project_id}", headers=admin_headers)
        assert resp.status_code == 200, resp.text

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-011",
        objective="Deleting non-existent project returns 404",
        precondition="No project with id=999999",
        steps=[
            "DELETE /admin/projects/999999",
            "Assert HTTP 404",
        ],
        test_data={"id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_delete_nonexistent_project_returns_404(self, client, admin_headers):
        resp = client.delete("/admin/projects/999999", headers=admin_headers)
        assert resp.status_code == 404

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-012",
        objective="Regular user cannot delete a project (403)",
        precondition="DRAFT project exists; regular user authenticated",
        steps=[
            "DELETE /admin/projects/{id} with regular user token",
            "Assert HTTP 403",
        ],
        test_data={"role": "user (non-admin)"},
        expected_result="HTTP 403 Forbidden",
        post_condition="Project unchanged",
    )
    def test_user_cannot_delete_project(self, client, db, admin_user, user_headers):
        project = make_project(db, name="User Cannot Delete", location="Oslo",
                               created_by=admin_user.id)
        resp = client.delete(f"/admin/projects/{project.id}", headers=user_headers)
        assert resp.status_code == 403


class TestArchiveProject:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-013",
        objective="Admin can archive an ACTIVE project",
        precondition="ACTIVE project exists; admin authenticated",
        steps=[
            "PATCH /admin/projects/{id}/status with status='archived'",
            "Assert HTTP 200",
        ],
        test_data={"status": "archived"},
        expected_result="HTTP 200, project status changed to archived",
        post_condition="Project status=ARCHIVED, all writes blocked",
    )
    def test_admin_can_archive_active_project(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Archive Me", location="Madrid",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.patch(f"/admin/projects/{project.id}/status",
                            json={"status": "archived"}, headers=admin_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-014",
        objective="Admin can unarchive an ARCHIVED project back to ACTIVE",
        precondition="ARCHIVED project exists; admin authenticated",
        steps=[
            "POST /admin/projects/{id}/unarchive",
            "Assert HTTP 200",
        ],
        test_data={"current_status": "archived"},
        expected_result="HTTP 200, project status restored to active",
        post_condition="Project status=ACTIVE, writes allowed again",
    )
    def test_admin_can_unarchive_project(self, client, db, admin_headers, admin_user):
        project = make_project(db, name="Unarchive Me", location="Vienna",
                               status=ProjectStatus.ARCHIVED, created_by=admin_user.id)
        resp = client.post(f"/admin/projects/{project.id}/unarchive", headers=admin_headers)
        assert resp.status_code == 200
