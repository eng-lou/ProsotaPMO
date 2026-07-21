from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RiskProbabilityCriterion(Base, TimestampMixin):
    """One of 5 project-level probability bands (e.g. "Medium" = 25-50%), used to
    standardise what a probability rating means — per PMBOK7/Rita Mulcahy's risk
    management plan concept of "definitions of probability and impact"."""

    __tablename__ = "risk_probability_criteria"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 (Very Low) .. 5 (Very High)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    min_probability: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    max_probability: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255))


class RiskImpactCriterion(Base, TimestampMixin):
    """One of 5 project-level impact bands. Unlike probability, impact needs both
    a cost range AND a schedule range per level (they're independent — a risk
    could be cost-Critical but schedule-Low, or vice versa)."""

    __tablename__ = "risk_impact_criteria"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)  # 1 (Negligible) .. 5 (Critical)
    label: Mapped[str] = mapped_column(String(50), nullable=False)
    min_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    max_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    min_schedule_days: Mapped[int | None] = mapped_column(Integer)
    max_schedule_days: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(String(255))
