from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CostRateLine(Base, TimestampMixin):
    """A single Qty x Unit x Rate build-up row within a cost element's Rate Card
    (e.g. "CFA piles to 8.5m x267 @ £576/nr"), matching the prototype's Budget &
    Versions tab. Total is computed at query time (qty x rate), never stored."""

    __tablename__ = "cost_rate_lines"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cost_element_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cost_elements.id", ondelete="CASCADE"), nullable=False
    )
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(50))
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
