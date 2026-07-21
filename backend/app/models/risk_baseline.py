from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RiskBaseline(Base, TimestampMixin):
    """A named, repeatable Risk Register snapshot (2026-07-20, per Maro —
    Controls Dashboard Phase 1b), mirroring app/models/schedule_baseline.py's
    own ScheduleBaseline shape. Unlike Schedule, there's no "assign"/is_active
    step — Risk has no live bl_* columns a baseline needs to sync into
    (rating/EMV are always read live off Risk itself); this is purely a
    capture-now, compare-later snapshot for the Controls Dashboard's Baseline
    Comparison tab."""

    __tablename__ = "risk_baselines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    baseline_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Optional — links this standalone baseline into a shared BaselineSet
    # (see baseline_set.py). SET NULL on delete: removing a set must never
    # delete the module baselines it happened to link, only un-link them.
    baseline_set_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("baseline_sets.id", ondelete="SET NULL"), index=True
    )


class RiskBaselineItem(Base):
    """One risk's captured rating/EMV/status at the moment its RiskBaseline
    was taken. ON DELETE CASCADE on both FKs — same "this is a historical
    snapshot, not something anyone edits directly" reasoning
    ScheduleBaselineActivity already documents.

    code/title are denormalised (not just risk_id) for the same reason
    ScheduleBaselineActivity denormalises code: a risk can be renamed after
    baselining, and this answers "what was it called in the baseline"
    independently of whatever it's called now."""

    __tablename__ = "risk_baseline_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("risk_baselines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    risk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("risks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
    rating: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    emv_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    emv_schedule_days: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
