from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Integer, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SchedulingQualityCriterion(Base, TimestampMixin):
    """One project-editable DCMA threshold (2026-07-03, per Maro) — check_number
    matches app/services/scheduling_quality.py's checks 1-11 (the percentage-
    threshold ones; check 12, Critical Path Test, is a structural pass/fail with
    no numeric threshold, so it's deliberately never represented here).

    Same auto-seed-on-first-read pattern as RiskProbabilityCriterion
    (app/services/risk_criteria.py) — a project sees the standard DCMA
    percentages until it edits them."""

    __tablename__ = "scheduling_quality_criteria"
    __table_args__ = (UniqueConstraint("project_id", "check_number", name="uq_scheduling_quality_criteria_project_check"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    check_number: Mapped[int] = mapped_column(Integer, nullable=False)
    threshold: Mapped[Decimal] = mapped_column(Numeric(5, 2), nullable=False)
