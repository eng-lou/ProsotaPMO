from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class IcdCriterion(Base, TimestampMixin):
    """A project-level, editable definition of what one level of an ICD rating
    dimension means (e.g. "High priority = requires prompt attention"). All
    three dimensions (priority/severity/quality_impact) are ordinal/categorical
    only — unlike Risk's probability/impact criteria there's no numeric range,
    just a level, a label, and a narrative description."""

    __tablename__ = "icd_criteria"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    dimension: Mapped[str] = mapped_column(String(30), nullable=False)  # priority | severity | quality_impact
    level: Mapped[int] = mapped_column(Integer, nullable=False)  # ascending: 1 = lowest
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))
