"""
Integration Tests — /webhooks endpoints

Covers: report-trigger with valid key, missing key (401), wrong key (401),
        archived project (skipped), report-preview, active-projects list, missing key (401).

Note: WEBHOOK_API_KEY is set in test environment via os.environ.
"""
import allure
import pytest
import os

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Webhooks — Automation Integration"),
    pytest.mark.integration,
    pytest.mark.webhooks,
]

from tests.conftest import _make_user, make_project
from app.models.project import ProjectStatus

# Use a test webhook key; must match what the app reads from env
TEST_WEBHOOK_KEY = "test-webhook-secret-key-12345"


@pytest.fixture(autouse=True)
def set_webhook_key(monkeypatch):
    """Inject a known webhook key into the app config for these tests."""
    monkeypatch.setenv("WEBHOOK_API_KEY", TEST_WEBHOOK_KEY)
    # Also patch the settings object if already loaded
    from app.core.config import settings
    original = settings.webhook_api_key
    settings.webhook_api_key = TEST_WEBHOOK_KEY
    yield
    settings.webhook_api_key = original


VALID_WEBHOOK_HEADERS = {"X-Webhook-Key": TEST_WEBHOOK_KEY}
WRONG_WEBHOOK_HEADERS = {"X-Webhook-Key": "wrong-key-totally-invalid"}


