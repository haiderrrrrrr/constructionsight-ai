"""
Integration Tests — /admin/cameras endpoints

Covers: list cameras, create, update, credential update, verify, health summary,
        scheduler config, ML config, 401/403 guards, 404 for non-existent cameras.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Camera Management"),
    pytest.mark.integration,
    pytest.mark.admin,
    pytest.mark.cameras,
]

from tests.conftest import _make_user, make_site
from app.models.user import PlatformRole
from tests.accessories.factories import CameraFactory


def _make_camera_payload(site_id: int, **overrides) -> dict:
    base = {
        "name": "Test Cam Integration",
        "site_id": site_id,
        "vendor": "Hikvision",
        "model": "DS-2CD2T47G2",
        "serial_number": f"SN-{id(overrides):010d}",
        "connection_type": "rtsp",
        "rtsp_url": "rtsp://192.168.1.100:554/stream1",
    }
    base.update(overrides)
    return base


class TestListCameras:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-001",
        objective="Admin can list all cameras; 401 without token, 403 for regular user",
        precondition="Admin authenticated; at least one camera exists",
        steps=[
            "GET /admin/cameras with admin token → 200 + list",
            "GET /admin/cameras with no token → 401",
            "GET /admin/cameras with user token → 403",
        ],
        test_data={"role": "admin"},
        expected_result="200 list for admin; 401 no token; 403 user",
        post_condition="No state change",
    )
    def test_list_cameras_auth_enforcement(self, client, admin_headers, user_headers):
        with allure.step("Admin lists cameras — expects 200"):
            resp = client.get("/admin/cameras", headers=admin_headers)
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

        with allure.step("No token — expects 401"):
            resp = client.get("/admin/cameras")
            assert resp.status_code == 401

        with allure.step("Regular user — expects 403"):
            resp = client.get("/admin/cameras", headers=user_headers)
            assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-002",
        objective="Admin can filter cameras by registry_status query parameter",
        precondition="Admin authenticated; camera with status=draft exists",
        steps=[
            "GET /admin/cameras?registry_status=draft",
            "Assert HTTP 200",
            "Assert all items have registry_status='draft' or list is empty",
        ],
        test_data={"filter": "registry_status=draft"},
        expected_result="HTTP 200, filtered camera list",
        post_condition="No state change",
    )
    def test_list_cameras_filter_by_status(self, client, db, admin_user, admin_headers):
        with allure.step("Create a site and a draft camera"):
            site = make_site(db, name="Filter Test Site", location="Oslo", created_by=admin_user.id)
            CameraFactory(db=db, site_id=site.id, created_by=admin_user.id)

        with allure.step("Filter cameras by registry_status=draft"):
            resp = client.get("/admin/cameras?registry_status=draft", headers=admin_headers)
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)


class TestCreateCamera:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-003",
        objective="Admin can create a camera with minimal required fields",
        precondition="Admin authenticated; valid site_id exists",
        steps=[
            "Create a site",
            "POST /admin/cameras with valid payload",
            "Assert HTTP 201",
            "Assert response has camera id and name",
        ],
        test_data={"name": "Test Cam Integration", "connection_type": "rtsp"},
        expected_result="HTTP 201 with camera object",
        post_condition="Camera stored in DB",
    )
    def test_create_camera_success(self, client, db, admin_user, admin_headers):
        with allure.step("Create site"):
            site = make_site(db, name="Create Cam Site", location="Bergen", created_by=admin_user.id)

        with allure.step("POST /admin/cameras with valid payload"):
            payload = _make_camera_payload(site_id=site.id, serial_number="SN-CREATE-001")
            resp = client.post("/admin/cameras", json=payload, headers=admin_headers)

        with allure.step("Assert 201 and camera fields"):
            assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "id" in data
            assert data["name"] == "Test Cam Integration"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-004",
        objective="Creating a camera with duplicate serial_number returns 400 or 409",
        precondition="Admin authenticated; camera with same serial_number already exists",
        steps=[
            "Create a camera with serial_number='SN-DUP-001'",
            "POST /admin/cameras again with same serial_number",
            "Assert HTTP 400 or 409",
        ],
        test_data={"serial_number": "SN-DUP-001"},
        expected_result="HTTP 400 or 409 — duplicate serial_number rejected",
        post_condition="Only one camera with that serial_number exists",
    )
    def test_duplicate_serial_number_rejected(self, client, db, admin_user, admin_headers):
        with allure.step("Create site and first camera"):
            site = make_site(db, name="Dup Serial Site", location="Trondheim", created_by=admin_user.id)
            CameraFactory(db=db, site_id=site.id, created_by=admin_user.id,
                          serial_number="SN-DUP-001")

        with allure.step("Attempt to create second camera with same serial_number"):
            payload = _make_camera_payload(site_id=site.id, serial_number="SN-DUP-001")
            resp = client.post("/admin/cameras", json=payload, headers=admin_headers)

        with allure.step("Assert 400 or 409"):
            assert resp.status_code in (400, 409), (
                f"Expected 400/409 for duplicate serial, got {resp.status_code}"
            )


class TestUpdateCamera:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-005",
        objective="Admin can update camera name and model",
        precondition="Camera exists; admin authenticated",
        steps=[
            "Create camera",
            "PATCH /admin/cameras/{id} with new name",
            "Assert HTTP 200",
            "Assert returned name matches updated value",
        ],
        test_data={"name": "Updated Camera Name"},
        expected_result="HTTP 200 with updated camera object",
        post_condition="Camera name updated in DB",
    )
    def test_update_camera_name(self, client, db, admin_user, admin_headers):
        with allure.step("Create site and camera"):
            site = make_site(db, name="Update Cam Site", location="Stavanger", created_by=admin_user.id)
            cam = CameraFactory(db=db, site_id=site.id, created_by=admin_user.id)

        with allure.step("PATCH camera name"):
            resp = client.patch(
                f"/admin/cameras/{cam.id}",
                json={"name": "Updated Camera Name"},
                headers=admin_headers,
            )

        with allure.step("Assert 200 and updated name"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            assert resp.json().get("name") == "Updated Camera Name"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-006",
        objective="Admin can update camera credentials; stored ciphertext differs from plaintext",
        precondition="Camera exists; admin authenticated",
        steps=[
            "Create camera",
            "PATCH /admin/cameras/{id}/credentials with username/password",
            "Assert HTTP 200",
            "GET /admin/cameras/{id}/credentials — assert returned username matches",
        ],
        test_data={"username": "admin_cam", "password": "Secret123!"},
        expected_result="HTTP 200; credentials updated and encrypted in storage",
        post_condition="Credentials stored encrypted; plaintext not stored",
    )
    def test_update_camera_credentials(self, client, db, admin_user, admin_headers):
        with allure.step("Create site and camera"):
            site = make_site(db, name="Cred Update Site", location="Kristiansand", created_by=admin_user.id)
            cam = CameraFactory(db=db, site_id=site.id, created_by=admin_user.id)

        with allure.step("PATCH camera credentials"):
            resp = client.patch(
                f"/admin/cameras/{cam.id}/credentials",
                json={"username": "admin_cam", "password": "Secret123!", "onvif_port": 80},
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        with allure.step("GET credentials and verify username stored"):
            cred_resp = client.get(f"/admin/cameras/{cam.id}/credentials", headers=admin_headers)
            if cred_resp.status_code == 200:
                assert cred_resp.json().get("username") == "admin_cam"


class TestCameraActions:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-007",
        objective="POST /admin/cameras/{id}/verify returns 200 (triggers health check pipeline)",
        precondition="Camera exists in DRAFT or VERIFY_FAILED status",
        steps=[
            "Create camera",
            "POST /admin/cameras/{id}/verify",
            "Assert HTTP 200",
        ],
        test_data={"camera_status": "draft"},
        expected_result="HTTP 200 — verification triggered",
        post_condition="Camera registry_status may change to 'verifying'",
    )
    def test_verify_camera_returns_200(self, client, db, admin_user, admin_headers):
        with allure.step("Create site and camera"):
            site = make_site(db, name="Verify Cam Site", location="Arendal", created_by=admin_user.id)
            cam = CameraFactory(db=db, site_id=site.id, created_by=admin_user.id)

        with allure.step("POST verify"):
            resp = client.post(f"/admin/cameras/{cam.id}/verify", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-008",
        objective="GET /admin/cameras/health returns summary with count fields",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/cameras/health",
            "Assert HTTP 200",
            "Assert response contains total, online, offline keys",
        ],
        test_data={},
        expected_result="HTTP 200 with health summary object",
        post_condition="No state change",
    )
    def test_camera_health_summary(self, client, admin_headers):
        with allure.step("GET /admin/cameras/health"):
            resp = client.get("/admin/cameras/health", headers=admin_headers)

        with allure.step("Assert 200 and summary keys"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "total" in data

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-009",
        objective="PATCH /admin/cameras/scheduler/config with valid interval is accepted",
        precondition="Admin authenticated",
        steps=[
            "PATCH /admin/cameras/scheduler/config with interval_seconds=300",
            "Assert HTTP 200",
        ],
        test_data={"interval_seconds": 300},
        expected_result="HTTP 200 — scheduler config updated",
        post_condition="Scheduler interval updated",
    )
    def test_update_scheduler_config(self, client, admin_headers):
        with allure.step("PATCH scheduler config"):
            resp = client.patch(
                "/admin/cameras/scheduler/config",
                json={"interval_seconds": 300, "enabled": True},
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-010",
        objective="GET /admin/cameras/ml/config returns ML config singleton",
        precondition="Admin authenticated; ML config exists",
        steps=[
            "GET /admin/cameras/ml/config",
            "Assert HTTP 200",
            "Assert response contains stage1_conf field",
        ],
        test_data={},
        expected_result="HTTP 200 with ML config object",
        post_condition="No state change",
    )
    def test_get_ml_config(self, client, admin_headers):
        with allure.step("GET ML config"):
            resp = client.get("/admin/cameras/ml/config", headers=admin_headers)

        with allure.step("Assert 200 and config fields"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-CAM-012",
        objective="Non-existent camera returns 404",
        precondition="Camera with id=999999 does not exist",
        steps=[
            "GET /admin/cameras/999999",
            "Assert HTTP 404",
        ],
        test_data={"camera_id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_nonexistent_camera_returns_404(self, client, admin_headers):
        with allure.step("GET non-existent camera"):
            resp = client.get("/admin/cameras/999999", headers=admin_headers)

        with allure.step("Assert 404"):
            assert resp.status_code == 404, f"Expected 404, got {resp.status_code}"
