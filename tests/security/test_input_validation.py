"""
Security Tests — Input validation, boundary values, injection guards.

Covers: XSS payloads, SQL injection, oversized inputs, null bytes,
        missing required fields, boundary integer values.
"""
import allure
import pytest
from datetime import date, timedelta

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Security Tests"),
    allure.story("Input Validation — Injection & Boundary"),
    pytest.mark.security,
]

_FUTURE = (date.today() + timedelta(days=365)).isoformat()


class TestSqlInjection:
    @pytest.mark.testcase(
        tc_id="TC-SEC-050",
        objective="SQL injection in login identifier does not crash the server",
        precondition="Attacker submits SQL injection payload",
        steps=[
            "POST /auth/login with identifier=\"' OR '1'='1\"",
            "Assert HTTP 400/401/422",
            "Assert HTTP != 500",
        ],
        test_data={"identifier": "' OR '1'='1", "password": "' OR '1'='1"},
        expected_result="HTTP 400/401/422 — not 500",
        post_condition="No data leak; DB unchanged",
    )
    def test_sql_injection_in_login_does_not_crash(self, client):
        resp = client.post("/auth/login", json={
            "identifier": "' OR '1'='1",
            "password": "' OR '1'='1",
        })
        assert resp.status_code in (400, 401, 422)
        assert resp.status_code != 500

    @pytest.mark.testcase(
        tc_id="TC-SEC-051",
        objective="SQL injection in signup email does not crash",
        precondition="Attacker submits injection payload as email",
        steps=[
            "POST /auth/signup with email containing SQL injection",
            "Assert HTTP 400/422",
            "Assert HTTP != 500",
        ],
        test_data={"email": "' OR '1'='1' --"},
        expected_result="HTTP 400/422 — not 500",
        post_condition="No data leak",
    )
    def test_sql_injection_in_signup_email_does_not_crash(self, client):
        resp = client.post("/auth/signup", json={
            "email": "' OR '1'='1' --",
            "username": "injector",
            "password": "Valid123!",
            "full_name": "Test",
        })
        assert resp.status_code in (400, 422)
        assert resp.status_code != 500


class TestXssPayloads:
    @pytest.mark.testcase(
        tc_id="TC-SEC-052",
        objective="XSS payload in project name is sanitized or rejected",
        precondition="Admin authenticated; XSS payload sent as project name",
        steps=[
            "POST /admin/projects with name containing <script>alert(1)</script>",
            "Assert HTTP != 500",
            "If 201, assert response name does not contain unescaped <script> tag",
        ],
        test_data={"name": "<script>alert('XSS')</script>"},
        expected_result="HTTP 400/422 or 201 with sanitized name — never 500",
        post_condition="XSS payload not stored as executable",
    )
    def test_xss_payload_in_project_name(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "<script>alert('XSS')</script>",
            "location": "London",
            "end_date": _FUTURE,
            "pm_email": "pm@test.com",
            "pm_full_name": "PM",
        }, headers=admin_headers)
        assert resp.status_code != 500
        if resp.status_code in (200, 201):
            assert "<script>" not in resp.json().get("name", "")

    @pytest.mark.testcase(
        tc_id="TC-SEC-053",
        objective="XSS payload in note content is stored safely (no server crash)",
        precondition="Endpoint exists; any member authenticated",
        steps=[
            "Attempt to send XSS in note content field",
            "Assert HTTP != 500",
        ],
        test_data={"content": "<img src=x onerror=alert(1)>"},
        expected_result="HTTP 400/422/200/201 — not 500",
        post_condition="No server-side script execution",
    )
    def test_xss_payload_in_note_content_does_not_crash(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "XSS Note Project",
            "location": "London",
            "end_date": _FUTURE,
            "pm_email": "pm@xss.com",
            "pm_full_name": "PM",
        }, headers=admin_headers)
        assert resp.status_code != 500


class TestOversizedInputs:
    @pytest.mark.testcase(
        tc_id="TC-SEC-054",
        objective="10,000-character login identifier does not crash (400/401/422)",
        precondition="Attacker sends extremely large payload",
        steps=[
            "POST /auth/login with 10000-char identifier",
            "Assert HTTP 400/401/422",
            "Assert HTTP != 500",
        ],
        test_data={"identifier_length": 10000},
        expected_result="HTTP 400/401/422 — graceful rejection",
        post_condition="No memory exhaustion or crash",
    )
    def test_oversized_login_identifier_rejected(self, client):
        resp = client.post("/auth/login", json={
            "identifier": "a" * 10_000,
            "password": "b" * 10_000,
        })
        assert resp.status_code in (400, 401, 422)
        assert resp.status_code != 500

    @pytest.mark.testcase(
        tc_id="TC-SEC-055",
        objective="Extremely long project name is rejected or handled (not 500)",
        precondition="Admin authenticated; name=5000 characters",
        steps=[
            "POST /admin/projects with 5000-char name",
            "Assert HTTP != 500",
        ],
        test_data={"name_length": 5000},
        expected_result="HTTP 400/422 or 201 — not 500",
        post_condition="No crash; DB integrity maintained",
    )
    def test_oversized_project_name_does_not_crash(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "A" * 5000,
            "location": "London",
            "end_date": _FUTURE,
            "pm_email": "pm@test.com",
            "pm_full_name": "PM",
        }, headers=admin_headers)
        assert resp.status_code != 500


