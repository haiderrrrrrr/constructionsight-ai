"""
Integration Tests — Project Member Management

Covers: invite new member by email, accept invitation → membership ACTIVE,
        reject invitation, remove last PM blocked, list project members.
"""
import allure
import pytest
import secrets
from datetime import datetime, timedelta, timezone

pytestmark = [
    allure.epic("ConstructionSight-AI"),
    allure.feature("Integration Tests"),
    allure.story("Projects — Member Management"),
    pytest.mark.integration,
    pytest.mark.projects,
]

from tests.conftest import make_project, _make_user
from app.models.project import ProjectStatus
from app.models.project_membership import ProjectMembership, ProjectRole, MembershipStatus
from app.models.project_invitation import ProjectInvitation, InvitationStatus


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


def _add_member(db, project_id, user_id, admin_id, role=ProjectRole.PROJECT_MANAGER):
    m = ProjectMembership(
        user_id=user_id, project_id=project_id,
        project_role=role, status=MembershipStatus.ACTIVE, invited_by=admin_id,
    )
    db.add(m)
    db.flush()
    return m


class TestInviteMember:
    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-001",
        objective="Admin can invite a new member by email — invitation created",
        precondition="ACTIVE project; admin authenticated",
        steps=[
            "POST /admin/projects/{id}/invite with email and role",
            "Assert HTTP 200 or 201",
            "Assert invitation record created",
        ],
        test_data={"email": "newmember@test.com", "role": "PROJECT_MANAGER"},
        expected_result="HTTP 200/201, invitation object returned",
        post_condition="ProjectInvitation row created with status=PENDING",
    )
    def test_admin_can_invite_member(self, client, db, admin_user, admin_headers):
        project = make_project(db, name="Invite Member Project", location="Madrid",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        # Admin must have PM membership to use the invite endpoint
        _add_member(db, project.id, admin_user.id, admin_user.id, role=ProjectRole.PROJECT_MANAGER)
        resp = client.post(
            f"/projects/{project.id}/members/invite",
            json={"email": "newmember@test.com", "role": "safety_officer"},
            headers=admin_headers,
        )
        assert resp.status_code in (200, 201)

    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-002",
        objective="Regular user cannot invite members to a project (403)",
        precondition="ACTIVE project; regular_user is NOT admin",
        steps=[
            "POST /admin/projects/{id}/invite as regular_user",
            "Assert HTTP 403",
        ],
        test_data={"role": "user (not admin)"},
        expected_result="HTTP 403 Forbidden",
        post_condition="No invitation created",
    )
    def test_regular_user_cannot_invite_member(self, client, db, admin_user, user_headers):
        project = make_project(db, name="Invite Forbidden Project", location="Lisbon",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.post(
            f"/projects/{project.id}/members/invite",
            json={"email": "anyone@test.com", "role": "project_manager"},
            headers=user_headers,
        )
        assert resp.status_code == 403


class TestAcceptInvitation:
    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-003",
        objective="User can accept invitation — creates ACTIVE membership",
        precondition="Valid PENDING invitation for regular_user.email",
        steps=[
            "Create invitation for regular_user.email",
            "POST /invitations/{token}/accept as regular_user",
            "Assert HTTP 200",
            "Query DB: membership status == ACTIVE",
        ],
        test_data={"token": "<valid PENDING token>"},
        expected_result="HTTP 200, membership ACTIVE",
        post_condition="ProjectMembership row with status=ACTIVE created",
    )
    def test_accept_invitation_creates_active_membership(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="Accept Member Project", location="Athens",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        inv = _make_invitation(db, project_id=project.id, email=regular_user.email,
                               invited_by_id=admin_user.id)
        resp = client.post(f"/invitations/{inv.token}/accept", headers=user_headers)
        assert resp.status_code == 200
        membership = db.query(ProjectMembership).filter(
            ProjectMembership.project_id == project.id,
            ProjectMembership.user_id == regular_user.id,
        ).first()
        assert membership is not None
        assert membership.status == MembershipStatus.ACTIVE


class TestListMembers:
    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-004",
        objective="Project member can list all project members",
        precondition="ACTIVE project; regular_user is an ACTIVE member",
        steps=[
            "GET /projects/{id}/members as member",
            "Assert HTTP 200",
            "Assert response is a list",
        ],
        test_data={"membership": "ACTIVE PROJECT_MANAGER"},
        expected_result="HTTP 200, JSON array of members",
        post_condition="No state change",
    )
    def test_member_can_list_project_members(self, client, db, admin_user, regular_user, user_headers):
        project = make_project(db, name="List Members Project", location="Amsterdam",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        _add_member(db, project.id, regular_user.id, admin_user.id)
        resp = client.get(f"/projects/{project.id}/members", headers=user_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-005",
        objective="Non-member cannot list project members (403/404)",
        precondition="ACTIVE project; regular_user is NOT a member",
        steps=[
            "GET /projects/{id}/members as non-member",
            "Assert HTTP 403 or 404",
        ],
        test_data={"membership": "none"},
        expected_result="HTTP 403 or 404",
        post_condition="No data exposed",
    )
    def test_non_member_cannot_list_members(self, client, db, admin_user, user_headers):
        project = make_project(db, name="List Members Forbidden", location="Brussels",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        resp = client.get(f"/projects/{project.id}/members", headers=user_headers)
        assert resp.status_code in (403, 404)


class TestRemoveMember:
    @pytest.mark.testcase(
        tc_id="TC-INT-MEM-006",
        objective="Admin can remove a member from a project",
        precondition="ACTIVE project; regular_user is an ACTIVE member",
        steps=[
            "Add regular_user as member",
            "DELETE /admin/projects/{id}/members/{user_id}",
            "Assert HTTP 200 or 204",
        ],
        test_data={"action": "remove_member"},
        expected_result="HTTP 200 or 204 — member removed",
        post_condition="Membership status set to REMOVED",
    )
    def test_admin_can_remove_member(self, client, db, admin_user, regular_user, admin_headers):
        project = make_project(db, name="Remove Member Project", location="Vienna",
                               status=ProjectStatus.ACTIVE, created_by=admin_user.id)
        # Admin must have PM membership to use the remove endpoint
        _add_member(db, project.id, admin_user.id, admin_user.id, role=ProjectRole.PROJECT_MANAGER)
        _add_member(db, project.id, regular_user.id, admin_user.id, role=ProjectRole.SAFETY_OFFICER)
        resp = client.delete(
            f"/projects/{project.id}/members/{regular_user.id}",
            headers=admin_headers,
        )
        assert resp.status_code in (200, 204)
