import cloudinary
import cloudinary.uploader
from ..core.config import settings

cloudinary.config(
    cloud_name=settings.cloudinary_cloud_name,
    api_key=settings.cloudinary_api_key,
    api_secret=settings.cloudinary_api_secret,
    secure=True,
)


def upload_image(file_bytes: bytes, folder: str, public_id: str | None = None) -> dict:
    """Upload an image to Cloudinary. Returns the full upload result dict."""
    kwargs = {"folder": folder, "resource_type": "image"}
    if public_id:
        kwargs["public_id"] = public_id
    return cloudinary.uploader.upload(file_bytes, **kwargs)


def upload_pdf(pdf_bytes: bytes, folder: str, public_id: str) -> dict:
    """Upload a PDF to Cloudinary as a raw resource. Returns the full upload result dict."""
    return cloudinary.uploader.upload(
        pdf_bytes,
        folder=folder,
        public_id=public_id,
        resource_type="raw",
        format="pdf",
    )


def delete_asset(public_id: str, resource_type: str = "image") -> dict:
    """Delete an asset from Cloudinary by its public_id."""
    return cloudinary.uploader.destroy(public_id, resource_type=resource_type)
