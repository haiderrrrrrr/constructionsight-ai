import pytest
from pydantic import ValidationError

from app.schemas.note import NoteCreate, NoteUpdate
from app.schemas.project_task import TaskCreate
from app.schemas.zone import ZoneCreate


pytestmark = pytest.mark.unit


class TestTaskSchemaValidation:
    def test_task_accepts_human_text_with_numbers(self):
        task = TaskCreate(title="Inspection Task 12", description="Check scaffold level 3")

        assert task.title == "Inspection Task 12"
        assert task.description == "Check scaffold level 3"

    @pytest.mark.parametrize("title", ["12345", "###", "<b>Task</b>"])
    def test_task_title_rejects_invalid_text(self, title):
        with pytest.raises(ValidationError):
            TaskCreate(title=title, description="Check scaffold today")

    @pytest.mark.parametrize("description", ["12345", "###", "<b>Check</b>"])
    def test_task_description_rejects_invalid_text(self, description):
        with pytest.raises(ValidationError):
            TaskCreate(title="Inspection Task", description=description)


class TestNoteSchemaValidation:
    def test_note_accepts_optional_empty_content(self):
        note = NoteCreate(title="Daily Note 7", content="", category="work")

        assert note.title == "Daily Note 7"
        assert note.content is None

    @pytest.mark.parametrize("title", ["12345", "###", "<b>Note</b>"])
    def test_note_title_rejects_invalid_text(self, title):
        with pytest.raises(ValidationError):
            NoteCreate(title=title, content="Useful work note", category="work")

    @pytest.mark.parametrize("content", ["12345", "###", "<b>Useful</b>"])
    def test_note_content_rejects_invalid_text_when_present(self, content):
        with pytest.raises(ValidationError):
            NoteCreate(title="Daily Note", content=content, category="work")

    def test_note_update_rejects_blank_title_when_provided(self):
        with pytest.raises(ValidationError):
            NoteUpdate(title="")


class TestZoneSchemaValidation:
    def test_zone_accepts_human_text_with_numbers(self):
        zone = ZoneCreate(name="Zone 2 North", description="Main entry area", zone_type="entry")

        assert zone.name == "Zone 2 North"
        assert zone.description == "Main entry area"

    def test_zone_accepts_single_letter_name(self):
        zone = ZoneCreate(name="A", description="Main entry area", zone_type="entry")

        assert zone.name == "A"

    @pytest.mark.parametrize("name", ["12345", "###", "<b>Zone</b>"])
    def test_zone_name_rejects_invalid_text(self, name):
        with pytest.raises(ValidationError):
            ZoneCreate(name=name, description="Main entry area", zone_type="entry")

    @pytest.mark.parametrize("description", ["12345", "###", "<b>Main</b>"])
    def test_zone_description_rejects_invalid_text_when_present(self, description):
        with pytest.raises(ValidationError):
            ZoneCreate(name="Zone North", description=description, zone_type="entry")
