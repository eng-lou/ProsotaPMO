from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Risk(Base, TimestampMixin):
    __tablename__ = "risks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False
    )
    # Human-readable reference (e.g. "RSK-0001"), auto-generated, unique per project. Never reused.
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    # Theme + Area is a simplified two-dimensional Risk Breakdown Structure (RBS) —
    # `category` is the "Theme" (e.g. Schedule, Safety, Regulatory); `area` is the
    # second dimension (e.g. Vendor, Site, Stakeholders). See RISK_MODULE_PLAN.md.
    category: Mapped[str | None] = mapped_column(String(100))
    area: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    risk_owner: Mapped[str | None] = mapped_column(String(255))
    # Key dates. date_raised matches the prototype's "Date Identified"; last_reviewed_date
    # matches its "Last Reviewed" (also auto-bumped whenever a reassessment is logged —
    # see the generalised Reassessment model). expected_impact_date is Ch.12's risk factor "expected
    # timing for it to occur in the project life cycle" — when the risk would materialise.
    date_raised: Mapped[date | None] = mapped_column(Date)
    date_closed: Mapped[date | None] = mapped_column(Date)
    expected_impact_date: Mapped[date | None] = mapped_column(Date)
    last_reviewed_date: Mapped[date | None] = mapped_column(Date)
    # threat | opportunity — per PMBOK7/Rita Mulcahy, every risk is one or the other,
    # and each has its own distinct set of response strategies (see response_strategy).
    # Also drives EMV sign convention: threats subtract from budget/add schedule days;
    # opportunities add to budget/subtract schedule days. See RISK_MODULE_PLAN.md Phase 2.
    risk_type: Mapped[str] = mapped_column(String(20), nullable=False, default="threat")
    # avoid/mitigate/transfer/escalate/accept (threats) or exploit/enhance/share/
    # escalate/accept (opportunities) — validated against risk_type in the schema.
    response_strategy: Mapped[str | None] = mapped_column(String(20))
    # Risk-statement structure (Cause -> title as the short description -> Effect ->
    # Rationale/Assumptions) — a recognised risk-statement format, not decorative.
    cause: Mapped[str | None] = mapped_column(Text)
    effect: Mapped[str | None] = mapped_column(Text)
    rationale: Mapped[str | None] = mapped_column(Text)
    # Likelihood (0-1), used both for the qualitative heat-map rating and for EMV.
    # This triple represents the INHERENT (pre-mitigation) assessment — see the
    # _residual triple below for the post-mitigation target. PMBOK7/Rita Mulcahy:
    # there is almost always residual risk remaining even after a planned response.
    probability: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Qualitative/ordinal severity score (0-1), heat-map only. NOT used in EMV —
    # PMBOK draws a hard line between qualitative (ordinal, unitless) and
    # quantitative (real currency/duration) impact. See cost_most_likely/schedule_most_likely_days.
    impact: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Computed = probability x impact. Heat-map ranking score only, not a monetary value.
    rating: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Residual (post-mitigation target) probability/impact/rating — same qualitative
    # heat-map concept, assessed assuming the planned response has been carried out.
    probability_residual: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    impact_residual: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    rating_residual: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    rating_narrative: Mapped[str | None] = mapped_column(Text)
    # 3-point (Min/Most Likely/Max) quantitative estimate, in real currency/duration
    # units — matches the prototype's Quantitative Analysis tab. EMV uses only the
    # most-likely value (probability x cost_most_likely/schedule_most_likely_days);
    # min/max are range context only — the reference material's own worked EMV
    # examples are single-point, so a PERT-weighted formula isn't something we can
    # verify against source. Per PMBOK7 / Rita Mulcahy: EMV = Probability x Impact.
    cost_min: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    cost_most_likely: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    cost_max: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    schedule_min_days: Mapped[int | None] = mapped_column(Integer)
    schedule_most_likely_days: Mapped[int | None] = mapped_column(Integer)
    schedule_max_days: Mapped[int | None] = mapped_column(Integer)
    # Computed = probability x cost_most_likely / schedule_most_likely_days. Real EMV, not user input.
    emv_cost: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    emv_schedule_days: Mapped[Decimal | None] = mapped_column(Numeric(8, 2))
    mitigation_status: Mapped[str | None] = mapped_column(Text)
    # Two distinct plans per PMBOK7/Rita Mulcahy: what to do if the risk occurs
    # (contingency) vs what to do if that plan doesn't work (fallback).
    contingency_plan: Mapped[str | None] = mapped_column(Text)
    fallback_plan: Mapped[str | None] = mapped_column(Text)