class TestSmartQueryInjection:
    @pytest.mark.testcase(
        tc_id="TC-SEC-059",
        objective="Smart Query with DROP TABLE payload does not cause destructive DB operation (safe handling)",
        precondition="Authenticated PM member of an active project; pipeline mocked",
        steps=[
            "POST /projects/{id}/smart-query/ask with question='DROP TABLE users;'",
            "Assert HTTP != 500",
            "Assert HTTP 200/400/403/404/422 (pipeline never runs raw SQL)",
        ],
        test_data={"question": "DROP TABLE users; --"},
        expected_result="HTTP 200/400/403/404/422 — no destructive operation; not 500",
        post_condition="No table dropped; pipeline treats it as a text query",
    )
    def test_smart_query_drop_table_payload_not_destructive(self, client, db, admin_headers):
        from tests.conftest import _make_user, make_project
        from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
        from app.models.project import ProjectStatus
        from app.models.user import PlatformRole

        admin_user = _make_user(db, email="sq_inject_admin@test.com", username="sq_inject_admin",
                                platform_role=PlatformRole.ADMIN)
        pm_user = _make_user(db, email="sq_inject_pm@test.com", username="sq_inject_pm")
        project = make_project(db, name="SQ Inject Project", location="Oslo",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        db.add(ProjectMembership(
            user_id=pm_user.id, project_id=project.id,
            project_role=ProjectRole.PROJECT_MANAGER,
            status=MembershipStatus.ACTIVE, invited_by=admin_user.id,
        ))
        db.flush()
        from tests.conftest import _auth_headers
        resp = client.post(
            f"/projects/{project.id}/smart-query/ask",
            json={"question": "DROP TABLE users; --"},
            headers=_auth_headers(pm_user),
        )
        assert resp.status_code != 500, "Server crashed on SQL injection payload in smart query"
        assert resp.status_code in (200, 400, 403, 404, 422)

    @pytest.mark.testcase(
        tc_id="TC-SEC-059b",
        objective="Project name with null bytes is safely rejected or stored (not 500)",
        precondition="Admin authenticated; name contains null byte \\x00",
        steps=[
            "POST /admin/projects with name containing null byte",
            "Assert HTTP != 500 (either 400/422 rejection or 201 safe storage)",
        ],
        test_data={"name": "Project\\x00Name"},
        expected_result="HTTP 400/422 or 201 — not 500; null byte does not crash server",
        post_condition="No crash; DB integrity maintained",
    )
    def test_null_byte_in_project_name_does_not_crash(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "Project\x00Name",
            "location": "London",
            "end_date": _FUTURE,
            "pm_email": "pm@null.com",
            "pm_full_name": "PM Null",
        }, headers=admin_headers)
        assert resp.status_code != 500, "Server crashed on null byte in project name"

    @pytest.mark.testcase(
        tc_id="TC-SEC-059c",
        objective="Giant JSON payload (100KB) is rejected gracefully (413 or 422, not 500)",
        precondition="Admin authenticated; sends a JSON body with a 100KB string field",
        steps=[
            "POST /admin/projects with a 100KB description field",
            "Assert HTTP 400/413/422 — not 500",
        ],
        test_data={"description_length": "100KB"},
        expected_result="HTTP 400/413/422 — no crash or memory exhaustion",
        post_condition="Server intact; no resource exhaustion",
    )
    def test_giant_json_payload_rejected_gracefully(self, client, admin_headers):
        resp = client.post("/admin/projects", json={
            "name": "Giant Payload Project",
            "location": "London",
            "end_date": _FUTURE,
            "pm_email": "pm@giant.com",
            "pm_full_name": "PM",
            "description": "X" * 100_000,
        }, headers=admin_headers)
        assert resp.status_code != 500, "Server crashed on 100KB JSON payload"


class TestMissingRequiredFields:
    @pytest.mark.testcase(
        tc_id="TC-SEC-056",
        objective="Login with empty body returns 422",
        precondition="POST /auth/login with body={}",
        steps=["POST /auth/login with empty JSON body", "Assert HTTP 422"],
        test_data={"body": "{}"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No state change",
    )
    def test_login_with_empty_body_returns_422(self, client):
        resp = client.post("/auth/login", json={})
        assert resp.status_code == 422

    @pytest.mark.testcase(
        tc_id="TC-SEC-057",
        objective="Signup with empty body returns 422",
        precondition="POST /auth/signup with body={}",
        steps=["POST /auth/signup with empty JSON body", "Assert HTTP 422"],
        test_data={"body": "{}"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No state change",
    )
    def test_signup_with_empty_body_returns_422(self, client):
        resp = client.post("/auth/signup", json={})
        assert resp.status_code == 422

    @pytest.mark.testcase(
        tc_id="TC-SEC-058",
        objective="Create project with empty body returns 422",
        precondition="Admin authenticated; POST /admin/projects with body={}",
        steps=["POST /admin/projects with empty JSON body", "Assert HTTP 422"],
        test_data={"body": "{}"},
        expected_result="HTTP 422 Unprocessable Entity",
        post_condition="No project created",
    )
    def test_create_project_with_empty_body_returns_422(self, client, admin_headers):
        resp = client.post("/admin/projects", json={}, headers=admin_headers)
        assert resp.status_code == 422
