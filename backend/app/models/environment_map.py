from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class EnvironmentMap(Base, TimestampMixin):
    """A project's custom HDR/EXR environment for the 4D viewport's
    lighting/reflections (2026-09-30, per Maro — it used to be session-only
    and had to be re-uploaded every visit). One per project: uploading a
    new one replaces the old row (a new id, so the frontend's id-keyed
    local file cache can never serve stale bytes) and deletes its stored
    object. Bytes live in R2 under storage_filename, same as Model3DFile."""

    __tablename__ = "environment_maps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    storage_filename: Mapped[str] = mapped_column(String(500), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
