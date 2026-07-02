from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Activity(Base, TimestampMixin):
    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("project_id", "code", name="uq_activities_project_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    period_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("periods.id"), nullable=False)
    task_name: Mapped[str] = mapped_column(String(500), nullable=False)
    # task | milestone | wbs_summary. Milestones always have zero duration; wbs_summary
    # rows roll up from children once the WBS hierarchy exists (Phase 2) — see
    # docs/SCHEDULING_MODULE_PLAN.md.
    activity_type: Mapped[str] = mapped_column(String(20), nullable=False, default="task")
    wbs_path: Mapped[str | None] = mapped_column(String(500))
    duration_days: Mapped[int | None] = mapped_column(Integer)
    start: Mapped[date | None] = mapped_column(Date)
    finish: Mapped[date | None] = mapped_column(Date)
    actual_start: Mapped[date | None] = mapped_column(Date)
    actual_finish: Mapped[date | None] = mapped_column(Date)
    remaining_duration_days: Mapped[int | None] = mapped_column(Integer)
    # bl_start/bl_finish/variance_days/total_float/is_critical are never accepted as API
    # input (see app/services/activity.py:_apply_computed_fields) — same discipline as
    # Risk's EMV and Cost's CPI/SPI fixes. bl_start/bl_finish stay null until Phase 6's
    # dedicated "Set Baseline" action exists; total_float/is_critical stay null until
    # Phase 5's CPM engine exists, rather than holding a fake computed value early.
    bl_start: Mapped[date | None] = mapped_column(Date)
    bl_finish: Mapped[date | None] = mapped_column(Date)
    variance_days: Mapped[int | None] = mapped_column(Integer)
    pct_complete: Mapped[Decimal | None] = mapped_column(Numeric(5, 2))
    total_float: Mapped[int | None] = mapped_column(Integer)
    is_critical: Mapped[bool | None] = mapped_column(Boolean)
    commentary: Mapped[str | None] = mapped_column(Text)
