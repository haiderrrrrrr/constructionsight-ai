import pytest

from app.models.project_membership import ProjectRole
from app.services import bim_storage
from tests.accessories.factories import (
    AdminFactory,
    ProjectFactory,
    ProjectMembershipFactory,
    SiteFactory,
    UserFactory,
)
from tests.conftest import _auth_headers


pytestmark = [pytest.mark.integration, pytest.mark.bim]


def _setup_project(db):
    admin = AdminFactory(db=db)
    site = SiteFactory(db=db, created_by=admin.id)
    project = ProjectFactory(db=db, created_by=admin.id, site_id=site.id)
    pm = UserFactory(db=db)
    non_member = UserFactory(db=db)
    ProjectMembershipFactory(
        db=db,
        user_id=pm.id,
        project_id=project.id,
        project_role=ProjectRole.PROJECT_MANAGER,
        invited_by=admin.id,
    )
    db.flush()
    return admin, project, pm, non_member


@pytest.mark.testcase(
    tc_id="TC-INT-BIM-001",
    objective="Member can read BIM config and non-member gets 403",
    precondition="Project exists; one user is member; another is not",
    steps=["GET /projects/{id}/bim/config with member token", "GET with non-member token"],
    test_data={},
    expected_result="200 for member; 403 for non-member",
    post_condition="Config row may be created",
)
def test_bim_config_access_control(client, db):
    _, project, pm, non_member = _setup_project(db)

    r1 = client.get(f"/projects/{project.id}/bim/config", headers=_auth_headers(pm))
    assert r1.status_code == 200
    assert r1.json()["project_id"] == project.id

    r2 = client.get(f"/projects/{project.id}/bim/config", headers=_auth_headers(non_member))
    assert r2.status_code == 403


@pytest.mark.testcase(
    tc_id="TC-INT-BIM-002",
    objective="Only PM can upload/delete BIM model",
    precondition="Project exists; PM member and non-PM member exist",
    steps=["POST /bim/model as non-PM member", "Assert 403"],
    test_data={},
    expected_result="403 for non-PM member",
    post_condition="No model stored",
)
def test_bim_upload_requires_pm(client, db):
    admin = AdminFactory(db=db)
    site = SiteFactory(db=db, created_by=admin.id)
    project = ProjectFactory(db=db, created_by=admin.id, site_id=site.id)
    analyst = UserFactory(db=db)
    ProjectMembershipFactory(
        db=db,
        user_id=analyst.id,
        project_id=project.id,
        project_role=ProjectRole.DATA_ANALYST,
        invited_by=admin.id,
    )
    db.flush()

    resp = client.post(
        f"/projects/{project.id}/bim/model",
        files={"file": ("model.glb", b"abc", "model/gltf-binary")},
        headers=_auth_headers(analyst),
    )
    assert resp.status_code == 403


@pytest.mark.testcase(
    tc_id="TC-INT-BIM-003",
    objective="PM can upload and delete BIM model; metadata and file storage are consistent",
    precondition="Project exists; PM member exists",
    steps=["Upload invalid extension -> 400", "Upload .glb -> 200", "Delete -> 200"],
    test_data={},
    expected_result="Upload stores model metadata and file; delete clears both",
    post_condition="No model remains after delete",
)
def test_bim_upload_and_delete(client, db, tmp_path, monkeypatch):
    monkeypatch.setattr(bim_storage, "BIM_UPLOAD_DIR", tmp_path)
    _, project, pm, _ = _setup_project(db)

    bad = client.post(
        f"/projects/{project.id}/bim/model",
        files={"file": ("model.txt", b"abc", "text/plain")},
        headers=_auth_headers(pm),
    )
    assert bad.status_code == 400

    uploaded = client.post(
        f"/projects/{project.id}/bim/model",
        files={"file": ("model.glb", b"abc", "model/gltf-binary")},
        headers=_auth_headers(pm),
    )
    assert uploaded.status_code == 200
    data = uploaded.json()
    assert data["project_id"] == project.id
    assert data["model_filename"] == "model.glb"
    assert data["model_size_bytes"] == 3
    assert data["model_url"].startswith("/bim-models/")

    filename = data["model_url"].split("/bim-models/")[-1]
    assert (tmp_path / filename).exists()

    deleted = client.delete(
        f"/projects/{project.id}/bim/model",
        headers=_auth_headers(pm),
    )
    assert deleted.status_code == 200
    out = deleted.json()
    assert out["model_url"] is None
    assert out["model_filename"] is None
    assert not (tmp_path / filename).exists()

