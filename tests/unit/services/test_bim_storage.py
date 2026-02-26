import pytest

from app.services import bim_storage


pytestmark = [pytest.mark.unit]


@pytest.mark.testcase(
    tc_id="TC-UNIT-BIM-001",
    objective="save_glb writes file to BIM_UPLOAD_DIR and returns metadata",
    precondition="None",
    steps=["Patch BIM_UPLOAD_DIR to tmp_path", "Call save_glb", "Assert file exists and returned dict has model_url"],
    test_data={},
    expected_result="File exists on disk and metadata is correct",
    post_condition="File created in tmp dir",
)
@pytest.mark.asyncio
async def test_save_glb_writes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(bim_storage, "BIM_UPLOAD_DIR", tmp_path)
    out = await bim_storage.save_glb(b"abc", project_id=123)
    assert out["size_bytes"] == 3
    assert out["model_url"].startswith("/bim-models/")
    filename = out["filename"]
    assert (tmp_path / filename).exists()


@pytest.mark.testcase(
    tc_id="TC-UNIT-BIM-002",
    objective="delete_glb removes file when present and is a no-op for empty/missing files",
    precondition="None",
    steps=["Create file via save_glb", "Call delete_glb", "Assert file removed", "Call delete_glb with empty url"],
    test_data={},
    expected_result="File removed and function does not raise",
    post_condition="No file remains",
)
@pytest.mark.asyncio
async def test_delete_glb_removes_file(tmp_path, monkeypatch):
    monkeypatch.setattr(bim_storage, "BIM_UPLOAD_DIR", tmp_path)
    out = await bim_storage.save_glb(b"abc", project_id=1)
    filename = out["filename"]
    path = tmp_path / filename
    assert path.exists()
    bim_storage.delete_glb(out["model_url"])
    assert not path.exists()
    bim_storage.delete_glb("")
    bim_storage.delete_glb("/bim-models/does_not_exist.glb")

