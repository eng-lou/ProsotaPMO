from __future__ import annotations

import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Time, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SchedulePeriod(Base, TimestampMixin):
    """`Period`'s exact counterpart for schedule data, scoped to a
    `ScheduleVariant` instead of a project (2026-07-07, per Maro —
    docs/SCHEDULE_VARIANTS_PLAN.md §D.1, private docs repo).

    `Period` used to be shared by Activity *and* Risk/CostElement/IcdItem — the
    same table meant both "which reporting cycle" and "which schedule," which
    is exactly what broke once a project needed more than one schedule (a
    promotion would otherwise have to migrate Risk/Cost/ICD's own reporting
    history onto whichever variant just became master). This table exists
    purely to take over the "which schedule" half for `Activity` and its
    schedule-side siblings (`ActivityRelationship` via activity_id,
    `ResourceAssignment` via activity_id, `ActivityCodeHistory`,
    `ScheduleBaseline`, `SchedulingQualityRun`) — `Period` itself is untouched
    and now belongs to Risk/Cost/ICD alone, so nothing about their reporting
    can ever be affected by schedule-variant changes.

    Field-for-field identical to `Period`, including the same "exactly one
    live per parent" partial unique index — just a different parent
    (`schedule_variant_id` instead of `project_id`).
    """

    __tablename__ = "schedule_periods"

    __table_args__ = (
        Index(
            "uq_schedule_periods_variant_live",
            "schedule_variant_id",
            unique=True,
            postgresql_where=text("freeze_status = 'live'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    schedule_variant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_variants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_label: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_date: Mapped[date | None] = mapped_column(Date)
    cutoff_date: Mapped[date | None] = mapped_column(Date)
    # live | frozen | incorporating — same enforcement as Period, see ARCHITECTURE.md §3.
    freeze_status: Mapped[str] = mapped_column(String(20), nullable=False, default="live")
    baseline_locked_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
