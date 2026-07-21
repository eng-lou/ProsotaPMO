from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import Date, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class RiskMitigationAction(Base, TimestampMixin):
    """A single tracked action within a risk's response plan (e.g. "MA-01 · Dual-
    source supplier"), with its own owner, due date, status, and progress —
    matches the prototype's Mitigation & Response tab. Code is sequential per
    risk (MA-01, MA-02...), not per project."""

    __tablename__ = "risk_mitigation_actions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    risk_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("risks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    owner: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="not_started")
    pct_complete: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
