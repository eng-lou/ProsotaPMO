from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Model3DFile(Base, TimestampMixin):
    """An imported IFC/GLTF/GLB/OBJ/FBX file, persisted across a hard
    refresh (2026-07-09, per Maro: "if i hard refresh please keep the
    models and associated data similar to the persistent data in
    Schedule... so i dont have to repeat my actions import again").

    Only metadata lives here — the actual bytes live in Cloudflare R2 (see
    app/core/config.py's own r2_* comment and object_storage.py for why —
    Vercel's hard 4.5MB Function request-body cap made local disk
    unworkable in production), keyed by storage_filename (despite the name,
    an R2 object key since the 2026-08-23 migration off local disk — a
    fresh UUID + the original extension, never the user's own filename —
    avoids both path-traversal and same-name collisions across projects/
    re-imports). name keeps the original filename for display and for
    mesh-kind ModelElementLink's own element_ref matching (that's keyed by
    filename, the only stable identifier a plain mesh import has — see
    model_element_link.py).

    source_up_axis mirrors frontend/src/modules/fourD/upAxis.ts's UpAxis
    ('y' | 'z') — the axis choice made in ImportModelDialog.tsx at import
    time, needed again on restore so a reloaded model doesn't silently fall
    back to a guessed default and re-introduce the very axis bugs that
    choice exists to fix.

    Deleted whenever the corresponding scene object is unloaded in the
    frontend (2026-07-09, per Maro: "if i unload, i expect the data not to
    persist so you dont endlessly store unnecessary data") — never kept
    around as an orphan the way, say, a soft-deleted row might be
    elsewhere in this app; there's no undo/trash concept for this table.

    unloaded_elements (2026-07-26, per Maro: "if i refresh, i expect the
    elements i unloaded to stay unloaded... give me an option to reload
    ifc which can identify the elements unloaded") — a JSONB list of
    `{guid, name, type_name}` for every IFC sub-element "Unload Selected"
    (the viewport toolbar action, distinct from unloading this whole file)
    has removed from the loaded scene. Keyed by GlobalId, not expressID —
    same reasoning as ModelElementLink.element_ref (model_element_link.py):
    expressID is only a WASM-session-local number, GlobalId is the one
    identifier stable across a fresh re-parse of the same file. Read back
    on every restore-on-mount (FourD.tsx) to re-apply the same removals
    without the user re-selecting anything, and shown (with name/type, no
    re-parse needed) in the "Reload IFC" picker so specific ones can be
    brought back. Nullable/JSONB rather than a dozen scalar columns, same
    flexible-blob precedent CameraView.viewport_state already established
    for "small, evolving, per-record structured data that isn't queried
    across rows".

    keep_raw_animation (2026-08-22, per Maro's own real Blender particle-
    VFX export, "Water Spray.glb") — True only for the case
    embeddedAnimationBake.ts's own findSingleAnimatedNode can never bake: a
    clip that animates more than one node independently (a real particle
    sim, not a rigid whole). For that case FourD.tsx's own import handler
    deliberately does NOT bake to ElementKeyframe rows and does NOT strip
    the file's own embedded animation — Viewport3D.tsx's
    EmbeddedAnimationLoop plays it back as a raw, always-looping preview
    instead. This flag is what tells the restore-on-mount path (FourD.tsx)
    to keep that raw animation on the reloaded object rather than
    stripping it the way every other mesh import's already-baked-once
    animation correctly gets stripped on restore (re-baking on every
    reload would duplicate keyframes dated from the reload day, not the
    original import day)."""

    __tablename__ = "model3d_files"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    source_up_axis: Mapped[str] = mapped_column(String(1), nullable=False, default="y")  # "y" | "z"
    storage_filename: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    unloaded_elements: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    keep_raw_animation: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
