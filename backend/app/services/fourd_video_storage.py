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


def generate_storage_filename(original_name: str) -> str:
    ext = Path(original_name).suffix
    return f"{uuid.uuid4()}{ext}"


def storage_path(storage_filename: str) -> Path:
    return storage_dir() / storage_filename


def delete_stored_file(storage_filename: str) -> None:
    path = storage_path(storage_filename)
    path.unlink(missing_ok=True)
