from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ProgressVarianceResult(Base, TimestampMixin):
    """One Group A element's outcome from a ProgressVarianceTest run
    (2026-08-20). Single-sided, unlike ClashResult's element_a/element_b
    pair — this table records one BIM element vs. the test's own
    site_capture point cloud, not a pair of BIM elements. point_count is
    the density-query's own point count for that element's bounding
    volume, capped at the frontend engine's own query limit (see
    pointCloud.ts's PointCloudIndex.countPointsInBox — a coarse presence
    check, not an exact count, kept as a secondary diagnostic).
    coverage_percent (2026-08-21, PROSOTA PATCH) is the real signal: what
    % of the element's own sampled surface (surfaceSampling.ts) has real
    scan matter within PointCloudIndex.hasPointNear's own radius —
    distinguishes "10% poured" from "90% poured," which point_count alone
    never could. confirmed_in_scan is coverage_percent compared against
    whatever threshold the engine currently uses — flagged here as its
    own boolean, not re-derived from coverage_percent at read time, so a
    later threshold change doesn't retroactively reinterpret a previous
    run's own results.

    Bulk-replaced via PUT /api/v1/progress-variance-tests/{id}/results on
    every "Run Test", same matching-by-element_ref-keeps-status/comment
    convention as ClashResult's own replace_results (see that model's own
    docstring) — a re-run shouldn't reset review work already done on an
    element that's still in Group A."""

    __tablename__ = "progress_variance_results"
    __table_args__ = (
        UniqueConstraint("progress_variance_test_id", "element_ref", name="uq_progress_variance_results_element"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    progress_variance_test_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("progress_variance_tests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    element_source_kind: Mapped[str] = mapped_column(String(10), nullable=False)  # "ifc" | "mesh"
    element_ref: Mapped[str] = mapped_column(String(300), nullable=False)
    element_label: Mapped[str] = mapped_column(String(300), nullable=False)
    point_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    coverage_percent: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confirmed_in_scan: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="new")  # "new" | "reviewed" | "approved"
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
