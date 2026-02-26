"""
Integration Tests — /admin/cameras endpoints

Covers: list cameras (admin-only), create camera, get camera by id,
        update camera identity and credentials, missing credential validation.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Cameras — Registry Management"),
    pytest.mark.integration,
    pytest.mark.cameras,
]

from tests.conftest import make_site


def _camera_payload(site_id, name="Test Camera Alpha", **kwargs):
    base = {
        "name": name,
        "site_id": site_id,
        "vendor": "Hikvision",
        "model": "DS-2CD2143G2-I",
        "serial_number": None,
        "onvif_supported": False,
        "connection_type": "rtsp",
        "rtsp_url": "rtsp://192.168.1.10:554/stream1",
    }
    base.update(kwargs)
    return base


def _cred_payload(**kwargs):
    base = {
        "rtsp_url": "rtsp://192.168.1.20:554/stream1",
        "rtsp_url_sub": "rtsp://192.168.1.20:554/stream2",
        "username": "admin",
        "password": "pass123",
    }
    base.update(kwargs)
    return base


class TestListCameras:
    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-001",
        objective="Admin can list all cameras",
        precondition="Admin authenticated",
        steps=["GET /admin/cameras with admin token", "Assert HTTP 200", "Assert list returned"],
        test_data={"role": "admin"},
        expected_result="HTTP 200, JSON array",
        post_condition="No state change",
    )
    def test_admin_can_list_cameras(self, client, admin_headers):
        resp = client.get("/admin/cameras", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-002",
        objective="Regular user cannot list cameras (403)",
        precondition="Regular user authenticated",
        steps=["GET /admin/cameras with user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No data exposed",
    )
    def test_regular_user_cannot_list_cameras(self, client, user_headers):
        resp = client.get("/admin/cameras", headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-003",
        objective="Unauthenticated cannot list cameras (401)",
        precondition="No Authorization header",
        steps=["GET /admin/cameras with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_cameras(self, client):
        resp = client.get("/admin/cameras")
        assert resp.status_code == 401


class TestCreateCamera:
    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-004",
        objective="Admin can register a new camera — returns HTTP 201",
        precondition="Site exists; admin authenticated",
        steps=[
            "Create site",
            "POST /admin/cameras with name, site_id, vendor, model, rtsp_url",
            "Assert HTTP 201",
        ],
        test_data={"name": "Test Camera Alpha", "vendor": "Hikvision",
                   "rtsp_url": "rtsp://192.168.1.10:554/stream1"},
        expected_result="HTTP 201, camera object returned",
        post_condition="Camera row in DB with registry_status='draft'",
    )
    def test_admin_can_create_camera(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Create A", created_by=admin_user.id)
        resp = client.post("/admin/cameras", json=_camera_payload(site.id), headers=admin_headers)
        assert resp.status_code == 201, resp.text

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-005",
        objective="Newly registered camera has registry_status='draft'",
        precondition="Site exists; admin authenticated",
        steps=[
            "POST /admin/cameras",
            "Assert HTTP 201",
            "Assert registry_status == 'draft'",
        ],
        test_data={"name": "Draft Cam"},
        expected_result="HTTP 201, registry_status='draft'",
        post_condition="Camera in DRAFT state — not yet verified",
    )
    def test_created_camera_has_draft_status(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Draft B", created_by=admin_user.id)
        resp = client.post("/admin/cameras",
                           json=_camera_payload(site.id, name="Draft Cam"), headers=admin_headers)
        assert resp.status_code == 201, resp.text
        assert resp.json()["registry_status"] == "draft"

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-006",
        objective="Camera name and vendor are correctly stored and returned",
        precondition="Site exists; admin authenticated",
        steps=[
            "POST /admin/cameras with name='Named Cam', vendor='Axis'",
            "Assert name and vendor match in response",
        ],
        test_data={"name": "Named Cam", "vendor": "Axis"},
        expected_result="Response has name='Named Cam', vendor='Axis'",
        post_condition="Camera stored with correct identity fields",
    )
    def test_camera_name_and_vendor_in_response(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Named C", created_by=admin_user.id)
        resp = client.post("/admin/cameras",
                           json=_camera_payload(site.id, name="Named Cam", vendor="Axis"),
                           headers=admin_headers)
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["name"] == "Named Cam"
        assert data["vendor"] == "Axis"

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-007",
        objective="Regular user cannot register a camera (403)",
        precondition="Regular user authenticated",
        steps=["POST /admin/cameras with user token", "Assert HTTP 403"],
        test_data={"role": "user"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No camera created",
    )
    def test_regular_user_cannot_create_camera(self, client, db, admin_user, user_headers):
        site = make_site(db, name="Cam Site Forbidden D", created_by=admin_user.id)
        resp = client.post("/admin/cameras", json=_camera_payload(site.id), headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-008",
        objective="Camera payload without credentials returns 422",
        precondition="Site exists; admin authenticated",
        steps=["POST /admin/cameras with no credential fields", "Assert HTTP 422"],
        test_data={"credentials": "missing"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No camera created",
    )
    def test_missing_credentials_returns_422(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site No Cred E", created_by=admin_user.id)
        payload = {"name": "No Cred Cam", "site_id": site.id}
        resp = client.post("/admin/cameras", json=payload, headers=admin_headers)
        assert resp.status_code == 422


class TestGetCamera:
    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-009",
        objective="Admin can retrieve camera by id",
        precondition="Camera exists; admin authenticated",
        steps=["Create camera", "GET /admin/cameras/{id}", "Assert id matches"],
        test_data={"id": "<created camera id>"},
        expected_result="HTTP 200, camera object with correct id",
        post_condition="No state change",
    )
    def test_admin_can_get_camera_by_id(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Get F", created_by=admin_user.id)
        create_resp = client.post("/admin/cameras",
                                  json=_camera_payload(site.id, name="Get Me Cam"),
                                  headers=admin_headers)
        assert create_resp.status_code == 201, create_resp.text
        cam_id = create_resp.json()["id"]
        resp = client.get(f"/admin/cameras/{cam_id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["id"] == cam_id

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-010",
        objective="Non-existent camera id returns 404",
        precondition="No camera with id=999999",
        steps=["GET /admin/cameras/999999", "Assert HTTP 404"],
        test_data={"id": 999999},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_get_nonexistent_camera_returns_404(self, client, admin_headers):
        resp = client.get("/admin/cameras/999999", headers=admin_headers)
        assert resp.status_code == 404


class TestUpdateCamera:
    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-011",
        objective="Admin can update camera name (identity fields)",
        precondition="Camera exists; admin authenticated",
        steps=[
            "Create camera",
            "PATCH /admin/cameras/{id} with new name",
            "Assert HTTP 200",
            "Assert updated name in response",
        ],
        test_data={"name": "Updated Name", "vendor": "Dahua"},
        expected_result="HTTP 200, name='Updated Name'",
        post_condition="Camera name updated in DB",
    )
    def test_admin_can_update_camera_identity(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Update G", created_by=admin_user.id)
        create_resp = client.post("/admin/cameras",
                                  json=_camera_payload(site.id, name="Update Me Cam"),
                                  headers=admin_headers)
        assert create_resp.status_code == 201, create_resp.text
        cam_id = create_resp.json()["id"]
        resp = client.patch(f"/admin/cameras/{cam_id}",
                            json={"name": "Updated Name", "vendor": "Dahua"},
                            headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Updated Name"

    @pytest.mark.testcase(
        tc_id="TC-INT-CAM-012",
        objective="Admin can update camera RTSP credentials",
        precondition="Camera exists; admin authenticated",
        steps=[
            "Create camera",
            "PATCH /admin/cameras/{id}/credentials with new RTSP url",
            "Assert HTTP 200",
        ],
        test_data={"rtsp_url": "rtsp://192.168.1.20:554/stream1", "username": "admin"},
        expected_result="HTTP 200, credentials updated",
        post_condition="New credentials encrypted and stored in DB",
    )
    def test_admin_can_update_camera_credentials(self, client, db, admin_headers, admin_user):
        site = make_site(db, name="Cam Site Cred H", created_by=admin_user.id)
        create_resp = client.post("/admin/cameras",
                                  json=_camera_payload(site.id, name="Cred Update Cam"),
                                  headers=admin_headers)
        assert create_resp.status_code == 201, create_resp.text
        cam_id = create_resp.json()["id"]
        resp = client.patch(f"/admin/cameras/{cam_id}/credentials",
                            json=_cred_payload(), headers=admin_headers)
        assert resp.status_code == 200, resp.text
