from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CostElement(Base, TimestampMixin):
    __tablename__ = "cost_elements"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Human-readable reference (e.g. "CST-0001"), auto-generated, unique per project. Never reused.
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    # 'fixed' = direct budget figure; 'percentage' = rate applied to sum of fixed elements
    element_type: Mapped[str] = mapped_column(String(20), nullable=False, default="fixed")
    # For percentage elements: rate as decimal fraction (0.15 = 15%). NULL for fixed elements.
    # Values are calculated at query time — never stored for percentage elements.
    rate: Mapped[Decimal | None] = mapped_column(Numeric(8, 6))
    element_group: Mapped[str | None] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    # cost_owner = accountable QS/lead for this line, matching the prototype's "Cost Owner".
    cost_owner: Mapped[str | None] = mapped_column(String(255))
    # Workflow status only — approved/cr_pending/tbc/credit. Deliberately does NOT include
    # Over Budget/Monitor/On Budget/Saving (those are a computed variance-band badge against
    # configurable thresholds, not a manual field — see CostVarianceCriterion) or Applied %
    # (auto-shown for percentage-type elements).
    status: Mapped[str | None] = mapped_column(String(20))
    scope_note: Mapped[str | None] = mapped_column(Text)
    variance_commentary: Mapped[str | None] = mapped_column(Text)
    qs_signoff_name: Mapped[str | None] = mapped_column(String(255))
    qs_signoff_date: Mapped[date | None] = mapped_column(Date)
    budget: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    actuals: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    rev_a_baseline: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    # Physical progress assessment (0-100) — a manual progress estimate, the standard
    # technique for Earned Value without a network-schedule integration: EV = BAC x
    # pct_complete. forecast/variance/cpi/eac/etc/vac/tcpi/cost_per_m2 are all computed at
    # query time from this + budget/actuals/rev_a_baseline/project.gfa_m2 — never stored.
    # forecast is not a separate field: it IS the computed EAC (same concept, "what do we
    # now expect this to finally cost"), falling back to budget before any progress exists.
    pct_complete: Mapped[int | None] = mapped_column(Integer)
    # Bumped automatically whenever a reassessment is logged (see Reassessment);
    # editable directly too, mirroring Risk/ICD's Monitor-Costs pattern.
    last_reviewed_date: Mapped[date | None] = mapped_column(Date)
    # Resources module (Phase 2, 2026-07-02): "schedule" = auto-managed from an
    # activity's resource assignments (app/services/cost_sync.py) — budget and rate
    # lines are kept in sync one-way, Scheduling -> Cost Plan. "manual" (default) =
    # a normal, independently-editable line, same as always. Editing budget or this
    # element's rate lines directly (app/services/cost_element.py,
    # cost_rate_line.py) permanently flips a "schedule" element to "manual" — per
    # Maro's confirmed spec (docs/RESOURCES_MODULE_PLAN.md), schedule data drives
    # cost until a user deliberately overrides it, then it's unlinked for good.
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="manual")
    linked_activity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="SET NULL"), unique=True
    )
    # A separate, independent benchmark figure (2026-07-18, per Maro: "make
    # that another field so it could be another projects costs... then the
    # variance separate from the budget vs forecast variance to simply show
    # the difference") — e.g. the equivalent line from a comparable project,
    # a tender return, or a cost plan revision being checked against this
    # one. Deliberately NOT forecast/EAC (that's a performance projection off
    # THIS element's own progress) and NOT rev_a_baseline (that's THIS
    # element's own frozen-at-creation budget) — a third, independent figure
    # with its own simple variance (budget - comparison_cost, see
    # CostElementResponse.comparison_variance), same "leave it blank rather
    # than show a fake number" discipline as everywhere else in this model.
    comparison_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
