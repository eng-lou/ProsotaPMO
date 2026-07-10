from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ActivityStep(Base, TimestampMixin):
    """P6's per-activity ordered checklist (docs/SCHEDULING_GAPS_PLAN.md Phase
    10) — name + boolean complete + manual ordering only; P6 additionally
    supports a weighted % complete and per-step start/end dates, deliberately
    left out for this first cut (extend only if asked, matching this plan's
    own "ship the field, extend later" pattern). sort_order is reordered via
    app/services/activity_step.py:move_step, the same up/down-swap-with-
    neighbour pattern as app/services/activity.py:move_activity, not free
    drag-and-drop."""

    __tablename__ = "activity_steps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