class TestReportTriggerWebhook:
    @pytest.mark.testcase(
        tc_id="TC-INT-WH-001",
        objective="POST /webhooks/report-trigger with valid key and active project returns 202",
        precondition="Valid webhook key; active project exists",
        steps=[
            "Create active project",
            "POST /webhooks/report-trigger with X-Webhook-Key and project_id",
            "Assert HTTP 202",
        ],
        test_data={"X-Webhook-Key": "valid", "project_id": "<active>"},
        expected_result="HTTP 202 — report trigger accepted",
        post_condition="Report generation queued in background",
    )
    def test_trigger_with_valid_key_and_active_project(self, client, db, admin_user):
        with allure.step("Create active project"):
            project = make_project(db, name="Webhook Trigger Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("POST report-trigger"):
            resp = client.post(
                "/webhooks/report-trigger",
                json={"project_id": project.id, "period": "weekly"},
                headers=VALID_WEBHOOK_HEADERS,
            )

        with allure.step("Assert 202"):
            assert resp.status_code in (200, 202), (
                f"Expected 200/202, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-WH-002",
        objective="POST /webhooks/report-trigger without X-Webhook-Key header returns 401",
        precondition="No X-Webhook-Key header",
        steps=[
            "POST /webhooks/report-trigger with no auth header",
            "Assert HTTP 401",
        ],
        test_data={"X-Webhook-Key": "absent"},
        expected_result="HTTP 401 — missing key rejected",
        post_condition="No report triggered",
    )
    def test_trigger_without_key_returns_401(self, client):
        with allure.step("POST without webhook key"):
            resp = client.post(
                "/webhooks/report-trigger",
                json={"project_id": 1, "period": "weekly"},
            )

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    @pytest.mark.testcase(
        tc_id="TC-INT-WH-003",
        objective="POST /webhooks/report-trigger with wrong key returns 401",
        precondition="Wrong X-Webhook-Key value",
        steps=[
            "POST /webhooks/report-trigger with wrong webhook key",
            "Assert HTTP 401",
        ],
        test_data={"X-Webhook-Key": "wrong-key"},
        expected_result="HTTP 401 — invalid key rejected",
        post_condition="No report triggered",
    )
    def test_trigger_with_wrong_key_returns_401(self, client):
        with allure.step("POST with wrong webhook key"):
            resp = client.post(
                "/webhooks/report-trigger",
                json={"project_id": 1, "period": "weekly"},
                headers=WRONG_WEBHOOK_HEADERS,
            )

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"

    @pytest.mark.testcase(
        tc_id="TC-INT-WH-004",
        objective="POST /webhooks/report-trigger for archived project returns 200 with skipped indicator",
        precondition="Valid key; project is ARCHIVED",
        steps=[
            "Create archived project",
            "POST /webhooks/report-trigger with project_id",
            "Assert HTTP 200 with skipped or 202",
        ],
        test_data={"project_status": "archived"},
        expected_result="HTTP 200 or 202 — trigger acknowledged (skipped for archived)",
        post_condition="No report generated for archived project",
    )
    def test_trigger_archived_project_skipped(self, client, db, admin_user):
        with allure.step("Create archived project"):
            project = make_project(db, name="Webhook Archived Project", location="Bergen",
                                   status=ProjectStatus.ARCHIVED, created_by=admin_user.id)

        with allure.step("POST report-trigger for archived project"):
            resp = client.post(
                "/webhooks/report-trigger",
                json={"project_id": project.id, "period": "weekly"},
                headers=VALID_WEBHOOK_HEADERS,
            )

        with allure.step("Assert 200 or 202"):
            assert resp.status_code in (200, 202), (
                f"Expected 200/202 for archived project trigger, got {resp.status_code}: {resp.text}"
            )


class TestReportPreviewWebhook:
    @pytest.mark.testcase(
        tc_id="TC-INT-WH-005",
        objective="POST /webhooks/report-preview with valid key returns 202",
        precondition="Valid webhook key; active project exists",
        steps=[
            "Create active project",
            "POST /webhooks/report-preview",
            "Assert HTTP 202",
        ],
        test_data={"X-Webhook-Key": "valid"},
        expected_result="HTTP 200 or 202 — preview triggered",
        post_condition="Preview report queued",
    )
    def test_report_preview_with_valid_key(self, client, db, admin_user):
        with allure.step("Create active project"):
            project = make_project(db, name="Webhook Preview Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("POST report-preview"):
            resp = client.post(
                "/webhooks/report-preview",
                json={"project_id": project.id, "report_type": "ppe"},
                headers=VALID_WEBHOOK_HEADERS,
            )

        with allure.step("Assert 200 or 202"):
            assert resp.status_code in (200, 202), (
                f"Expected 200/202, got {resp.status_code}: {resp.text}"
            )


class TestActiveProjectsWebhook:
    @pytest.mark.testcase(
        tc_id="TC-INT-WH-006",
        objective="GET /webhooks/active-projects returns only ACTIVE projects",
        precondition="Valid webhook key; mix of ACTIVE and ARCHIVED projects",
        steps=[
            "Create one ACTIVE and one ARCHIVED project",
            "GET /webhooks/active-projects",
            "Assert HTTP 200",
            "Assert all returned projects have status='active'",
        ],
        test_data={"project_statuses": "active + archived"},
        expected_result="HTTP 200 — only active projects returned",
        post_condition="No state change",
    )
    def test_active_projects_returns_only_active(self, client, db, admin_user):
        with allure.step("Create active and archived projects"):
            make_project(db, name="WH Active Project", location="Stavanger",
                         status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            make_project(db, name="WH Archived Project", location="Stavanger",
                         status=ProjectStatus.ARCHIVED, created_by=admin_user.id)

        with allure.step("GET active-projects"):
            resp = client.get("/webhooks/active-projects", headers=VALID_WEBHOOK_HEADERS)

        with allure.step("Assert 200 and only active projects"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert isinstance(data, list)
            # Response shape: [{"project_id": ..., "project_name": ...}] — no status field
            # Verify the archived project's name is not in the results
            returned_names = {p.get("project_name", "") for p in data}
            assert "WH Archived Project" not in returned_names, (
                f"Archived project should not appear in active-projects response: {data}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-WH-007",
        objective="GET /webhooks/active-projects without X-Webhook-Key returns 401",
        precondition="No X-Webhook-Key header",
        steps=[
            "GET /webhooks/active-projects with no auth",
            "Assert HTTP 401",
        ],
        test_data={"X-Webhook-Key": "absent"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_active_projects_requires_key(self, client):
        with allure.step("GET without webhook key"):
            resp = client.get("/webhooks/active-projects")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
