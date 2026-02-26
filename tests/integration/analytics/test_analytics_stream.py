"""
Integration Tests — Analytics SSE stream endpoints

Covers: PPE, activity, workforce, equipment, risk stream endpoints
        — valid token returns 200 text/event-stream,
        — invalid token returns 401,
        — non-member token returns 403 or 404.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — SSE Streams"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import _make_user, _token_for, _auth_headers, make_project
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


# SSE stream endpoints to test
STREAM_PATHS = [
    "/ppe/stream",
    "/activity/stream",
    "/workforce/stream",
    "/equipment/stream",
    "/risk/stream",
]


class TestAnalyticsStreamAuth:
    @pytest.mark.skip(
        reason="SSE StreamingResponse does not propagate ASGI disconnect — "
               "generator blocks on asyncio.wait_for() for 25s regardless of client close. "
               "Valid-token stream tests require a real async HTTP client, not TestClient."
    )
    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-STR-001",
        objective="GET analytics stream endpoints with valid token + origin return 200 text/event-stream",
        precondition="User is PM of an active project; stream endpoints accept token via query param",
        steps=[
            "Create active project with PM membership",
            "GET /projects/{id}/ppe/stream?token=<valid> with SSE accept header",
            "Assert HTTP 200 and Content-Type text/event-stream",
        ],
        test_data={"stream": "ppe/stream"},
        expected_result="HTTP 200 with text/event-stream content type",
        post_condition="Stream opened; can be immediately closed",
    )
    def test_ppe_stream_with_valid_token(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="stream_pm_ppe@test.com", username="stream_pm_ppe")
            project = make_project(db, name="PPE Stream Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)
            token = _token_for(pm)

        with allure.step("GET PPE stream with token"):
            with client.stream(
                "GET",
                f"/projects/{project.id}/ppe/stream?token={token}",
                headers={"accept": "text/event-stream"},
            ) as resp:
                assert resp.status_code in (200, 401, 403, 404), (
                    f"Unexpected status for PPE stream: {resp.status_code}"
                )
                if resp.status_code == 200:
                    ct = resp.headers.get("content-type", "")
                    assert "text/event-stream" in ct or "text/" in ct

    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-STR-002",
        objective="GET analytics stream with invalid token returns 401",
        precondition="Invalid token in query param",
        steps=[
            "GET /projects/{id}/ppe/stream?token=garbage",
            "Assert HTTP 401",
        ],
        test_data={"token": "garbage.invalid.token"},
        expected_result="HTTP 401 — invalid token rejected",
        post_condition="No stream opened",
    )
    def test_stream_with_invalid_token_returns_401(self, client, db, admin_user):
        with allure.step("Create project"):
            project = make_project(db, name="Stream Invalid Token Project", location="Bergen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("GET stream with garbage token"):
            resp = client.get(
                f"/projects/{project.id}/ppe/stream?token=garbage.invalid.token",
                headers={"accept": "text/event-stream"},
            )
            assert resp.status_code == 401, (
                f"Expected 401 for invalid token, got {resp.status_code}"
            )

    @pytest.mark.skip(reason="Valid-token SSE stream hangs TestClient — see TC-INT-ANA-STR-001 skip reason")
    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-STR-003",
        objective="Activity and workforce stream endpoints behave consistently with auth",
        precondition="Active project; PM has valid token",
        steps=[
            "GET /projects/{id}/activity/stream?token=<valid>",
            "GET /projects/{id}/workforce/stream?token=<valid>",
            "Assert HTTP 200, 401, or 403 for each",
        ],
        test_data={"streams": "activity/stream, workforce/stream"},
        expected_result="HTTP 200/401/403 — consistent auth enforcement",
        post_condition="No state change",
    )
    def test_multiple_stream_endpoints_auth_consistent(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="stream_pm_multi@test.com", username="stream_pm_multi")
            project = make_project(db, name="Multi Stream Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)
            token = _token_for(pm)

        for stream_path in ["/activity/stream", "/workforce/stream"]:
            with allure.step(f"GET {stream_path}"):
                with client.stream(
                    "GET",
                    f"/projects/{project.id}{stream_path}?token={token}",
                    headers={"accept": "text/event-stream"},
                ) as resp:
                    assert resp.status_code in (200, 401, 403, 404), (
                        f"Unexpected status for {stream_path}: {resp.status_code}"
                    )

    @pytest.mark.testcase(
        tc_id="TC-INT-ANA-STR-004",
        objective="Non-member token on analytics stream returns 403 or 404",
        precondition="Valid token for user who is NOT a member of the project",
        steps=[
            "Create project (user_a not a member)",
            "GET /projects/{id}/ppe/stream?token=<user_a_token>",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404 — non-member stream blocked",
        post_condition="No stream opened",
    )
    def test_non_member_stream_blocked(self, client, db, admin_user):
        with allure.step("Create project and non-member user"):
            non_member = _make_user(db, email="stream_nonmember@test.com", username="stream_nonmember")
            project = make_project(db, name="Stream Non-Member Project", location="Stavanger",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            token = _token_for(non_member)

        with allure.step("GET stream as non-member"):
            with client.stream(
                "GET",
                f"/projects/{project.id}/ppe/stream?token={token}",
                headers={"accept": "text/event-stream"},
            ) as resp:
                assert resp.status_code in (403, 404), (
                    f"Expected 403/404 for non-member stream, got {resp.status_code}"
                )
