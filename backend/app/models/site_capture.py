from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import BigInteger, Boolean, Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SiteCapture(Base, TimestampMixin):
    """A dated reality-capture scan uploaded for the Progress Variance
    engine (2026-08-20, per Maro — see the approved plan,
    "Reality Captures: textured overlay + a precision point-cloud
    progress-variance engine"). Deliberately holds the *point cloud* only
    (kind="xyz" today, "e57" once that spike lands — see the plan's own
    E57-vs-.xyz tradeoff write-up), not the textured OBJ+MTL+texture set
    Part A's loadTexturedObj (import3d.ts) already renders — that stays a
    live-preview-only import (explicitly not persisted, see FourD.tsx's
    own handleImportTexturedObj) because it's a simplified, lossy mesh
    built for fast web viewing, not the precision source variance testing
    actually needs. mirrors Model3DFile's own "metadata row + a single
    file on local disk under settings.site_capture_storage_dir, named by a
    fresh storage_filename" shape closely (see that model's own docstring
    for the full disk-not-DB/UUID-not-original-name reasoning) rather than
    Zone's shape, since this table is fundamentally about one uploaded
    file's own identity, not a bag of freeform display fields.

    captured_at is the real-world date the scan was taken on site — the
    one field a ProgressVarianceTest actually needs to pick "the capture
    closest to this schedule date" and the field a project can have many
    of over time, unlike Model3DFile's single current-state-only row per
    name/kind.

    source_up_axis mirrors Model3DFile's own identical field — needed the
    same way on restore so a reloaded capture doesn't silently re-guess.

    force_visible (2026-08-20, per the plan's own AskUserQuestion answer:
    "manual toggle is still very useful") lets a capture stay shown in the
    viewport regardless of the timeline's own scrubbed date, alongside the
    schedule-date-driven auto-show Task #23 will add — a manual override,
    not a replacement for it, same spirit Zone.visible already carries for
    a different helper layer."""

    __tablename__ = "site_captures"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    captured_at: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="xyz")  # "xyz" | "e57" (e57 not yet implemented — see Task #22)
    source_up_axis: Mapped[str] = mapped_column(String(1), nullable=False, default="y")  # "y" | "z"
    storage_filename: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    force_visible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
