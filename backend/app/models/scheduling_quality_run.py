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
    period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("periods.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    report: Mapped[dict] = mapped_column(JSONB, nullable=False)
