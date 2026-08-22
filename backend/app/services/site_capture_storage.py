from __future__ import annotations

import uuid
from pathlib import Path

from app.core.config import settings

# Local-disk file storage for SiteCapture (2026-08-20) — a straight mirror
# of model3d_storage.py's own functions, pointed at
# settings.site_capture_storage_dir instead; see that module's docstring
# and site_capture.py's own for the full reasoning (same disk-not-DB
# choice, same UUID-not-original-filename convention).
def storage_dir() -> Path:
    path = Path(settings.site_capture_storage_dir)
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
