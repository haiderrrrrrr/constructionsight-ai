"""
Integration Tests — /projects/{project_id}/notes endpoints

Covers: member list/create/update/delete, non-member blocked, unauthenticated blocked,
        note fields in response, non-existent note returns 404.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Notes"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


@pytest.fixture
def notes_project(db, admin_user, regular_user):
    project = make_project(db, name="Notes Test Project", location="Rotterdam",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    db.add(ProjectMembership(
        user_id=regular_user.id, project_id=project.id,
        project_role=ProjectRole.PROJECT_MANAGER,
        status=MembershipStatus.ACTIVE, invited_by=admin_user.id,
    ))
    db.flush()
    return project


class TestListNotes:
    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-001",
        objective="Project member can list notes — returns list",
        precondition="ACTIVE project; regular_user is PM member",
        steps=[
            "GET /projects/{id}/notes as member",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"membership": "ACTIVE PROJECT_MANAGER"},
        expected_result="HTTP 200, JSON array",
        post_condition="No state change",
    )
    def test_member_can_list_notes(self, client, notes_project, user_headers):
        resp = client.get(f"/projects/{notes_project.id}/notes", headers=user_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-002",
        objective="Unauthenticated cannot list notes (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/notes with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_notes(self, client, notes_project):
        resp = client.get(f"/projects/{notes_project.id}/notes")
        assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-003",
        objective="Non-member cannot list notes (403)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/notes as non-member",
            "Assert HTTP 403",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_list_notes(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Notes Forbidden", location="Utrecht",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/notes", headers=user_headers)
        assert resp.status_code == 403


class TestCreateNote:
    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-004",
        objective="Project member can create a note with correct title",
        precondition="ACTIVE project; regular_user is PM member",
        steps=[
            "POST /projects/{id}/notes with title and content",
            "Assert HTTP 200 or 201",
            "Assert title matches input",
        ],
        test_data={"title": "Site Visit Notes", "content": "Roof inspection done."},
        expected_result="HTTP 200/201, note object with matching title",
        post_condition="Note row created in DB",
    )
    def test_member_can_create_note(self, client, notes_project, user_headers):
        resp = client.post(f"/projects/{notes_project.id}/notes",
                           json={"title": "Site Visit Notes", "content": "Roof inspection done."},
                           headers=user_headers)
        assert resp.status_code in (200, 201)
        assert resp.json()["title"] == "Site Visit Notes"

    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-005",
        objective="Note response contains both title and content fields",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "POST /projects/{id}/notes",
            "Assert title == 'My Note'",
            "Assert content == 'Test content here'",
        ],
        test_data={"title": "My Note", "content": "Test content here"},
        expected_result="Response has title and content matching input",
        post_condition="Note stored with correct fields",
    )
    def test_note_fields_in_response(self, client, notes_project, user_headers):
        resp = client.post(f"/projects/{notes_project.id}/notes",
                           json={"title": "My Note", "content": "Test content here"},
                           headers=user_headers)
        assert resp.status_code in (200, 201)
        data = resp.json()
        assert data["title"] == "My Note"
        assert data["content"] == "Test content here"


class TestUpdateNote:
    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-006",
        objective="Member can update a note's content",
        precondition="Note exists in ACTIVE project; member authenticated",
        steps=[
            "Create a note",
            "PATCH /projects/{id}/notes/{note_id} with new content",
            "Assert HTTP 200",
            "Assert content matches updated value",
        ],
        test_data={"content": "Updated content"},
        expected_result="HTTP 200, content = 'Updated content'",
        post_condition="Note updated in DB",
    )
    def test_member_can_update_note(self, client, notes_project, user_headers):
        create = client.post(f"/projects/{notes_project.id}/notes",
                             json={"title": "Update Me", "content": "Original"},
                             headers=user_headers)
        note_id = create.json()["id"]
        resp = client.patch(f"/projects/{notes_project.id}/notes/{note_id}",
                            json={"content": "Updated content"},
                            headers=user_headers)
        assert resp.status_code == 200
        assert resp.json()["content"] == "Updated content"


class TestDeleteNote:
    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-007",
        objective="Member can delete their note",
        precondition="Note exists; member authenticated",
        steps=[
            "Create a note",
            "DELETE /projects/{id}/notes/{note_id}",
            "Assert HTTP 204",
        ],
        test_data={"action": "delete"},
        expected_result="HTTP 204 No Content",
        post_condition="Note row removed from DB",
    )
    def test_member_can_delete_note(self, client, notes_project, user_headers):
        create = client.post(f"/projects/{notes_project.id}/notes",
                             json={"title": "Delete Me Note", "content": "Bye"},
                             headers=user_headers)
        note_id = create.json()["id"]
        resp = client.delete(f"/projects/{notes_project.id}/notes/{note_id}",
                             headers=user_headers)
        assert resp.status_code == 204

    @pytest.mark.testcase(
        tc_id="TC-INT-NOT-008",
        objective="Deleting a non-existent note returns 404",
        precondition="No note with id=999999",
        steps=[
            "DELETE /projects/{id}/notes/999999",
            "Assert HTTP 404",
        ],
        test_data={"note_id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_delete_nonexistent_note_returns_404(self, client, notes_project, user_headers):
        resp = client.delete(f"/projects/{notes_project.id}/notes/999999",
                             headers=user_headers)
        assert resp.status_code == 404
