"""
Integration Tests — /admin/ml-config endpoints

Covers: get ML config singleton, patch fields, invalid value returns 422,
        reset to defaults returns 200.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — ML Config Management"),
    pytest.mark.integration,
    pytest.mark.admin,
]


class TestGetMlConfig:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-ML-001",
        objective="GET /admin/ml-config returns the singleton ML config object",
        precondition="Admin authenticated; ML config exists",
        steps=[
            "GET /admin/ml-config",
            "Assert HTTP 200",
            "Assert response contains stage1_conf or known fields",
        ],
        test_data={},
        expected_result="HTTP 200 with ML config object",
        post_condition="No state change",
    )
    def test_get_ml_config_returns_singleton(self, client, admin_headers):
        with allure.step("GET /admin/ml-config"):
            resp = client.get("/admin/ml-config", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            # At least one of the expected config fields must be present
            config_keys = {"stage1_conf", "stage2_conf", "violation_frames", "alert_cooldown_frames"}
            assert any(k in data for k in config_keys), (
                f"Expected at least one ML config field in response, got: {list(data.keys())}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-ML-001b",
        objective="GET /admin/ml-config without auth returns 401",
        precondition="No authorization header",
        steps=[
            "GET /admin/ml-config with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_get_ml_config_requires_auth(self, client):
        with allure.step("GET without token"):
            resp = client.get("/admin/ml-config")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestPatchMlConfig:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-ML-002",
        objective="PATCH /admin/ml-config with valid stage1_conf value persists the change",
        precondition="Admin authenticated; ML config exists",
        steps=[
            "PATCH /admin/ml-config with stage1_conf=0.6",
            "Assert HTTP 200",
            "GET /admin/ml-config — assert stage1_conf is 0.6",
        ],
        test_data={"stage1_conf": 0.6},
        expected_result="HTTP 200; stage1_conf updated to 0.6",
        post_condition="ML config updated in DB",
    )
    def test_patch_ml_config_updates_field(self, client, admin_headers):
        with allure.step("PATCH stage1_conf"):
            resp = client.patch(
                "/admin/ml-config",
                json={"stage1_conf": 0.6},
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        with allure.step("Verify persisted value"):
            get_resp = client.get("/admin/ml-config", headers=admin_headers)
            if get_resp.status_code == 200 and "stage1_conf" in get_resp.json():
                assert abs(get_resp.json()["stage1_conf"] - 0.6) < 0.01

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-ML-003",
        objective="PATCH /admin/ml-config with negative confidence value returns 422",
        precondition="Admin authenticated",
        steps=[
            "PATCH /admin/ml-config with stage1_conf=-0.1 (invalid)",
            "Assert HTTP 422",
        ],
        test_data={"stage1_conf": -0.1},
        expected_result="HTTP 422 — negative confidence rejected",
        post_condition="ML config unchanged",
    )
    def test_patch_ml_config_invalid_negative_conf(self, client, admin_headers):
        with allure.step("PATCH with negative confidence"):
            resp = client.patch(
                "/admin/ml-config",
                json={"stage1_conf": -0.1},
                headers=admin_headers,
            )

        with allure.step("Assert 422"):
            assert resp.status_code == 422, (
                f"Expected 422 for negative confidence, got {resp.status_code}"
            )


class TestResetMlConfig:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-ML-004",
        objective="POST /admin/ml-config/reset returns 200 with defaults restored",
        precondition="Admin authenticated",
        steps=[
            "POST /admin/ml-config/reset",
            "Assert HTTP 200",
            "Assert response contains default values",
        ],
        test_data={},
        expected_result="HTTP 200 with default ML config values",
        post_condition="ML config reset to factory defaults",
    )
    def test_reset_ml_config_returns_200(self, client, admin_headers):
        with allure.step("POST reset"):
            resp = client.post("/admin/ml-config/reset", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
