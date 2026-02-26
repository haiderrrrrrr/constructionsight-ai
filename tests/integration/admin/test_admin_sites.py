"""
Integration Tests — /admin/sites endpoints

Covers: list sites, create site, auth enforcement (401/403).
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Site Management"),
    pytest.mark.integration,
    pytest.mark.admin,
]

from tests.conftest import _make_user
from app.models.user import PlatformRole


class TestListSites:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-SIT-001",
        objective="Admin can list all sites; regular user gets 403; no token gets 401",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/sites with admin token → 200 + list",
            "GET /admin/sites with user token → 403",
            "GET /admin/sites with no token → 401",
        ],
        test_data={"role": "admin"},
        expected_result="200 list for admin; 403 for user; 401 without token",
        post_condition="No state change",
    )
    def test_list_sites_auth_enforcement(self, client, admin_headers, user_headers):
        with allure.step("Admin lists sites"):
            resp = client.get("/admin/sites", headers=admin_headers)
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

        with allure.step("Regular user is forbidden"):
            resp = client.get("/admin/sites", headers=user_headers)
            assert resp.status_code == 403

        with allure.step("No token is unauthorized"):
            resp = client.get("/admin/sites")
            assert resp.status_code == 401


class TestCreateSite:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-SIT-002",
        objective="Admin can create a site with valid name and location",
        precondition="Admin authenticated",
        steps=[
            "POST /admin/sites with name and location",
            "Assert HTTP 201",
            "Assert response has id, name, location fields",
        ],
        test_data={"name": "Integration Test Site", "location": "Helsinki"},
        expected_result="HTTP 201 with site object",
        post_condition="Site created in DB",
    )
    def test_create_site_success(self, client, admin_headers):
        with allure.step("POST /admin/sites"):
            resp = client.post(
                "/admin/sites",
                json={"name": "Integration Test Site", "location": "Helsinki"},
                headers=admin_headers,
            )

        with allure.step("Assert 201 and site fields"):
            assert resp.status_code == 201, f"Expected 201, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "id" in data
            assert data.get("name") == "Integration Test Site"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-SIT-003",
        objective="GET /admin/sites includes the newly created site",
        precondition="Admin authenticated; site created",
        steps=[
            "POST /admin/sites to create a site",
            "GET /admin/sites",
            "Assert the new site appears in the list",
        ],
        test_data={"name": "Visible Site"},
        expected_result="HTTP 200 list containing the new site",
        post_condition="No state change",
    )
    def test_created_site_appears_in_list(self, client, admin_headers):
        with allure.step("Create a site"):
            create_resp = client.post(
                "/admin/sites",
                json={"name": "Visible Site", "location": "Riga"},
                headers=admin_headers,
            )
            if create_resp.status_code != 201:
                pytest.skip(f"Site creation failed with {create_resp.status_code}")
            new_id = create_resp.json()["id"]

        with allure.step("List sites and find the new one"):
            resp = client.get("/admin/sites", headers=admin_headers)
            assert resp.status_code == 200
            ids = [s["id"] for s in resp.json()]
            assert new_id in ids, f"New site id {new_id} not found in site list"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-SIT-004",
        objective="Creating a site with missing required fields returns 422",
        precondition="Admin authenticated",
        steps=[
            "POST /admin/sites with empty body",
            "Assert HTTP 422",
        ],
        test_data={"body": "{}"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No site created",
    )
    def test_create_site_missing_fields_returns_422(self, client, admin_headers):
        with allure.step("POST with empty body"):
            resp = client.post("/admin/sites", json={}, headers=admin_headers)

        with allure.step("Assert 422"):
            assert resp.status_code == 422, f"Expected 422, got {resp.status_code}"
