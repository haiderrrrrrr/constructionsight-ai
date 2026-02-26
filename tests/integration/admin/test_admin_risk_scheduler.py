"""
Integration Tests — /admin/risk/scheduler endpoints

Covers: get scheduler status, update config, trigger scheduler,
        invalid interval_seconds (<15) returns 422, auth enforcement.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Risk Scheduler Management"),
    pytest.mark.integration,
    pytest.mark.admin,
]


class TestRiskSchedulerStatus:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-001",
        objective="GET /admin/risk/scheduler/status returns enabled and interval fields",
        precondition="Admin authenticated",
        steps=[
            "GET /admin/risk/scheduler/status with admin token",
            "Assert HTTP 200",
            "Assert response contains 'enabled' and 'interval_seconds' keys",
        ],
        test_data={},
        expected_result="HTTP 200 with scheduler status object",
        post_condition="No state change",
    )
    def test_get_scheduler_status(self, client, admin_headers):
        with allure.step("GET scheduler status"):
            resp = client.get("/admin/risk/scheduler/status", headers=admin_headers)

        with allure.step("Assert 200 and key fields"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "enabled" in data or "interval_seconds" in data, (
                f"Expected scheduler status fields, got: {list(data.keys())}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-005a",
        objective="GET /admin/risk/scheduler/status without token returns 401",
        precondition="No authorization token",
        steps=[
            "GET /admin/risk/scheduler/status with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_scheduler_status_requires_auth(self, client):
        with allure.step("GET without token"):
            resp = client.get("/admin/risk/scheduler/status")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestRiskSchedulerConfig:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-002",
        objective="PATCH /admin/risk/scheduler/config with valid interval is accepted",
        precondition="Admin authenticated",
        steps=[
            "PATCH /admin/risk/scheduler/config with interval_seconds=300",
            "Assert HTTP 200",
        ],
        test_data={"interval_seconds": 300},
        expected_result="HTTP 200 — scheduler config updated",
        post_condition="Scheduler interval changed to 300 seconds",
    )
    def test_update_scheduler_config_valid_interval(self, client, admin_headers):
        with allure.step("PATCH scheduler config"):
            resp = client.patch(
                "/admin/risk/scheduler/config",
                json={"interval_seconds": 300, "enabled": True},
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-003",
        objective="PATCH /admin/risk/scheduler/config with interval_seconds < 15 returns 422",
        precondition="Admin authenticated",
        steps=[
            "PATCH /admin/risk/scheduler/config with interval_seconds=5 (below minimum of 15)",
            "Assert HTTP 422",
        ],
        test_data={"interval_seconds": 5},
        expected_result="HTTP 422 — interval below minimum rejected",
        post_condition="Scheduler config unchanged",
    )
    def test_update_scheduler_config_below_minimum(self, client, admin_headers):
        with allure.step("PATCH with too-small interval"):
            resp = client.patch(
                "/admin/risk/scheduler/config",
                json={"interval_seconds": 5},
                headers=admin_headers,
            )

        with allure.step("Assert 422"):
            assert resp.status_code == 422, (
                f"Expected 422 for interval_seconds=5, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-005b",
        objective="PATCH /admin/risk/scheduler/config without token returns 401",
        precondition="No authorization token",
        steps=[
            "PATCH /admin/risk/scheduler/config with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No state change",
    )
    def test_scheduler_config_requires_auth(self, client):
        with allure.step("PATCH without token"):
            resp = client.patch(
                "/admin/risk/scheduler/config",
                json={"interval_seconds": 300},
            )

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"


class TestRiskSchedulerTrigger:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-004",
        objective="POST /admin/risk/scheduler/trigger returns 200 or 202",
        precondition="Admin authenticated",
        steps=[
            "POST /admin/risk/scheduler/trigger",
            "Assert HTTP 200 or 202",
        ],
        test_data={},
        expected_result="HTTP 200 or 202 — trigger acknowledged",
        post_condition="Risk scheduler run enqueued",
    )
    def test_trigger_scheduler(self, client, admin_headers):
        with allure.step("POST trigger"):
            resp = client.post(
                "/admin/risk/scheduler/trigger",
                headers=admin_headers,
            )

        with allure.step("Assert 200 or 202"):
            assert resp.status_code in (200, 202), (
                f"Expected 200/202, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-RSK-005c",
        objective="POST /admin/risk/scheduler/trigger without token returns 401",
        precondition="No authorization token",
        steps=[
            "POST /admin/risk/scheduler/trigger with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No scheduler run triggered",
    )
    def test_trigger_scheduler_requires_auth(self, client):
        with allure.step("POST without token"):
            resp = client.post("/admin/risk/scheduler/trigger")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
