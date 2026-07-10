from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ScheduleVariant(Base, TimestampMixin):
    """A named, independently-operable schedule within a project (2026-07-07, per
    Maro — docs/SCHEDULE_VARIANTS_PLAN.md, private docs repo). Real projects run
    more than one programme at once for different reasons — a working schedule,
    a resource/cost-loaded one built for approval, a recovery/mitigation
    schedule, a risk-loaded one (see the QPRA plan, same private docs repo) — and
    exactly one of them is ever the project's actual master, going through the
    ordinary Period-based reporting/freeze lifecycle everything else in the app
    already assumes.

    `Risk`/`CostElement`/`IcdItem` never reference a `ScheduleVariant` at all —
    they stay tied to the project's own `Period` (unchanged) regardless of
    which variant is master. That's deliberate: it's what makes promoting a
    different variant to master a narrow, safe operation (flip `is_master`,
    re-link anything that pointed at the old master's activities — see
    app/services/schedule_variant.py:promote_variant) rather than a migration
    of the project's whole reporting history.
    """

    __tablename__ = "schedule_variants"

    # Exactly one master per project — same partial-unique-index pattern as
    # Period's own uq_periods_project_live.
    __table_args__ = (
        Index(
            "uq_schedule_variants_project_master",
            "project_id",
            unique=True,
            postgresql_where=text("is_master"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Free text (2026-07-07, per Maro) — a hint/label for the picker UI (e.g.
    # "recovery", "resource/cost loaded", "scenario"), never validated against a
    # fixed list and never driving different behaviour — purely descriptive.
    variant_type: Mapped[str | None] = mapped_column(String(100))
    is_master: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
