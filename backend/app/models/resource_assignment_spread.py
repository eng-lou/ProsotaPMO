from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ResourceAssignmentSpread(Base, TimestampMixin):
    """A single hand-edited day within a ResourceAssignment's time-phased
    hours (docs/SCHEDULING_GAPS_PLAN.md, Resource Tracking — manual resource
    leveling). Sparse by design: a row only exists for a day the user has
    actually overridden via the Resource Tracking spreadsheet — everywhere
    else, that day's hours are computed on the fly (calendar working-hours
    that day x the assignment's own utilisation_pct, see
    app/services/resource_assignment_spread.py:default_hours_for_day), so day-
    granularity is the one source of truth regardless of which zoom (day/
    week/month/quarter/year) the user was looking at when they edited a cell.
    """

    __tablename__ = "resource_assignment_spreads"
    __table_args__ = (
        UniqueConstraint("resource_assignment_id", "work_date", name="uq_resource_assignment_spreads_assignment_date"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    resource_assignment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resource_assignments.id", ondelete="CASCADE"), nullable=False
    )
    work_date: Mapped[date] = mapped_column(Date, nullable=False)
    hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)
