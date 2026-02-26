import pytest
from pydantic import ValidationError

from app.schemas.camera import CameraCreate, CameraUpdate

pytestmark = pytest.mark.unit


def _camera_payload(**overrides):
    payload = {
        "site_id": 1,
        "name": "Main Gate Camera",
        "vendor": "Hikvision",
        "model": "DS-2CD2185G1",
        "serial_number": "123456",
        "rtsp_url": "rtsp://example.local/stream",
    }
    payload.update(overrides)
    return payload


def test_camera_create_rejects_numeric_only_name():
    with pytest.raises(ValidationError):
        CameraCreate(**_camera_payload(name="12345"))


def test_camera_create_rejects_numeric_only_vendor_when_present():
    with pytest.raises(ValidationError):
        CameraCreate(**_camera_payload(vendor="12345"))


def test_camera_create_allows_numeric_only_serial_number():
    camera = CameraCreate(**_camera_payload(serial_number="1234567890"))
    assert camera.serial_number == "1234567890"


def test_camera_update_rejects_numeric_only_model_when_present():
    with pytest.raises(ValidationError):
        CameraUpdate(model="12345")


def test_camera_update_allows_mixed_name():
    camera = CameraUpdate(name="Gate 7 Cam")
    assert camera.name == "Gate 7 Cam"
