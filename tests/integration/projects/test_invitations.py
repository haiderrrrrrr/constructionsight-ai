"""
Integration Tests — /invitations endpoints

Covers: list my invitations, accept valid token (creates membership),
        invitation status updated, expired token, wrong-email token,
        double-accept, nonexistent token, archived project invitation.
"""
import allure
import pytest
import secrets
from datetime import datetime, timedelta, timezone

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Invitation Flow"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project, _make_user
from app.models.project import ProjectStatus
from app.models.project_invitation import ProjectInvitation, InvitationStatus
from app.models.project_membership import ProjectRole


def _make_invitation(db, *, project_id, email, invited_by_id,
                     role=ProjectRole.PROJECT_MANAGER, days=7):
    inv = ProjectInvitation(
        email=email,
        project_id=project_id,
        role=role,
        token=secrets.token_urlsafe(48),
        expires_at=datetime.now(timezone.utc) + timedelta(days=days),
        invited_by=invited_by_id,
        status=InvitationStatus.PENDING,
    )
    db.add(inv)
    db.flush()
    return inv


class TestMyInvitations:
    @pytest.mark.testcase(
        tc_id="TC-INT-INV-001",
        objective="User sees their pending invitations",
        precondition="Invitation exists for regular_user's email",
        steps=[
            "Create project and invitation for regular_user.email",
            "GET /invitations/me as regular_user",
            "Assert HTTP 200",
            "Assert invitation for project_id present",
        ],
        test_data={"email": "user@test.com"},
        expected_result="HTTP 200, invitation for project_id in response",
        post_condition="No state change",
    )
    def test_user_sees_their_pending_invitations(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Invitation Project", location="Lyon",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        _make_invitation(db, project_id=project.id, email=regular_user.email,
                         invited_by_id=admin_user.id)
        resp = client.get("/invitations/me", headers=user_headers)
        assert resp.status_code == 200
        assert any(inv["project_id"] == project.id for inv in resp.json())

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-002",
        objective="Expired invitations do not appear in user's list",
        precondition="Expired invitation (days=-1) exists for regular_user",
        steps=[
            "Create invitation with expires_at in the past",
            "GET /invitations/me",
            "Assert expired invitation not in response",
        ],
        test_data={"expires_at": "past (days=-1)"},
        expected_result="Expired invitation excluded from list",
        post_condition="No state change",
    )
    def test_user_does_not_see_expired_invitations(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Expired Invite Project", location="Ghent",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        _make_invitation(db, project_id=project.id, email=regular_user.email,
                         invited_by_id=admin_user.id, days=-1)
        resp = client.get("/invitations/me", headers=user_headers)
        assert resp.status_code == 200
        assert all(inv["project_id"] != project.id for inv in resp.json())

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-003",
        objective="Unauthenticated cannot list invitations (401)",
        precondition="No Authorization header",
        steps=["GET /invitations/me with no token", "Assert HTTP 401"],
        test_data={"Authorization": "none"},
        expected_result="HTTP 401 Unauthorized",
        post_condition="No data exposed",
    )
    def test_unauthenticated_cannot_list_invitations(self, client):
        resp = client.get("/invitations/me")
        assert resp.status_code == 401


