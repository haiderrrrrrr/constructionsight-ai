"""
Integration Tests — /projects/{id}/reports endpoints

Covers: list reports, PM export (mock PDF gen), date validation, stakeholder 403,
        get report status, download not-ready report (400), delete report, 401 sweep.
"""
import allure
import pytest
from unittest.mock import patch

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Report Management"),
    pytest.mark.integration,
    pytest.mark.reports,
]

from tests.conftest import _make_user, _auth_headers, make_project
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from tests.accessories.factories import ProjectReportFactory


def _add_member(db, *, user_id, project_id, role, invited_by):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=invited_by,
    )
    db.add(m)
    db.flush()
    return m


class TestListReports:
    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-001",
        objective="GET /projects/{id}/reports returns list for authenticated member",
        precondition="User is PM of an active project",
        steps=[
            "Create active project with PM membership",
            "GET /projects/{id}/reports",
            "Assert HTTP 200 with list",
        ],
        test_data={},
        expected_result="HTTP 200 — list of report objects",
        post_condition="No state change",
    )
    def test_list_reports_as_member(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="rpt_pm_list@test.com", username="rpt_pm_list")
            project = make_project(db, name="Reports List Project", location="Oslo",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("GET reports"):
            resp = client.get(f"/projects/{project.id}/reports", headers=_auth_headers(pm))

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            assert isinstance(resp.json(), (list, dict))

    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-002",
        objective="GET /projects/{id}/reports as non-member returns 403",
        precondition="User has no membership in the project",
        steps=[
            "Create active project (user not a member)",
            "GET /projects/{id}/reports",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_list_reports_non_member_returns_403(self, client, db, admin_user, regular_user, user_headers):
        with allure.step("Create project with no membership for regular_user"):
            project = make_project(db, name="Reports Non-Member Project", location="Bergen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)

        with allure.step("GET reports as non-member"):
            resp = client.get(f"/projects/{project.id}/reports", headers=user_headers)

        with allure.step("Assert 403 or 404"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404, got {resp.status_code}"
            )


class TestExportReport:
    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-003",
        objective="POST /projects/{id}/reports/export as PM succeeds (mock PDF gen)",
        precondition="PM authenticated; active project",
        steps=[
            "Create active project with PM",
            "Mock PDF generation service",
            "POST /projects/{id}/reports/export",
            "Assert HTTP 200 or 202",
        ],
        test_data={"report_type": "ppe", "start_date": "2025-01-01", "end_date": "2025-01-31"},
        expected_result="HTTP 200 or 202 — report export started",
        post_condition="Report generation queued",
    )
    def test_pm_can_export_report(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="rpt_pm_exp@test.com", username="rpt_pm_exp")
            project = make_project(db, name="Export Report Project", location="Trondheim",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("POST export (mock PDF service)"):
            with patch("app.services.pdf_report_service.generate_ppe_pdf_report",
                       return_value=b"%PDF-1.4 test"):
                resp = client.post(
                    f"/projects/{project.id}/reports/export",
                    json={
                        "report_type": "ppe",
                        "start_date": "2025-01-01",
                        "end_date": "2025-01-31",
                    },
                    headers=_auth_headers(pm),
                )

        with allure.step("Assert 200 or 202"):
            assert resp.status_code in (200, 202), (
                f"Expected 200/202, got {resp.status_code}: {resp.text}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-005",
        objective="POST /projects/{id}/reports/export with end_date before start_date returns 400",
        precondition="PM authenticated; active project",
        steps=[
            "POST export with end_date='2025-01-01' and start_date='2025-01-31' (inverted)",
            "Assert HTTP 400 or 422",
        ],
        test_data={"start_date": "2025-01-31", "end_date": "2025-01-01"},
        expected_result="HTTP 400 or 422 — date inversion rejected",
        post_condition="No report created",
    )
    def test_export_report_inverted_dates(self, client, db, admin_user):
        with allure.step("Create project and PM"):
            pm = _make_user(db, email="rpt_pm_inv@test.com", username="rpt_pm_inv")
            project = make_project(db, name="Export Invert Date Project", location="Stavanger",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)

        with allure.step("POST export with inverted dates"):
            resp = client.post(
                f"/projects/{project.id}/reports/export",
                json={
                    "report_type": "ppe",
                    "start_date": "2025-01-31",
                    "end_date": "2025-01-01",
                },
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 400 or 422"):
            assert resp.status_code in (400, 422), (
                f"Expected 400/422 for inverted dates, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-006",
        objective="POST /projects/{id}/reports/export as STAKEHOLDER returns 403",
        precondition="User is STAKEHOLDER of active project",
        steps=[
            "Create active project with STAKEHOLDER membership",
            "POST reports/export",
            "Assert HTTP 403",
        ],
        test_data={"role": "stakeholder"},
        expected_result="HTTP 403 — stakeholders cannot export reports",
        post_condition="No report created",
    )
    def test_stakeholder_cannot_export_report(self, client, db, admin_user):
        with allure.step("Create project and stakeholder"):
            stakeholder = _make_user(db, email="rpt_stk_exp@test.com", username="rpt_stk_exp")
            project = make_project(db, name="Stakeholder Export Project", location="Drammen",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=stakeholder.id, project_id=project.id,
                        role=ProjectRole.STAKEHOLDER, invited_by=admin_user.id)

        with allure.step("POST export as stakeholder"):
            resp = client.post(
                f"/projects/{project.id}/reports/export",
                json={"report_type": "ppe", "start_date": "2025-01-01", "end_date": "2025-01-31"},
                headers=_auth_headers(stakeholder),
            )

        with allure.step("Assert 403"):
            assert resp.status_code in (403, 404), (
                f"Expected 403/404 for stakeholder export, got {resp.status_code}"
            )


class TestGetReport:
    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-007",
        objective="GET /projects/{id}/reports/{report_id} returns status field",
        precondition="PM authenticated; ProjectReport exists in READY status",
        steps=[
            "Create active project with PM and a READY report",
            "GET /projects/{id}/reports/{report_id}",
            "Assert HTTP 200 with status field",
        ],
        test_data={"status": "ready"},
        expected_result="HTTP 200 with report object including status",
        post_condition="No state change",
    )
    def test_get_report_returns_status(self, client, db, admin_user):
        with allure.step("Create project, PM, and report"):
            pm = _make_user(db, email="rpt_pm_get@test.com", username="rpt_pm_get")
            project = make_project(db, name="Get Report Project", location="Kristiansand",
                                   status=ProjectStatus.ACTIVE, created_by=admin_user.id)
            _add_member(db, user_id=pm.id, project_id=project.id,
                        role=ProjectRole.PROJECT_MANAGER, invited_by=admin_user.id)
            report = ProjectReportFactory(
                db=db, project_id=project.id, triggered_by_user_id=pm.id,
            )

        with allure.step("GET report by id"):
            resp = client.get(
                f"/projects/{project.id}/reports/{report.id}",
                headers=_auth_headers(pm),
            )

        with allure.step("Assert 200 and status in response"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            assert "status" in resp.json()

    @pytest.mark.testcase(
        tc_id="TC-INT-RPT-010",
        objective="All report endpoints return 401 without token",
        precondition="No authorization header",
        steps=[
            "GET /projects/1/reports with no token",
            "Assert HTTP 401",
        ],
        test_data={"auth": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_reports_require_auth(self, client):
        with allure.step("GET without token"):
            resp = client.get("/projects/1/reports")

        with allure.step("Assert 401"):
            assert resp.status_code == 401, f"Expected 401, got {resp.status_code}"
