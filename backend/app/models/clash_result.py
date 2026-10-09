from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ClashResult(Base, TimestampMixin):
    """A persistent clash identity with current review state, notes and linked issue.

    Verified runs resolve absent pairs only when both elements were checked;
    later reappearance reopens the same record. Legacy unqualified IFC GUIDs
    are upgraded only when their checked model identity is unambiguous.
    Model-qualified refs and source kinds keep separate models/import types
    distinct. Exact immutable geometry belongs to the corresponding ClashRun.
    """

    __tablename__ = "clash_results"
    __table_args__ = (
        UniqueConstraint("clash_test_id", "element_a_source_kind", "element_a_ref", "element_b_source_kind", "element_b_ref", name="uq_clash_results_test_pair"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    clash_test_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("clash_tests.id", ondelete="CASCADE"), nullable=False, index=True)
    element_a_source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    element_a_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    element_a_label: Mapped[str] = mapped_column(String(300), nullable=False)
    element_b_source_kind: Mapped[str] = mapped_column(String(10), nullable=False)
    element_b_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    element_b_label: Mapped[str] = mapped_column(String(300), nullable=False)
    distance_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new")  # "new" | "reviewed" | "approved"
    element_metadata: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")
    clash_point: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    review_history: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
    issue_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("icd_items.id", ondelete="SET NULL"), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
