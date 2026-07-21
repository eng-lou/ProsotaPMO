from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class IcdActionItem(Base, TimestampMixin):
    """A single tracked action against an issue/change/decision (e.g. "ACT-01 ·
    Confirm diversion route with utility"), with its own owner, due date,
    status, and progress — reuses the Risk module's RiskMitigationAction
    pattern (see docs/ICD_MODULE_PLAN.md Phase 4). Code is sequential per ICD
    item (ACT-01, ACT-02...), not per project."""

    __tablename__ = "icd_action_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    icd_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("icd_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="not_started")
    pct_complete: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
