from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CostBaseline(Base, TimestampMixin):
    """A named, repeatable Cost Plan snapshot (2026-07-20, per Maro — Controls
    Dashboard Phase 1b), mirroring ScheduleBaseline's own shape. No
    "assign"/is_active step, same reasoning as RiskBaseline — CPI/EAC are
    always recomputed live off CostElement, never synced from a saved
    capture."""

    __tablename__ = "cost_baselines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    baseline_date: Mapped[date] = mapped_column(Date, nullable=False)
    baseline_set_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("baseline_sets.id", ondelete="SET NULL"), index=True
    )


class CostBaselineItem(Base):
    """One cost element's captured BAC/AC/% complete at the moment its
    CostBaseline was taken. bac/ac are the *resolved* figures (computed_budget/
    computed_actuals for a percentage element, budget/actuals for a fixed one
    — the same resolution app/services/cost_element.py:_apply_computed already
    does), not the raw rate/element_type — a percentage element's own subtotal
    depends on other elements' budgets at read time, and resolving it once at
    capture avoids needing to reconstruct that cross-element computation
    historically. CPI/EAC are deliberately NOT stored here — recomputed at
    comparison time from bac/ac/pct_complete via the same shared
    rollup_evm_from_totals/_cost_side_evm every other EVM figure in this app
    already goes through, never a second, independently-drifting formula."""

    __tablename__ = "cost_baseline_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cost_baselines.id", ondelete="CASCADE"), nullable=False, index=True
    )
    cost_element_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cost_elements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    bac: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    ac: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    pct_complete: Mapped[int | None] = mapped_column(Integer)
