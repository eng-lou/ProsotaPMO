from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class BaselineSet(Base, TimestampMixin):
    """A named, shared identifier linking one Risk/Cost/ICD/Schedule baseline
    together as "everything as it stood at X" (2026-07-20, per Maro — Controls
    Dashboard Phase 1b). Each module keeps its own independent baseline
    (RiskBaseline/CostBaseline/IcdBaseline/ScheduleBaseline, each capturable on
    its own cadence) — this table doesn't hold any snapshot data itself, it's
    purely the thing those four baselines' own nullable baseline_set_id
    columns point at. A set can exist with fewer than four linked baselines
    (module flexibility means a Cost baseline captured today doesn't force
    Risk/ICD/Schedule to be captured too), and a baseline can exist without
    ever joining a set at all — only "Capture All Now" links all four in one
    action; linking an already-existing standalone baseline in afterward is a
    separate, later action."""

    __tablename__ = "baseline_sets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    baseline_date: Mapped[date] = mapped_column(Date, nullable=False)
