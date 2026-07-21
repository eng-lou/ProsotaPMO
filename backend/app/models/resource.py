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
    ResourceAssignment).

    calendar_id (2026-07-07, per Maro — docs/SCHEDULING_GAPS_PLAN.md Phase 2)
    reverses the original "no calendar of its own" spec in
    docs/RESOURCES_MODULE_PLAN.md: a resource can now optionally carry its own
    calendar (e.g. a subcontractor crew that works a different pattern than
    the activities it's assigned to). Storage + display only for now — the
    CPM engine still schedules purely off each *activity's* own calendar;
    nothing yet reads a resource's calendar for actual scheduling/levelling
    (that's future work, once Resource levelling itself gets built).
    """

    __tablename__ = "resources"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # labour | equipment | material | subcontractor | cost | crew — determines both
    # what rate/unit mean and how an assignment's budget is costed (see
    # app/services/resource_costing.py):
    #   labour/equipment/crew: rate is a day rate; unit is always "day" (frontend-
    #     enforced, not a free-choice field for these types). crew occupies an
    #     activity's time the same way labour/equipment does (2026-07-08, per Maro).
    #   material: rate is per whatever `unit` is (e.g. "m3", "nr") — the original
    #     Qty x Unit x Rate build-up, freely editable.
    #   subcontractor/cost: rate IS the flat lump sum; unit is always "lump sum".
    #     cost (2026-07-08, per Maro) covers non-work-driven costs (fees, permits,
    #     prelims) — cost_type below is informational only, not a formula input yet.
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Optional default/primary role for this resource (e.g. "Trades",
    # "Foreman") — same free-text shape as ResourceAssignment.role, just at
    # the resource level rather than per-assignment; a specific assignment's
    # own role can still differ (2026-07-07, per Maro — drives the Resource
    # Usage Profile's own Role column).
    role: Mapped[str | None] = mapped_column(String(255))
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    rate: Mapped[Decimal] = mapped_column(Numeric(14, 2), nullable=False)
    # This resource's normal full-time daily capacity in hours (e.g. 8) — only
    # meaningful for labour/equipment. Informational/capacity context, not itself a
    # multiplier in the cost formula (an assignment's utilisation_pct already
    # expresses "how much of this resource's day," so rate is priced per full day
    # regardless of what max_hours_per_day happens to be).
    max_hours_per_day: Mapped[Decimal] = mapped_column(Numeric(4, 2), nullable=False, default=8)
    # Null = no calendar of its own (the original, still-valid default) — see
    # the class docstring above. SET NULL on delete, same reasoning as
    # Activity.calendar_id: removing a custom calendar shouldn't block the
    # delete or leave a dangling reference.
    calendar_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("calendars.id", ondelete="SET NULL"), index=True
    )
    # Classification fields (2026-07-08, per Maro, scoped down from a much larger
    # external schema proposal — see docs/ or project memory for the full
    # discussion). Free text, no backend-configurable lookup-table system — same
    # simple shape as `role` above. Each is shown/used per resource_type by the
    # frontend form only; none of them feed resource_costing.py's budget formula.
    discipline: Mapped[str | None] = mapped_column(String(255))
    company: Mapped[str | None] = mapped_column(String(255))
    skill_level: Mapped[str | None] = mapped_column(String(100))
    category: Mapped[str | None] = mapped_column(String(100))
    # "fixed" | "recurring" — cost resources only, informational only this pass
    # (both price as a flat lump sum, see resource_type comment above).
    cost_type: Mapped[str | None] = mapped_column(String(20))
    members: Mapped[str | None] = mapped_column(String(1000))