class TestAcceptInvitation:
    @pytest.mark.testcase(
        tc_id="TC-INT-INV-004",
        objective="Accepting valid token creates ACTIVE membership",
        precondition="Valid invitation exists for regular_user.email",
        steps=[
            "Create invitation",
            "POST /invitations/{token}/accept as regular_user",
            "Assert HTTP 200",
            "Query DB for membership",
            "Assert membership ACTIVE",
        ],
        test_data={"token": "<valid PENDING token>"},
        expected_result="HTTP 200, ProjectMembership created with status=ACTIVE",
        post_condition="User is now a project member",
    )
    def test_valid_token_creates_membership(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Accept Project", location="Porto",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code == 200
        from app.models.project_membership import ProjectMembership, MembershipStatus
        membership = db.query(ProjectMembership).filter(
            ProjectMembership.project_id == project.id,
            ProjectMembership.user_id == regular_user.id,
        ).first()
        assert membership is not None
        assert membership.status == MembershipStatus.ACTIVE

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-005",
        objective="After acceptance, invitation status changes to ACCEPTED",
        precondition="Valid PENDING invitation exists",
        steps=[
            "POST /invitations/{token}/accept",
            "Refresh invitation from DB",
            "Assert status == ACCEPTED",
        ],
        test_data={"action": "accept"},
        expected_result="invitation.status = ACCEPTED",
        post_condition="Invitation no longer PENDING",
    )
    def test_invitation_status_set_to_accepted(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Status Check Project", location="Seville",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id)
        client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        db.refresh(inv)
        assert inv.status == InvitationStatus.ACCEPTED

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-006",
        objective="Expired invitation token returns 400 with 'expired' message",
        precondition="Invitation with expires_at in the past",
        steps=[
            "POST /invitations/{expired_token}/accept",
            "Assert HTTP 400",
            "Assert 'expired' in detail",
        ],
        test_data={"expires_at": "past"},
        expected_result="HTTP 400 Bad Request, detail mentions 'expired'",
        post_condition="No membership created",
    )
    def test_expired_token_returns_400(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Expired Token Project", location="Bruges",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id, days=-1)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code == 400
        assert "expired" in resp.json()["detail"].lower()

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-007",
        objective="User with wrong email cannot accept invitation (403)",
        precondition="Invitation for someone_else@test.com; regular_user is authenticated",
        steps=[
            "Create invitation for different email",
            "POST /invitations/{token}/accept as regular_user",
            "Assert HTTP 403",
        ],
        test_data={"invitation_email": "someone_else@test.com",
                   "user_email": "user@test.com"},
        expected_result="HTTP 403 Forbidden — email mismatch",
        post_condition="No membership created",
    )
    def test_wrong_email_returns_403(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Wrong Email Project", location="Tallinn",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email="someone_else@test.com",
                               invited_by_id=admin_user.id)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code == 403

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-008",
        objective="Already-accepted token cannot be accepted again (400/409)",
        precondition="Invitation already accepted once",
        steps=[
            "POST /invitations/{token}/accept (first time)",
            "POST /invitations/{token}/accept (second time)",
            "Assert HTTP 400 or 409",
        ],
        test_data={"attempts": 2},
        expected_result="HTTP 400 or 409 on second accept",
        post_condition="Only one membership record exists",
    )
    def test_already_accepted_token_returns_400(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Double Accept Project", location="Riga",
                               status=ProjectStatus.DRAFT, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id)
        client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code in (400, 409)

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-009",
        objective="Non-existent invitation token returns 404",
        precondition="Token 'fakefakefakefaketoken' does not exist",
        steps=[
            "POST /invitations/fakefakefakefaketoken/accept",
            "Assert HTTP 404",
        ],
        test_data={"token": "fakefakefakefaketoken"},
        expected_result="HTTP 404 Not Found",
        post_condition="No state change",
    )
    def test_nonexistent_token_returns_404(self, client, user_headers):
        resp = client.post("/invitations/fakefakefakefaketoken/accept", headers=user_headers)
        assert resp.status_code == 404

    @pytest.mark.testcase(
        tc_id="TC-INT-INV-010",
        objective="Cannot accept invitation for an ARCHIVED project",
        precondition="Invitation exists for ARCHIVED project",
        steps=[
            "Create ARCHIVED project and invitation",
            "POST /invitations/{token}/accept",
            "Assert HTTP 400",
        ],
        test_data={"project_status": "archived"},
        expected_result="HTTP 400 — cannot join archived project",
        post_condition="No membership created",
    )
    def test_cannot_accept_invitation_for_archived_project(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Archived Invite Project", location="Vilnius",
                               status=ProjectStatus.ARCHIVED, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code == 400
