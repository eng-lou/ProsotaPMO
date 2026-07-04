from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Activity(Base, TimestampMixin):
    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_activities_project_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    period_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False
    )
    task_name: Mapped[str] = mapped_column(String(500), nullable=False)
    # task | milestone | wbs_summary. Milestones always have zero duration; wbs_summary
    # is never accepted as API input directly — it's auto-assigned/removed by
    # app/services/activity.py:_recompute_hierarchy whenever an activity gains or loses
    # children (MS Project style: any row becomes a summary as soon as something is
    # indented under it). See docs/SCHEDULING_MODULE_PLAN.md Phase 2.
    activity_type: Mapped[str] = mapped_column(String(20), nullable=False, default="task")
    # Self-referencing outline hierarchy — no separate WBS-dictionary entity (P6 style);
    # the activity list *is* the WBS (MS Project style, per Maro 2026-07-02). Cascades on
    # delete: removing a summary task removes its subtree, matching MS Project behaviour.
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE")
    )
    # Sibling order within a parent — entirely server-managed (see _recompute_hierarchy),
    # never accepted as API input, same discipline as wbs_path below.
    sort_order: Mapped[int | None] = mapped_column(Integer)
    # Computed from parent_id + sort_order outline position ("1", "1.1", "1.2", "2"...)
    # — never accepted as API input from Phase 2 onward.
    wbs_path: Mapped[str | None] = mapped_column(String(500))
    # Phase 10 (hour-level CPM): duration_hours is now the primary input. duration_days
    # is the OLD field name repurposed as a computed, display-only value (duration_hours
    # / the activity's resolved calendar's net hours/day) — refreshed by
    # scheduling_cpm.recompute_schedule alongside start/finish, never accepted as API
    # input, same as those. Numeric now (was Integer) since it can be fractional.
    duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    duration_days: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # start/finish are computed by app/services/scheduling_cpm.py's forward/backward
    # pass (duration + logic + calendar + constraints), never accepted as API input
    # from Phase 5 onward — see docs/SCHEDULING_MODULE_PLAN.md. wbs_summary rows are
    # the exception: theirs stay rollups from children (_recompute_hierarchy).
    # DateTime since Phase 10 — hour-of-day now genuinely matters (a task can start
    # mid-morning and finish mid-afternoon), not just the calendar date.
    start: Mapped[datetime | None] = mapped_column(DateTime)
    finish: Mapped[datetime | None] = mapped_column(DateTime)
    actual_start: Mapped[datetime | None] = mapped_column(DateTime)
    actual_finish: Mapped[datetime | None] = mapped_column(DateTime)
    remaining_duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # bl_start/bl_finish/bl_duration_hours/variance_days/total_float_hours/
    # free_float_hours/is_critical are never accepted as API input (see
    # app/services/activity.py:_apply_computed_fields and
    # app/services/scheduling_cpm.py) — same discipline as Risk's EMV and Cost's
    # CPI/SPI fixes. bl_start/bl_finish/bl_duration_hours are set only by the "Set
    # Baseline" action (app/services/scheduling_baseline.py) — snapshotting current
    # start/finish/duration_hours, not the one-shot-at-creation freeze Cost Plan's
    # rev_a_baseline uses, since a schedule baseline is a deliberate, repeatable
    # capture (client-agreed revisions), not a value fixed forever at row creation.
    # total_float_hours/free_float_hours/is_critical are null for wbs_summary rows
    # (outside the CPM network).
    bl_start: Mapped[datetime | None] = mapped_column(DateTime)
    bl_finish: Mapped[datetime | None] = mapped_column(DateTime)
    bl_duration_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    # Whole-day wall-clock slip (finish vs bl_finish) — deliberately stays a simple
    # calendar-day count even post-Phase-10, since that's the unit planners actually
    # report variance in; duration/float (below) are the fields that needed hour
    # precision, not this summary figure.
    variance_days: Mapped[int | None] = mapped_column(Integer)
    pct_complete: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    # Renamed from total_float/free_float (Integer, whole working days) — Phase 10
    # makes float a genuinely fractional, hour-precision quantity (e.g. "4.5 hours of
    # float", not just whole days), so the rename makes the unit change impossible to
    # miss in code that reads these fields.
    total_float_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    free_float_hours: Mapped[Decimal | None] = mapped_column(Numeric(7, 2))
    is_critical: Mapped[bool | None] = mapped_column(Boolean)
    commentary: Mapped[str | None] = mapped_column(Text)
    # asap | snet (Start On or After) | ms (Mandatory Start) | fnlt (Finish On or Before).
    # constraint_date is required for every type except asap — see app/schemas/activity.py.
    # Per PMBOK7/Rita Mulcahy Ch. 8: soft constraints (snet/fnlt) can still be pushed by
    # the network; ms is hard and can produce negative float if infeasible. DateTime since
    # Phase 10 — a Mandatory Start can now pin an exact hour, not just a date.
    constraint_type: Mapped[str | None] = mapped_column(String(10))
    constraint_date: Mapped[datetime | None] = mapped_column(DateTime)
    # Null = inherit the project's default calendar (app/services/calendar.py). SET NULL
    # on delete: removing a custom calendar reverts any activities using it back to the
    # project default rather than blocking the delete or leaving a dangling reference.
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="SET NULL")
    )
    # Matches Risk/ICD/Cost's field of the same name — manually settable, and
    # auto-bumped whenever a reassessment is logged against this activity
    # (app/services/reassessment.py). Stays a plain Date — "last reviewed" only ever
    # needed day granularity, unlike the CPM-facing fields above.
    last_reviewed_date: Mapped[date | None] = mapped_column(Date)
