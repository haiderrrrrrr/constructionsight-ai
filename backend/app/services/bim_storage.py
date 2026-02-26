import os
import uuid
from pathlib import Path

import aiofiles

BIM_UPLOAD_DIR = Path(os.getenv("BIM_UPLOAD_DIR", "uploads/bim"))


async def save_glb(file_bytes: bytes, project_id: int) -> dict:
    BIM_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"project_{project_id}_{uuid.uuid4().hex[:10]}.glb"
    dest = BIM_UPLOAD_DIR / filename
    async with aiofiles.open(dest, "wb") as f:
        await f.write(file_bytes)
    return {
        "filename": filename,
        "model_url": f"/bim-models/{filename}",
        "size_bytes": len(file_bytes),
    }


def delete_glb(model_url: str) -> None:
    if not model_url:
        return
    filename = model_url.split("/bim-models/")[-1]
    path = BIM_UPLOAD_DIR / filename
    if path.exists():
        path.unlink()
