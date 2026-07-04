from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class IcdItem(Base, TimestampMixin):
    __tablename__ = "icd_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False
    )
    # Discriminator: issue | change | decision
    item_type: Mapped[str] = mapped_column(String(20), nullable=False)

    # Shared fields — matches Rita Mulcahy Ch. 6's canonical Issue Log structure
    # (Figure 6.7): Issue# | Issue | Date Added | Raised By | Person Assigned |
    # Resolution Due Date | Status | Date Resolved | Resolution.
    # Human-readable reference (e.g. "ISS-0001"/"CHA-0001"/"DEC-0001"), auto-generated per
    # project per sub-type. Never reused.
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="open")
    priority: Mapped[str | None] = mapped_column(String(20))
    # raised_by = who raised it; owner = who's resolving it ("Person Assigned"). Distinct people.
    raised_by: Mapped[str | None] = mapped_column(String(255))
    owner: Mapped[str | None] = mapped_column(String(255))
    raised_date: Mapped[date | None] = mapped_column(Date)
    due_date: Mapped[date | None] = mapped_column(Date)
    closed_date: Mapped[date | None] = mapped_column(Date)
    resolution: Mapped[str | None] = mapped_column(Text)
    # Bumped automatically whenever a reassessment is logged (see the generalised
    # Reassessment model); editable directly too, mirroring the Risk module's Monitor-Risks pattern.
    last_reviewed_date: Mapped[date | None] = mapped_column(Date)

    # Change-specific — Integrated Change Control (PMBOK Ch. 4): a change is raised,
    # assessed, and taken to a CCB for a decision distinct from the generic status field.
    cost_impact: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    schedule_impact_days: Mapped[int | None] = mapped_column(Integer)
    change_type: Mapped[str | None] = mapped_column(String(30))  # variation | client_instruction | omission
    ccb_decision: Mapped[str | None] = mapped_column(String(20))  # approved | rejected | deferred
    rejection_reason: Mapped[str | None] = mapped_column(Text)
    contract_reference: Mapped[str | None] = mapped_column(Text)
    cost_claim: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    eot_claim_days: Mapped[int | None] = mapped_column(Integer)
    quality_impact: Mapped[str | None] = mapped_column(String(20))  # high | medium | low | none

    # Decision-specific
    decision_maker: Mapped[str | None] = mapped_column(String(255))
    required_by: Mapped[date | None] = mapped_column(Date)
    if_late_consequence: Mapped[str | None] = mapped_column(Text)

    # Issue-specific
    severity: Mapped[str | None] = mapped_column(String(20))  # low | medium | high | critical
