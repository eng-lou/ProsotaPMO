from __future__ import annotations

import uuid

from sqlalchemy import Float, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ClashResult(Base, TimestampMixin):
    """One clashing pair from a ClashTest run (2026-07-12). element_a/b
    mirror CollectionMember's own (source_kind, element_ref, element_label)
    shape exactly — element_a is always drawn from the test's
    group_a_collection, element_b from group_b_collection, so ordering is
    natural except in the self-clash case (group_a == group_b), where the
    frontend canonicalizes each pair by sorting the two refs before
    submitting, so repeated runs match the same existing row instead of
    duplicating it under the swapped order.

    Bulk-replaced via PUT /api/v1/clash-tests/{id}/results on every "Run
    Test" (app/services/clash_result.py's replace_results) — deliberately
    NOT a plain delete-then-insert: a row that still matches the same
    (element_a_ref, element_b_ref) pair keeps its existing status/comment,
    matching Navisworks' own behaviour where re-running a test doesn't
    reset the clashes you already reviewed. distance_mm is nullable
    because a "hard" test only ever confirms penetration (no distance is
    reported by three-mesh-bvh's own intersectsGeometry, only a boolean);
    it's populated for "clearance" tests, which do return a measured gap."""

    __tablename__ = "clash_results"
    __table_args__ = (
        UniqueConstraint("clash_test_id", "element_a_ref", "element_b_ref", name="uq_clash_results_test_pair"),
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
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
