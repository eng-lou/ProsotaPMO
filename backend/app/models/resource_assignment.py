from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ResourceAssignment(Base, TimestampMixin):
    """Assigns a Resource to an Activity. budget is deliberately NOT stored —
    always computed at read time from the linked resource + activity (see
    app/services/resource_costing.py) — same "never store what you can derive"
    discipline as everywhere else in this codebase. This is the source of truth an
    activity's linked Cost Element is synced from (app/services/cost_sync.py).

    Which of quantity/utilisation_pct is used depends on the resource's type:
      labour/equipment: utilisation_pct (0-100) — how much of the resource's day is
        spent on this activity; budget = activity.duration_days x utilisation_pct/100
        x resource.rate. Cost follows the schedule automatically as duration changes.
        planned_hours, when set, overrides this entirely (see its own docstring).
      material: quantity — the original Qty x Rate build-up (e.g. 267 piles).
      subcontractor: neither — budget is always resource.rate flat (a lump sum
        doesn't scale with duration or utilisation).
    """

    __tablename__ = "resource_assignments"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # No ondelete cascade here, deliberately — deleting a Resource that's still
    # assigned somewhere is blocked at the service layer (app/services/resource.py)
    # rather than silently cascading away cost data; the FK's default RESTRICT
    # behaviour is a backstop against any code path that bypasses that check.
    resource_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("resources.id"), nullable=False, index=True
    )
    # Free text, matching the prototype's "Role" column (e.g. "Site Engineer") —
    # independent of the resource's own name, since the same named resource could
    # conceivably serve a different role on a different assignment.
    role: Mapped[str | None] = mapped_column(String(255))
    quantity: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # Numeric(9, 6), not (5, 2) — a P6 import derives this from the file's own
    # exact planned_units/duration_hours ratio (p6_import.py), which is
    # essentially never a round 2dp percentage (e.g. 840/1416 hours is
    # 59.322033...%, not 59.32%). Rounding to 2dp here fed straight into real
    # money once duration_days x utilisation_pct/100 x rate multiplied it back
    # out — a ~£3 BAC error on one activity alone (2026-09-05, per Maro:
    # "why are they different" comparing a Prosota BAC to P6's own report).
    # Same "don't round an intermediate that feeds real money" lesson as
    # resource_costing.py's own _exact_duration_days, just a different field.
    utilisation_pct: Mapped[Decimal | None] = mapped_column(Numeric(9, 6))
    # A P6-imported labour/equipment/crew assignment's own real PlannedUnits
    # (hours) — set only by a PMXML import (app/services/p6_import.py),
    # never by hand. When set, resource_costing.py's own compute_assignment_
    # budget_raw uses planned_hours/hours_per_day x rate directly instead of
    # duration_days x utilisation_pct/100 x rate — mathematically the exact
    # same formula (utilisation_pct is itself derived as planned_hours /
    # duration_hours x 100 at import time, so duration_hours cancels out
    # algebraically), but computed directly rather than round-tripping
    # through utilisation_pct's own necessarily-finite stored precision,
    # which broke that cancellation and leaked a real (if tiny) BAC error —
    # confirmed 2026-09-06 against a real P6 export where it flipped the
    # final penny of rounding on 2 of 132 real activities. Cleared back to
    # None the moment a user edits this assignment's utilisation_pct by
    # hand (app/services/resource_assignment.py) — the same "an explicit
    # edit unlinks it from the import" rule used everywhere else a P6-
    # sourced figure can be hand-overridden.
    planned_hours: Mapped[Decimal | None] = mapped_column(Numeric(14, 6))
