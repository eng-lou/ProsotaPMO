from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class CostCommitment(Base, TimestampMixin):
    """An open purchase-order-level commitment against a cost element (e.g.
    "PO-PIL-001 · Huber piling · £118,000"), matching the prototype's Actuals &
    Commitments tab. Feeds the "Total Commitments" figure shown alongside EVM."""

    __tablename__ = "cost_commitments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    cost_element_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cost_elements.id", ondelete="CASCADE"), nullable=False, index=True
    )
    po_reference: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
