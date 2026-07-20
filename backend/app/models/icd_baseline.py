from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class IcdBaseline(Base, TimestampMixin):
    """A named, repeatable Issues/Changes/Decisions log snapshot (2026-07-20,
    per Maro — Controls Dashboard Phase 1b), mirroring ScheduleBaseline's own
    shape. No "assign"/is_active step, same reasoning as RiskBaseline/
    CostBaseline."""

    __tablename__ = "icd_baselines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    baseline_date: Mapped[date] = mapped_column(Date, nullable=False)
    baseline_set_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("baseline_sets.id", ondelete="SET NULL")
    )


class IcdBaselineItem(Base):
    """One issue/change/decision's captured type/status at the moment its
    IcdBaseline was taken. code/title/item_type are denormalised, same
    "what was it called/typed in the baseline" reasoning as
    RiskBaselineItem's own code/title."""

    __tablename__ = "icd_baseline_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("icd_baselines.id", ondelete="CASCADE"), nullable=False
    )
    icd_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("icd_items.id", ondelete="CASCADE"), nullable=False
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    status: Mapped[str] = mapped_column(String(50), nullable=False)
