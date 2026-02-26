"""
Integration Tests — /projects/{id}/ppe endpoints

Covers: PPE summary (member/non-member/unauthenticated), incidents listing
        with filters, incident status update, events-enabled flag.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Analytics — PPE Detection"),
    pytest.mark.integration,
    pytest.mark.analytics,
]

from tests.conftest import make_project, make_site
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.SAFETY_OFFICER):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


def _make_camera(db, site_id, admin_id, name="Test Camera PPE"):
    from app.models.camera import Camera
    cam = Camera(
        site_id=site_id, name=name,
        registry_status="verified",
        created_by=admin_id,
    )
    db.add(cam)
    db.flush()
    return cam


@pytest.fixture
def ppe_project(db, admin_user, regular_user):
    site = make_site(db, name="PPE Test Site", created_by=admin_user.id)
    project = make_project(db, name="PPE Test Project", location="Manchester",
                           status=ProjectStatus.ACTIVE, created_by=admin_user.id,
                           site_id=site.id)
    _add_member(db, project.id, regular_user.id, admin_user.id)
    return project, site


class TestPpeSummary:
    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-001",
        objective="Safety Officer member can get PPE summary",
        precondition="ACTIVE project; regular_user is SAFETY_OFFICER member",
        steps=[
            "GET /projects/{id}/ppe/summary as member",
            "Assert HTTP 200",
        ],
        test_data={"role": "SAFETY_OFFICER"},
        expected_result="HTTP 200, PPE summary object",
        post_condition="No state change",
    )
    def test_member_can_get_ppe_summary(self, client, ppe_project, user_headers):
        project, _ = ppe_project
        resp = client.get(f"/projects/{project.id}/ppe/summary", headers=user_headers)
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-002",
        objective="Non-member cannot get PPE summary (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/ppe/summary as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_get_ppe_summary(self, client, db, admin_user, user_headers):
        project = make_project(db, name="PPE Forbidden Project", location="Leeds",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/ppe/summary", headers=user_headers)
        assert resp.status_code in (403, 404)

    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-003",
        objective="Unauthenticated cannot get PPE summary (401)",
        precondition="No Authorization header",
        steps=["GET /projects/{id}/ppe/summary with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_get_ppe_summary(self, client, ppe_project):
        project, _ = ppe_project
        resp = client.get(f"/projects/{project.id}/ppe/summary")
        assert resp.status_code == 401


class TestPpeIncidents:
    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-004",
        objective="Member can list PPE incidents — paginated response",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/ppe/incidents as member",
            "Assert HTTP 200",
            "Assert response has 'items' list and 'total' count",
        ],
        test_data={"membership": "SAFETY_OFFICER"},
        expected_result="HTTP 200, {items: [], total: N}",
        post_condition="No state change",
    )
    def test_member_can_list_incidents(self, client, ppe_project, user_headers):
        project, _ = ppe_project
        resp = client.get(f"/projects/{project.id}/ppe/incidents", headers=user_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "total" in data
        assert isinstance(data["items"], list)

    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-005",
        objective="PPE incidents can be filtered by incident_type",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/ppe/incidents?incident_type=no_helmet",
            "Assert HTTP 200",
        ],
        test_data={"incident_type": "no_helmet"},
        expected_result="HTTP 200, filtered incidents list",
        post_condition="No state change",
    )
    def test_incidents_filter_by_type(self, client, ppe_project, user_headers):
        project, _ = ppe_project
        resp = client.get(
            f"/projects/{project.id}/ppe/incidents?incident_type=no_helmet",
            headers=user_headers,
        )
        assert resp.status_code == 200

    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-006",
        objective="PPE incidents can be filtered by status",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/ppe/incidents?status=open",
            "Assert HTTP 200",
        ],
        test_data={"status": "open"},
        expected_result="HTTP 200, filtered incidents list",
        post_condition="No state change",
    )
    def test_incidents_filter_by_status(self, client, ppe_project, user_headers):
        project, _ = ppe_project
        resp = client.get(
            f"/projects/{project.id}/ppe/incidents?status=open",
            headers=user_headers,
        )
        assert resp.status_code == 200


class TestPpeIncidentStatus:
    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-007",
        objective="Member can acknowledge an open PPE incident",
        precondition="PPE incident with status='open' exists in project",
        steps=[
            "Create PpeIncident in DB with status='open'",
            "PATCH /projects/{id}/ppe/incidents/{incident_id}/status with status='acknowledged'",
            "Assert HTTP 200",
        ],
        test_data={"status": "acknowledged"},
        expected_result="HTTP 200, incident status updated",
        post_condition="Incident status set to 'acknowledged'",
    )
    def test_member_can_acknowledge_incident(self, client, db, ppe_project, admin_user, user_headers):
        from app.models.ppe_incident import PpeIncident
        from datetime import datetime, timezone

        project, site = ppe_project
        cam = _make_camera(db, site.id, admin_user.id)

        incident = PpeIncident(
            project_id=project.id,
            camera_id=cam.id,
            zone_id=None,
            zone_name="Zone A",
            has_helmet=False,
            has_vest=True,
            incident_type="no_helmet",
            started_at=datetime.now(timezone.utc),
            severity="medium",
            status="open",
        )
        db.add(incident)
        db.flush()

        resp = client.patch(
            f"/projects/{project.id}/ppe/incidents/{incident.id}/status",
            json={"status": "acknowledged"},
            headers=user_headers,
        )
        assert resp.status_code == 200


class TestPpeEventsToggle:
    @pytest.mark.testcase(
        tc_id="TC-INT-PPE-008",
        objective="Member can check whether PPE events are enabled",
        precondition="ACTIVE project; member authenticated",
        steps=[
            "GET /projects/{id}/ppe/events-enabled as member",
            "Assert HTTP 200",
        ],
        test_data={"membership": "SAFETY_OFFICER"},
        expected_result="HTTP 200, events-enabled flag returned",
        post_condition="No state change",
    )
    def test_member_can_check_events_enabled(self, client, ppe_project, user_headers):
        project, _ = ppe_project
        resp = client.get(f"/projects/{project.id}/ppe/events-enabled", headers=user_headers)
        assert resp.status_code == 200
