"""
Integration Tests — /projects/{id}/tasks endpoints

Covers: list tasks (member only), create task, mark done, delete task,
        non-member access blocked, unauthenticated blocked.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Task Management"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.PROJECT_MANAGER):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


def _task(title="Install safety nets", description="North wing area"):
    return {"title": title, "description": description}


@pytest.fixture
def task_project(db, admin_user, regular_user):
    project = make_project(db, name="Tasks Test Project", location="Leicester",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project


class TestListTasks:
    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-001",
        objective="Project member can list tasks — returns list",
        precondition="ACTIVE project; regular_user is PM member",
        steps=[
            "GET /projects/{id}/tasks as member",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"membership": "ACTIVE PROJECT_MANAGER"},
        expected_result="HTTP 200, JSON array of tasks",
        post_condition="No state change",
    )
    def test_member_can_list_tasks(self, client, task_project, user_headers):
        resp = client.get(f"/projects/{task_project.id}/tasks", headers=user_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-002",
        objective="Non-member cannot list project tasks (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/tasks as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_list_tasks(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Tasks Forbidden", location="Coventry",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/tasks", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-003",
        objective="Unauthenticated cannot list tasks (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/tasks with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_tasks(self, client, task_project):
        resp = client.get(f"/projects/{task_project.id}/tasks")
        assert resp.status_code == 401


class TestCreateTask:
    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-004",
        objective="Project member can create a task with title matching input",
        precondition="ACTIVE project; regular_user is PM member",
        steps=[
            "POST /projects/{id}/tasks with title and description",
            "Assert HTTP 200 or 201",
            "Assert title matches in response",
        ],
        test_data={"title": "Install safety nets", "description": "North wing area"},
        expected_result="HTTP 200/201, task object with matching title",
        post_condition="Task row created in DB with is_done=False",
    )
    def test_member_can_create_task(self, client, task_project, user_headers):
        resp = client.post(
            f"/projects/{task_project.id}/tasks",
            json=_task("Install safety nets"),
            headers=user_headers,
        )
        assert resp.status_code in (200, 201)
        assert resp.json()["title"] == "Install safety nets"

    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-005",
        objective="Newly created task has is_done=False",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "POST /projects/{id}/tasks",
            "Assert HTTP 200/201",
            "Assert is_done == False",
        ],
        test_data={"title": "Check scaffolding"},
        expected_result="is_done=False in response",
        post_condition="Task in pending state",
    )
    def test_task_created_with_is_done_false(self, client, task_project, user_headers):
        resp = client.post(
            f"/projects/{task_project.id}/tasks",
            json=_task("Check scaffolding"),
            headers=user_headers,
        )
        assert resp.status_code in (200, 201)
        assert resp.json()["is_done"] is False

    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-006",
        objective="Non-member cannot create a task (403/404)",
        precondition="ACTIVE project; user is NOT a member",
        steps=[
            "POST /projects/{id}/tasks as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No task created",
    )
    def test_non_member_cannot_create_task(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Create Task Forbidden", location="Exeter",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.post(
            f"/projects/{project.id}/tasks",
            json=_task("Should fail"),
            headers=user_headers,
        )
        assert resp.status_code in (403, 404)


class TestUpdateTask:
    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-007",
        objective="Member can toggle a task as done",
        precondition="Task exists in ACTIVE project; member authenticated",
        steps=[
            "Create a task",
            "PATCH /projects/{id}/tasks/{task_id}/toggle with is_done=True",
            "Assert HTTP 200",
            "Assert is_done == True",
        ],
        test_data={"is_done": True},
        expected_result="HTTP 200, is_done=True",
        post_condition="Task marked as done with done_at timestamp set",
    )
    def test_member_can_mark_task_done(self, client, task_project, user_headers):
        create = client.post(
            f"/projects/{task_project.id}/tasks",
            json=_task("Complete this"),
            headers=user_headers,
        )
        task_id = create.json()["id"]
        resp = client.patch(
            f"/projects/{task_project.id}/tasks/{task_id}/toggle",
            json={"is_done": True},
            headers=user_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["is_done"] is True


class TestDeleteTask:
    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-008",
        objective="Member can delete their task",
        precondition="Task exists; member authenticated",
        steps=[
            "Create a task",
            "DELETE /projects/{id}/tasks/{task_id}",
            "Assert HTTP 204",
        ],
        test_data={"action": "delete"},
        expected_result="HTTP 204 No Content",
        post_condition="Task row removed from DB",
    )
    def test_member_can_delete_task(self, client, task_project, user_headers):
        create = client.post(
            f"/projects/{task_project.id}/tasks",
            json=_task("Delete me task"),
            headers=user_headers,
        )
        task_id = create.json()["id"]
        resp = client.delete(f"/projects/{task_project.id}/tasks/{task_id}", headers=user_headers)
        assert resp.status_code == 204

    @pytest.mark.testcase(
        tc_id="TC-INT-TSK-009",
        objective="Deleting non-existent task returns 404",
        precondition="No task with id=999999",
        steps=[
            "DELETE /projects/{id}/tasks/999999",
            "Assert HTTP 404",
        ],
        test_data={"task_id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_delete_nonexistent_task_returns_404(self, client, task_project, user_headers):
        resp = client.delete(f"/projects/{task_project.id}/tasks/999999", headers=user_headers)
        assert resp.status_code == 404
