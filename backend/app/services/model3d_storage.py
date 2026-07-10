from __future__ import annotations

import uuid
from pathlib import Path

from app.core.config import settings

# Local-disk file storage for Model3DFile (2026-07-09) — see that model's
# own docstring and config.py's model3d_storage_dir comment for why disk,
# not a DB column or cloud storage, for this pass. Resolved relative to
# wherever the backend process actually runs (matching database_url's own
# "just a setting, resolved at runtime" convention) rather than hardcoding
# an absolute path — `mkdir(parents=True, exist_ok=True)` on every call
# means this never needs a separate provisioning step.
def storage_dir() -> Path:
    path = Path(settings.model3d_storage_dir)
    path.mkdir(parents=True, exist_ok=True)
    return path


# A fresh UUID-based disk filename, never the user's own — sidesteps both
# path-traversal (a filename like "../../etc/passwd") and same-name
# collisions across projects/re-imports of "model.ifc". The original name is
# kept separately in Model3DFile.name for display/element_ref matching.
def generate_storage_filename(original_name: str) -> str:
    ext = Path(original_name).suffix
    return f"{uuid.uuid4()}{ext}"


def storage_path(storage_filename: str) -> Path:
    return storage_dir() / storage_filename


def delete_stored_file(storage_filename: str) -> None:
    path = storage_path(storage_filename)
    path.unlink(missing_ok=True)
