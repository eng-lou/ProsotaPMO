from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ActivityRelationship(Base, TimestampMixin):
    """A predecessor -> successor logic link. Per PMBOK7/Rita Mulcahy Ch. 8: the four
    relationship types are FS (finish-to-start, the default/most common), SS, FF, SF.
    lag_days is signed — positive is a lag (wait), negative is a lead (overlap). See
    docs/SCHEDULING_MODULE_PLAN.md Phase 3.
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
    lag_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
