from __future__ import annotations

import uuid
from datetime import date, time

from sqlalchemy import Boolean, Date, ForeignKey, String, Time
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Calendar(Base, TimestampMixin):
    """Working-day pattern + daily working-hour envelope, project-scoped. Exactly one
    calendar per project is the default (activities with a null calendar_id inherit
    it) — see app/services/calendar.py. Per Maro's confirmed spec
    (docs/SCHEDULING_MODULE_PLAN.md Phase 4): whole project can sit on one calendar
    while individual activities override onto another (e.g. a Saturday-working
    calendar for one excavation activity needing weekend resource availability).

    Phase 10 (hour-level CPM): hours_per_day used to be a directly-entered number.
    It's now derived (day_end_time - day_start_time, minus CalendarBreak spans) —
    same "never expose a derivable value as a manual input" discipline already
    applied to Risk's EMV and Cost's CPI/SPI — see app/services/calendar_time.py.
    """

    __tablename__ = "calendars"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_project_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    day_start_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(8, 0))
    day_end_time: Mapped[time] = mapped_column(Time, nullable=False, default=time(17, 0))
    works_monday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_tuesday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_wednesday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_thursday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_friday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_saturday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    works_sunday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 2026-07-13, per Maro: every activity starts exactly at day_start_time
    # and finishes exactly at day_end_time, never mid-day — "its common
    # sense if i set the day envelope and net hours/day." Originally shipped
    # as an opt-in per-calendar toggle; Maro asked for that toggle removed
    # the same day ("i dont want that option, let it be whole day by
    # default") — defaults to True now, and the frontend (CalendarWidget.tsx)
    # no longer exposes any way to turn it off. The column and the CPM
    # engine's own conditional branch (scheduling_cpm.py's
    # _CalendarLookup.add_duration/subtract_duration/offset_hours) were
    # deliberately left in place rather than ripped out — both are already
    # tested and correct, and there's no user-facing way left to ever set
    # this False again, so keeping the mechanism costs nothing.
    whole_day_scheduling: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class CalendarBreak(Base, TimestampMixin):
    """A recurring daily non-working window (e.g. 12:00-13:00 lunch) subtracted from
    every working day's envelope on this calendar. Phase 10 addition — the "intuitive
    time editor" building block for the working/non-working-periods feature request."""

    __tablename__ = "calendar_breaks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    calendar_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)


class CalendarException(Base, TimestampMixin):
    """A date or date range that overrides the calendar's normal working-day
    pattern — either removing working days (bank holidays, shutdowns) or adding
    one (planned Saturday working), per the prototype's two example categories.

    Phase 10: start_time/end_time (both null, or both set) let an exception target
    just part of a day instead of the whole thing — e.g. "08:00-09:00 non-working"
    on one specific date, rather than marking the entire date non-working. Null
    start_time/end_time keeps the original whole-day behaviour.
    """

    __tablename__ = "calendar_exceptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    calendar_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_working: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
