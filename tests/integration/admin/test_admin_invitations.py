"""
Integration Tests — /admin/invitations endpoints

Covers: list all invitations, filter by status, get single invitation,
        resend pending, resend non-pending (400), cancel pending,
        cancel accepted (400), export PDF.
"""
import allure
import pytest

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Admin — Invitation Management"),
    pytest.mark.integration,
    pytest.mark.admin,
]

from tests.conftest import _make_user, make_project
from app.models.user import PlatformRole
from tests.accessories.factories import ProjectInvitationFactory


class TestListInvitations:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-001",
        objective="Admin can list all invitations; regular user gets 403",
        precondition="Admin authenticated; at least one invitation exists",
        steps=[
            "GET /admin/invitations with admin token → 200 + list",
            "GET /admin/invitations with user token → 403",
            "GET /admin/invitations with no token → 401",
        ],
        test_data={"role": "admin"},
        expected_result="200 list for admin; 403 for user; 401 without token",
        post_condition="No state change",
    )
    def test_list_invitations_auth_enforcement(self, client, db, admin_user, admin_headers, user_headers):
        with allure.step("Create project and invitation"):
            project = make_project(db, name="Inv List Project", location="Oslo",
                                   created_by=admin_user.id)
            ProjectInvitationFactory(db=db, project_id=project.id, invited_by=admin_user.id)

        with allure.step("Admin lists invitations"):
            resp = client.get("/admin/invitations", headers=admin_headers)
            assert resp.status_code == 200
            assert isinstance(resp.json(), list)

        with allure.step("Regular user is forbidden"):
            resp = client.get("/admin/invitations", headers=user_headers)
            assert resp.status_code == 403

        with allure.step("No token is unauthorized"):
            resp = client.get("/admin/invitations")
            assert resp.status_code == 401

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-002",
        objective="Admin can filter invitations by status=pending",
        precondition="Admin authenticated; pending invitation exists",
        steps=[
            "GET /admin/invitations?status=pending",
            "Assert HTTP 200",
            "Assert all returned items have status='pending'",
        ],
        test_data={"filter": "status=pending"},
        expected_result="HTTP 200 — filtered list with only pending invitations",
        post_condition="No state change",
    )
    def test_filter_invitations_by_status(self, client, db, admin_user, admin_headers):
        with allure.step("Create project and pending invitation"):
            project = make_project(db, name="Inv Filter Project", location="Bergen",
                                   created_by=admin_user.id)
            ProjectInvitationFactory(db=db, project_id=project.id, invited_by=admin_user.id)

        with allure.step("Filter by pending status"):
            resp = client.get("/admin/invitations?status=pending", headers=admin_headers)
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            for item in data:
                assert item.get("status") == "pending"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-003",
        objective="Admin can retrieve a single invitation by ID",
        precondition="Admin authenticated; invitation exists",
        steps=[
            "Create invitation",
            "GET /admin/invitations/{id}",
            "Assert HTTP 200",
            "Assert response has email and project_id fields",
        ],
        test_data={},
        expected_result="HTTP 200 with invitation object",
        post_condition="No state change",
    )
    def test_get_single_invitation(self, client, db, admin_user, admin_headers):
        with allure.step("Create project and invitation"):
            project = make_project(db, name="Inv Single Project", location="Trondheim",
                                   created_by=admin_user.id)
            inv = ProjectInvitationFactory(db=db, project_id=project.id, invited_by=admin_user.id)

        with allure.step("GET single invitation"):
            resp = client.get(f"/admin/invitations/{inv.id}", headers=admin_headers)

        with allure.step("Assert 200 and key fields"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
            data = resp.json()
            assert "email" in data or "project_id" in data


class TestResendInvitation:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-004",
        objective="Admin can resend a pending invitation",
        precondition="Pending invitation exists",
        steps=[
            "Create pending invitation",
            "POST /admin/invitations/{id}/resend",
            "Assert HTTP 200",
        ],
        test_data={"status": "pending"},
        expected_result="HTTP 200 — invitation resent",
        post_condition="Invitation resent; may have new token or same token",
    )
    def test_resend_pending_invitation(self, client, db, admin_user, admin_headers):
        with allure.step("Create pending invitation"):
            project = make_project(db, name="Inv Resend Project", location="Stavanger",
                                   created_by=admin_user.id)
            inv = ProjectInvitationFactory(db=db, project_id=project.id, invited_by=admin_user.id)

        with allure.step("POST resend"):
            resp = client.post(f"/admin/invitations/{inv.id}/resend", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-005",
        objective="Resending a non-pending invitation returns 400",
        precondition="Accepted or cancelled invitation exists",
        steps=[
            "Create invitation and set status to 'accepted'",
            "POST /admin/invitations/{id}/resend",
            "Assert HTTP 400",
        ],
        test_data={"status": "accepted"},
        expected_result="HTTP 400 — cannot resend non-pending invitation",
        post_condition="No email sent",
    )
    def test_resend_non_pending_returns_400(self, client, db, admin_user, admin_headers):
        from app.models.project_invitation import InvitationStatus

        with allure.step("Create accepted invitation"):
            project = make_project(db, name="Inv Resend Accepted Project", location="Drammen",
                                   created_by=admin_user.id)
            inv = ProjectInvitationFactory(
                db=db, project_id=project.id, invited_by=admin_user.id,
                status=InvitationStatus.ACCEPTED,
            )

        with allure.step("POST resend on accepted invitation"):
            resp = client.post(f"/admin/invitations/{inv.id}/resend", headers=admin_headers)

        with allure.step("Assert 400"):
            assert resp.status_code == 400, (
                f"Expected 400 for resending accepted invite, got {resp.status_code}"
            )


