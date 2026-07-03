from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ScheduleBaseline(Base, TimestampMixin):
    """A named, repeatable schedule baseline capture (per Maro's P6-style
    correction: not one overwriteable slot on the period, but a saved,
    dated snapshot you can create many of and switch between). baseline_date
    is a user-set label (e.g. a formal contract-agreed date) — distinct from
    created_at, which is just when the row was inserted.

    Activity.bl_start/bl_finish/bl_duration_hours remain the single source
    every other feature reads (variance, DCMA checks, CSV/print, the grid) —
    they represent whichever baseline is currently *assigned* (is_active on
    this table, copied in by
    app/services/schedule_baseline.py:assign_baseline). This table is the
    saved-snapshot library those columns get populated from, not a
    replacement for them.

    is_active lives here (not a Period.active_baseline_id FK back to this
    table) deliberately — that shape is a genuine circular FK between
    periods and schedule_baselines (this table already points at periods via
    period_id), which broke SQLAlchemy's table create/drop ordering in tests
    (confirmed: CircularDependencyError) and left stale reads through the
    back-reference. At most one row per period_id should have is_active=True
    at a time — enforced in app/services/schedule_baseline.py:assign_baseline,
    not a DB constraint (a partial unique index would need one, but this is
    simple enough to keep application-level given the assign action is the
    only place that ever flips it)."""

    __tablename__ = "schedule_baselines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("periods.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    baseline_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class ScheduleBaselineActivity(Base):
    """One activity's start/finish/duration_hours at the moment its
    ScheduleBaseline was captured. ON DELETE CASCADE on both FKs — deleting
    the baseline removes its snapshot rows, and deleting an activity removes
    its historical snapshot entries rather than leaving orphaned references
    (this is pre-production data; a real "keep history past activity
    deletion" requirement would need denormalized code/task_name fields,
    deliberately not built ahead of that need)."""

    __tablename__ = "schedule_baseline_activities"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    baseline_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("schedule_baselines.id", ondelete="CASCADE"), nullable=False
    )
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    start: Mapped[datetime | None] = mapped_column(DateTime)
    finish: Mapped[datetime | None] = mapped_column(DateTime)
    duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
