from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CostVarianceCriterion(Base, TimestampMixin):
    """One of 4 project-level variance bands (e.g. "Over Budget" = variance% >= 5%),
    used to compute the variance-severity badge shown against a cost element —
    the same numeric-range-to-label pattern as Risk's RiskImpactCriterion, applied
    to variance % instead of cost/schedule impact."""

    __tablename__ = "cost_variance_criteria"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 (Saving) .. 4 (Over Budget)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    min_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    max_pct: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))
    description: Mapped[str | None] = mapped_column(String(255))