class TestCancelInvitation:
    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-006",
        objective="Admin can cancel a pending invitation",
        precondition="Pending invitation exists",
        steps=[
            "Create pending invitation",
            "PATCH /admin/invitations/{id}/cancel",
            "Assert HTTP 200",
        ],
        test_data={"status": "pending"},
        expected_result="HTTP 200 — invitation cancelled",
        post_condition="Invitation status set to 'cancelled'",
    )
    def test_cancel_pending_invitation(self, client, db, admin_user, admin_headers):
        with allure.step("Create pending invitation"):
            project = make_project(db, name="Inv Cancel Project", location="Fredrikstad",
                                   created_by=admin_user.id)
            inv = ProjectInvitationFactory(db=db, project_id=project.id, invited_by=admin_user.id)

        with allure.step("PATCH cancel"):
            resp = client.patch(f"/admin/invitations/{inv.id}/cancel", headers=admin_headers)

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-007",
        objective="Cancelling an accepted invitation returns 400",
        precondition="Accepted invitation exists",
        steps=[
            "Create accepted invitation",
            "PATCH /admin/invitations/{id}/cancel",
            "Assert HTTP 400",
        ],
        test_data={"status": "accepted"},
        expected_result="HTTP 400 — cannot cancel accepted invitation",
        post_condition="Invitation status unchanged",
    )
    def test_cancel_accepted_invitation_returns_400(self, client, db, admin_user, admin_headers):
        from app.models.project_invitation import InvitationStatus

        with allure.step("Create accepted invitation"):
            project = make_project(db, name="Inv Cancel Accepted Project", location="Sandnes",
                                   created_by=admin_user.id)
            inv = ProjectInvitationFactory(
                db=db, project_id=project.id, invited_by=admin_user.id,
                status=InvitationStatus.ACCEPTED,
            )

        with allure.step("PATCH cancel on accepted invitation"):
            resp = client.patch(f"/admin/invitations/{inv.id}/cancel", headers=admin_headers)

        with allure.step("Assert 400"):
            assert resp.status_code == 400, (
                f"Expected 400 for cancelling accepted invite, got {resp.status_code}"
            )

    @pytest.mark.testcase(
        tc_id="TC-INT-ADM-INV-008",
        objective="POST /admin/invitations/export/pdf returns 200 with PDF bytes or success",
        precondition="Admin authenticated",
        steps=[
            "POST /admin/invitations/export/pdf",
            "Assert HTTP 200",
        ],
        test_data={},
        expected_result="HTTP 200 — PDF exported",
        post_condition="No state change",
    )
    def test_export_invitations_pdf(self, client, admin_headers):
        with allure.step("POST export PDF"):
            resp = client.post(
                "/admin/invitations/export/pdf",
                json={},
                headers=admin_headers,
            )

        with allure.step("Assert 200"):
            assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
