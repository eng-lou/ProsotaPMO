from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class FourDVideo(Base, TimestampMixin):
    """A recorded 4D timeline export (2026-07-20, per Maro: a dashboard
    widget to "open one of the videos 4d sequence vids we've captured").
    Viewport3D.tsx's own Export Video button already records the timeline
    playing from schedule start to finish as a .webm (canvas.captureStream()
    + MediaRecorder — see that component's own handleExportVideo docstring)
    but, until now, only ever downloaded it straight to the browser — nothing
    persisted server-side. This table + local-disk storage (see
    fourd_video_storage.py, same pattern as Model3DFile) is what makes "pick
    one of the videos we've captured" on the dashboard possible: the export
    flow now uploads here too, download still happens as well (kept, not
    replaced, so today's workflow doesn't change).

    Only metadata lives here — the actual bytes live on local disk under
    settings.fourd_video_storage_dir, named by storage_filename (a fresh
    UUID, never the user's own filename — same path-traversal/collision
    reasoning as Model3DFile). duration_sec is the recording's own
    Render/Capture Settings videoDurationSec at export time, not derived
    from the file — display-only context, never re-measured server-side."""

    __tablename__ = "fourd_videos"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    storage_filename: Mapped[str] = mapped_column(String(300), nullable=False, unique=True)
    duration_sec: Mapped[float] = mapped_column(Float, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
