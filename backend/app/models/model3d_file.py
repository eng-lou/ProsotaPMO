from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Model3DFile(Base, TimestampMixin):
    """An imported IFC/GLTF/GLB/OBJ/FBX file, persisted across a hard
    refresh (2026-07-09, per Maro: "if i hard refresh please keep the
    models and associated data similar to the persistent data in
    Schedule... so i dont have to repeat my actions import again").

    Only metadata lives here — the actual bytes live on local disk under
    settings.model3d_storage_dir (see app/core/config.py's own comment on
    why local disk, not S3/blob storage or a DB column, for this pass),
    named by storage_filename (a fresh UUID + the original extension, never
    the user's own filename — avoids both path-traversal and same-name
    collisions across projects/re-imports). name keeps the original
    filename for display and for mesh-kind ModelElementLink's own
    element_ref matching (that's keyed by filename, the only stable
    identifier a plain mesh import has — see model_element_link.py).

    source_up_axis mirrors frontend/src/modules/fourD/upAxis.ts's UpAxis
    ('y' | 'z') — the axis choice made in ImportModelDialog.tsx at import
    time, needed again on restore so a reloaded model doesn't silently fall
    back to a guessed default and re-introduce the very axis bugs that
    choice exists to fix.

    Deleted whenever the corresponding scene object is unloaded in the
    frontend (2026-07-09, per Maro: "if i unload, i expect the data not to
    persist so you dont endlessly store unnecessary data") — never kept
    around as an orphan the way, say, a soft-deleted row might be
    elsewhere in this app; there's no undo/trash concept for this table."""

    __tablename__ = "model3d_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    source_up_axis: Mapped[str] = mapped_column(String(1), nullable=False, default="y")  # "y" | "z"
    storage_filename: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
