from __future__ import annotations

import uuid
from datetime import date, time
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Index, String, Time, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.project import Project


class Period(Base, TimestampMixin):
    __tablename__ = "periods"

    # A project may accumulate many periods over its life (frozen, incorporated,
    # ...) but only one can ever be "live" at a time (ARCHITECTURE.md §3) — this
    # is the real DB-level guard behind app/api/periods.py's bootstrap endpoint,
    # added after two concurrent client-side "auto-create Period 1" calls once
    # silently created two "live" rows ~1.5ms apart for the same project (see
    # migration a3f9c02e5b71).
    __table_args__ = (
        Index(
            "uq_periods_project_live",
            "project_id",
            unique=True,
            postgresql_where=text("freeze_status = 'live'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_label: Mapped[str] = mapped_column(String(100), nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    # The data date's time-of-day (2026-07-03, per Maro) — null means "use the
    # default calendar's day_start_time", the original behaviour (see
    # app/services/scheduling_cpm.py:recompute_schedule's anchor line). Only
    # ever set explicitly via Reschedule's "set data date directly" mode
    # (app/services/scheduling_reschedule.py:set_data_date) — shifting by an
    # amount of days deliberately leaves whatever time was already set alone.
    start_time: Mapped[time | None] = mapped_column(Time)
    end_date: Mapped[date | None] = mapped_column(Date)
    cutoff_date: Mapped[date | None] = mapped_column(Date)
    # live | frozen | incorporating — enforced server-side per ARCHITECTURE.md §3
    freeze_status: Mapped[str] = mapped_column(String(20), nullable=False, default="live")
    baseline_locked_flag: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    project: Mapped[Project] = relationship(back_populates="periods")
