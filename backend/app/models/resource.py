from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Resource(Base, TimestampMixin):
    """A reusable, project-scoped resource pool entry — a named person/crew, plant
    item, material, or subcontractor that can be assigned to activities (see
    ResourceAssignment). No calendar of its own — per Maro's confirmed spec
    (docs/RESOURCES_MODULE_PLAN.md), a resource runs on whichever calendar(s) its
    assigned activities already use.
    """

    __tablename__ = "resources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    # labour | equipment | material | subcontractor — determines both what rate/unit
    # mean and how an assignment's budget is costed (see
    # app/services/resource_costing.py):
    #   labour/equipment: rate is a day rate; unit is always "day" (frontend-enforced,
    #     not a free-choice field for these types).
    #   material: rate is per whatever `unit` is (e.g. "m3", "nr") — the original
    #     Qty x Unit x Rate build-up, freely editable.
    #   subcontractor: rate IS the flat lump sum; unit is always "lump sum".
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    # This resource's normal full-time daily capacity in hours (e.g. 8) — only
    # meaningful for labour/equipment. Informational/capacity context, not itself a
    # multiplier in the cost formula (an assignment's utilisation_pct already
    # expresses "how much of this resource's day," so rate is priced per full day
    # regardless of what max_hours_per_day happens to be).
    max_hours_per_day: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=8)
