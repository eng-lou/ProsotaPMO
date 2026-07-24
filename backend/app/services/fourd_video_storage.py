from __future__ import annotations

import uuid
from pathlib import Path

from app.core.config import settings

# Local-disk file storage for FourDVideo (2026-07-20) — mirrors
# model3d_storage.py exactly, see that file's own comment and
# config.py's fourd_video_storage_dir comment for why disk, not a DB
# column or cloud storage.
def storage_dir() -> Path:
    path = Path(settings.fourd_video_storage_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


# content_type -> extension (2026-07-25, per Maro: "can we get an mp4
# rendering option" — Viewport3D.tsx's own handleExportVideo can now record
# either .webm or .mp4). `original_name` is the human display name typed/
# generated client-side (e.g. "4D Sequence 7/25/2026, 11:15:00 AM"), never a
# real filename with an extension, so deriving the extension from it (the
# old behaviour) always silently produced no extension at all — harmless
# only because get_download used to hardcode media_type="video/webm"
# regardless. Now that two real formats exist, the extension has to come
# from the upload's own actual Content-Type instead, so get_download below
# can serve the correct media_type back for whichever one was really
# recorded.
CONTENT_TYPE_EXTENSIONS = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
}


def generate_storage_filename(content_type: str | None) -> str:
    ext = CONTENT_TYPE_EXTENSIONS.get(content_type or "", ".webm")
    return f"{uuid.uuid4()}{ext}"


def media_type_for_storage_filename(storage_filename: str) -> str:
    ext = Path(storage_filename).suffix
    return next((ct for ct, e in CONTENT_TYPE_EXTENSIONS.items() if e == ext), "video/webm")


def storage_path(storage_filename: str) -> Path:
    return storage_dir() / storage_filename


def delete_stored_file(storage_filename: str) -> None:
    path = storage_path(storage_filename)
    path.unlink(missing_ok=True)
