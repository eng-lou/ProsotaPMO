from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ActivityStep(Base, TimestampMixin):
    """Ordered activity checklist with optional reusable operational definition.

    Simulator scenarios copy operation into isolated methods. Updating the
    reusable definition is explicit and does not change programme dates or
    mark a checklist step complete. sort_order retains the existing checklist
    move-step behaviour.
    """

    __tablename__ = "activity_steps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    is_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    operation: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
