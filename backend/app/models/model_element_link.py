from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ModelElementLink(Base, TimestampMixin):
    """Links an Activity to an element in an imported 4D model (2026-07-11,
    per Maro). Not a RecordLink (record_link.py) — RecordLink's target_id is
    a strict UUID resolved against another table's row, but model elements
    aren't rows in this database, and element_ref is deliberately not an FK
    to Model3DFile either (model3d_file.py, added 2026-07-09): an element
    only ever exists as a string identifier re-derived each time its source
    file is loaded into the viewport, whether that's a fresh import or an
    auto-restored Model3DFile — so a link survives re-imports of the *same*
    file, and (crucially) survives the underlying Model3DFile being deleted
    entirely, e.g. via Unload. element_ref is that identifier — an IFC
    element's GlobalId (stable across re-imports of the same file) for
    source_kind="ifc", or the imported file's name for source_kind="mesh"
    (plain GLTF/OBJ/FBX imports have no reliable stable sub-element
    identity, so linking is scoped to the whole imported object, keyed by
    filename). element_label is a human-readable snapshot captured at link
    time, so the UI has something to show even before the matching file is
    back in the viewport.

    This loose coupling means a link can outlive every copy of its source
    file (2026-07-XX, per Maro: "if i unload a model and it still has
    linkages with other module data like an activity, this might cause an
    activity to store unnecessary amounts of data... I should be able to
    break all connection if I want") — FourD.tsx's requestUnloadModel
    resolves which links/keyframes belong to a model being unloaded and
    offers to delete them via the ordinary single-link DELETE below, rather
    than this table ever cascading automatically off a Model3DFile row.

    project_id is denormalised from the linked Activity (not client-
    supplied — see model_element_link.py's create_link) purely so the 4D
    page can list every link for a project in one query instead of joining
    through activities.

    animation_profile_id (2026-07-11, per Maro) — which saved
    AnimationProfile (animation_profile.py) drives this element's behaviour
    once the 4D timeline plays it back. Nullable and ON DELETE SET NULL:
    no profile assigned falls back to the timeline's own default behaviour
    (appear over the task's duration), and deleting a profile that's still
    assigned somewhere shouldn't take the link down with it — just reverts
    those links to that same default.

    source_kind="annotation" (2026-07-12, added alongside annotation.py) —
    element_ref is an Annotation row's own id, letting a Placemark/Footnote
    be linked to an Activity + AnimationProfile exactly like a mesh/IFC
    element is, so it pops per that profile's own existing Trigger/
    Transform/Opacity/Colour settings — see Viewport3D.tsx's
    AnnotationMarker for how the resulting positionOffset/opacity/color get
    applied to a marker rather than a mesh's material."""

    __tablename__ = "model_element_links"
    __table_args__ = (
        UniqueConstraint("activity_id", "source_kind", "element_ref", name="uq_model_element_links_activity_element"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    activity_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
    source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    element_label: Mapped[str] = mapped_column(String(300), nullable=False)
    animation_profile_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("animation_profiles.id", ondelete="SET NULL"), nullable=True
    )
