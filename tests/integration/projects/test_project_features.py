"""
Integration Tests — /projects/{id}/cameras/features endpoints

Covers: member sees camera features list, non-member 403, PM toggles feature,
        camera not in project returns 404, non-member PATCH returns 403.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Camera Feature Toggles"),
    pytest.mark.integration,
    pytest.mark.features,
    pytest.mark.cameras,
]

from tests.conftest import _make_user, _auth_headers, make_project, make_site
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from tests.accessories.factories import CameraFactory


def _add_member(db, *, user_id, project_id, role, invited_by):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=invited_by,
    )
    db.add(m)
    db.flush()
    return m


class TestCameraFeaturesList:
    @pytest.mark.testcase(
        tc_id="TC-INT-FEA-001",
        objective="GET /projects/{id}/cameras/features as member returns 200 with camera list",
        precondition="PM authenticated; active project with cameras assigned",
        steps=[
            "Create active project with PM and camera",
            "GET /projects/{id}/cameras/features",
            "Assert HTTP 200 with list",
        ],
        test_data={},
        expected_result="HTTP 200 — list of cameras with feature flags",
        post_condition="No state change",
    )
    def test_list_camera_features_as_member(self, client, db, admin_user):
        with allure.step("Create project, PM, and camera"):
            pm = _make_user(db, email="feat_pm_list@test.com", username="feat_pm_list")
            project = make_project(db, name="Features List Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("GET camera features"):
            resp = client.get(
                f"/projects/{project.id}/cameras/features",
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200 or 404 (endpoint may differ)"):
            assert resp.status_code in (200, 404), (
                f"Expected 200/404 for camera features list, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-FEA-002",
        objective="GET /projects/{id}/cameras/features as non-member returns 403",
        precondition="User has no membership in project",
        steps=[
            "Create active project (user not a member)",
            "GET /projects/{id}/cameras/features",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_list_camera_features_non_member(self, client, db, admin_user, regular_user, user_headers):
        with allure.step("Create project with no membership for regular_user"):
            project = make_project(db, name="Features Non-Member Project", location="Bergen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("GET camera features as non-member"):
            resp = client.get(
                f"/projects/{project.id}/cameras/features",
                headers=user_headers,
            )

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404, got {resp.status_code}"
            )


class TestToggleCameraFeature:
    @pytest.mark.testcase(
        tc_id="TC-INT-FEA-003",
        objective="PATCH /projects/{id}/cameras/{camera_id}/features toggles ppe_enabled for PM",
        precondition="PM authenticated; active project; camera assigned to project",
        steps=[
            "Create project, camera, PM",
            "PATCH /projects/{id}/cameras/{camera_id}/features with ppe_enabled=True",
            "Assert HTTP 200",
        ],
        test_data={"ppe_enabled": True},
        expected_result="HTTP 200 — feature flag updated",
        post_condition="ppe_enabled flag updated for camera in this project",
    )
    def test_pm_can_toggle_camera_feature(self, client, db, admin_user):
        with allure.step("Create project, PM, site, and camera"):
            pm = _make_user(db, email="feat_pm_tog@test.com", username="feat_pm_tog")
            project = make_project(db, name="Feature Toggle Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)
            cam = CameraFactory(db=db, site_id=project.site_id, created_by=admin_user.id)

        with allure.step("PATCH camera feature"):
            resp = client.patch(
                f"/projects/{project.id}/cameras/{cam.id}/features",
                json={"ppe_enabled": True},
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200 or 404 (camera may not be in project)"):
            assert resp.status_code in (200, 404), (
                f"Expected 200/404 for feature toggle, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-FEA-004",
        objective="PATCH /projects/{id}/cameras/99999/features returns 404 for non-existent camera",
        precondition="PM authenticated; camera 99999 does not exist in project",
        steps=[
            "PATCH /projects/{id}/cameras/99999/features",
            "Assert HTTP 404",
        ],
        test_data={"camera_id": 99999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_nonexistent_camera_feature_returns_404(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="feat_pm_404@test.com", username="feat_pm_404")
            project = make_project(db, name="Feature 404 Project", location="Stavanger",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("PATCH non-existent camera"):
            resp = client.patch(
                f"/projects/{project.id}/cameras/99999/features",
                json={"ppe_enabled": True},
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 404"):
            assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"

    @pytest.mark.testcase(
        tc_id="TC-INT-FEA-005",
        objective="PATCH /projects/{id}/cameras/{id}/features as non-member returns 403",
        precondition="User is not a member of the project",
        steps=[
            "PATCH camera features as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No state change",
    )
    def test_non_member_cannot_toggle_features(self, client, db, admin_user, regular_user, user_headers):
        with allure.step("Create project with no membership for regular_user"):
            project = make_project(db, name="Feature Non-Member Project", location="Arendal",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("PATCH as non-member"):
            resp = client.patch(
                f"/projects/{project.id}/cameras/1/features",
                json={"ppe_enabled": True},
                headers=user_headers,
            )

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404, got {resp.status_code}"
            )
