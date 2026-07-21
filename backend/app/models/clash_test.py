from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ClashTest(Base, TimestampMixin):
    """A Navisworks-style Clash Detective test (2026-07-12, per Maro): two
    Collections (app/models/collection.py) stand in for Navisworks'
    "Selection Set A"/"Selection Set B" — every selection-set resolution
    machinery Collections already have (GUID-based, survives reloads) is
    reused as-is rather than inventing a second selection concept.

    Geometry only ever exists in the browser in this app (IFC parsing is
    client-side WASM, see frontend/src/modules/fourD/ifcModel.ts) — this
    table and ClashResult exist purely to persist the test definition and
    its last-run results, not to compute anything server-side. "Running" a
    test is a frontend action (frontend/src/modules/fourD/sceneClash.ts)
    that reads whatever the viewport is currently showing — including
    whatever Mode A/B/C animation has applied for the current timeline
    position — then bulk-replaces this test's ClashResult rows via
    PUT /api/v1/clash-tests/{id}/results. There is deliberately no
    date-range/sweep concept here: scrubbing the timeline and re-running
    IS the 4D-awareness, for free, rather than a second engine.

    tolerance_mm only matters for test_type="clearance" (a "hard" test's
    tolerance is implicitly 0 — actual geometric penetration)."""

    __tablename__ = "clash_tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="Clash Test")
    group_a_collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    group_b_collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    test_type: Mapped[str] = mapped_column(String(10), nullable=False, default="hard")  # "hard" | "clearance"
    tolerance_mm: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
