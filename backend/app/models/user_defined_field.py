from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import DateTime, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class UserDefinedFieldDefinition(Base, TimestampMixin):
    """A named custom field, project-scoped, for one entity kind at a time
    (2026-07-07, per Maro — P6's own "User Defined Fields" dialog:
    docs/SCHEDULING_GAPS_PLAN.md Phase 9). entity_type is "activity" |
    "resource" | "cost_element" for now — Risk/ICD could gain their own UDFs
    later the same way, not built ahead of that need.

    data_type is one of "text" | "number" | "integer" | "cost" |
    "start_date" | "finish_date" | "indicator" — which of
    UserDefinedFieldValue's four value_* columns actually gets populated for
    every value under this definition (indicator is a fixed 8-state
    icon/colour token, not free text — see UserDefinedFieldValue's own
    docstring)."""

    __tablename__ = "user_defined_field_definitions"
    __table_args__ = (
        UniqueConstraint("project_id", "entity_type", "name", name="uq_udf_definition_project_entity_name"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    entity_type: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    data_type: Mapped[str] = mapped_column(String(20), nullable=False)


class UserDefinedFieldValue(Base):
    """One record's value under one UserDefinedFieldDefinition. record_id is
    deliberately *not* a foreign key — it's polymorphic (an activity id, a
    resource id, or a cost_element id, depending on the parent definition's
    own entity_type), the same "stable reference, no FK" precedent
    ScheduleBaselineActivity/RecordLink already use for cross-table pointers
    that can't commit to a single parent table. Deleting the underlying
    activity/resource/cost_element does NOT cascade-delete its UDF values
    here (there's no FK to cascade through) — acceptable for this first cut,
    same "pre-production data" reasoning already applied elsewhere; a genuine
    cleanup-on-delete would need each of the three services to explicitly
    delete matching rows, not built ahead of that need.

    Four nullable value_* columns rather than one stringly-typed column, so
    numeric sort/filter and date-typed grid rendering stay real instead of
    string-parsed — which one is populated is implied by the parent
    definition's data_type: value_text (text), value_number (number/
    integer/cost), value_date (start_date/finish_date), value_indicator (one
    of "none"|"in_progress"|"delayed"|"at_risk"|"problem"|"paused"|
    "cancelled"|"completed" — the fixed 8-state icon set, per Maro's own P6
    reference screenshot, 2026-07-07)."""

    __tablename__ = "user_defined_field_values"
    __table_args__ = (
        UniqueConstraint("field_definition_id", "record_id", name="uq_udf_value_field_record"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    field_definition_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_defined_field_definitions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    record_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    value_text: Mapped[str | None] = mapped_column(String(500))
    value_number: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    value_date: Mapped[datetime | None] = mapped_column(DateTime)
    value_indicator: Mapped[str | None] = mapped_column(String(20))
