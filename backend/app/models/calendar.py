from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Calendar(Base, TimestampMixin):
    """Working-day pattern + hours/day, project-scoped. Exactly one calendar per
    project is the default (activities with a null calendar_id inherit it) — see
    app/services/calendar.py. Per Maro's confirmed spec (docs/SCHEDULING_MODULE_PLAN.md
    Phase 4): whole project can sit on one calendar while individual activities
    override onto another (e.g. a Saturday-working calendar for one excavation
    activity needing weekend resource availability)."""

    __tablename__ = "calendars"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    is_project_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hours_per_day: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=8)
    works_monday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_tuesday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_wednesday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_thursday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_friday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    works_saturday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    works_sunday: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


class CalendarException(Base, TimestampMixin):
    """A date or date range that overrides the calendar's normal working-day
    pattern — either removing working days (bank holidays, shutdowns) or adding
    one (planned Saturday working), per the prototype's two example categories."""

    __tablename__ = "calendar_exceptions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    calendar_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="CASCADE"), nullable=False
    )
    label: Mapped[str] = mapped_column(String(255), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_working: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
