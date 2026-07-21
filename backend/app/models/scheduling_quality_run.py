from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class SchedulingQualityRun(Base, TimestampMixin):
    """A named, saved snapshot of a Schedule Quality Analysis (2026-07-03, per
    Maro: "save the test to view again") — the live GET /scheduling-quality/
    endpoint always recomputes against the schedule's current state, so
    without this a planner has no way to preserve what a report looked like
    at a point in time (e.g. before/after a corrective-action pass).

    report is the full computed dict from
    app/services/scheduling_quality.py:compute_quality, stored verbatim as
    JSONB — a frozen copy, not re-derived when viewed later."""

    __tablename__ = "scheduling_quality_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Was `period_id` until the schedule-variants split (2026-07-07, per Maro —
    # docs/SCHEDULE_VARIANTS_PLAN.md) — a quality run analyses a schedule, not a
    # reporting cycle, so it moves with Activity onto SchedulePeriod.
    schedule_period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_periods.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    report: Mapped[dict] = mapped_column(JSONB, nullable=False)
    # Which sub-project (if any) this run was scoped to (2026-07-06, per Maro
    # — docs/SUBPROJECT_FLOAT_PLAN.md §F) — null = whole schedule. A separate
    # column rather than only relying on scope_subproject_id already living
    # inside `report`'s own JSONB, so a saved run's scope survives that
    # sub-project being renamed or untagged later (report.scope_name is
    # frozen at save time; this FK is SET NULL, not cascade-deleted, if the
    # tag itself is later removed — see app/services/schedule_subproject.py).
    scope_subproject_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_subprojects.id", ondelete="SET NULL"), index=True
    )
