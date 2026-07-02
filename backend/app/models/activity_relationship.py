from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ActivityRelationship(Base, TimestampMixin):
    """A predecessor -> successor logic link. Per PMBOK7/Rita Mulcahy Ch. 8: the four
    relationship types are FS (finish-to-start, the default/most common), SS, FF, SF.
    lag_hours is signed — positive is a lag (wait), negative is a lead (overlap).
    Hours rather than days since Phase 10 (hour-level CPM, 2026-07-02) — see
    docs/SCHEDULING_MODULE_PLAN.md Phase 3 and Phase 10.
    """

    __tablename__ = "activity_relationships"
    __table_args__ = (
        UniqueConstraint("predecessor_id", "successor_id", name="uq_activity_relationship_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    predecessor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    successor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    relationship_type: Mapped[str] = mapped_column(String(2), nullable=False, default="FS")
    lag_hours: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False, default=0)
