from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ProgressVarianceTest(Base, TimestampMixin):
    """Detects when the 4D schedule says an element is complete but a real
    site scan shows otherwise (2026-08-20, per Maro's own correction to the
    original ask — see the approved plan, "Reality Captures: textured
    overlay + a precision point-cloud progress-variance engine": "an
    intelligent layer can detect the variance, completion metrics etc",
    not a visual overlay/side-by-side).

    Mirrors ClashTest's own shape as closely as the domain allows (see
    that model's own docstring) — group_a_collection_id reuses the exact
    same Collection-as-selection-set machinery Clash Detective's Group A
    already relies on: whatever elements the frontend's own 4D animation
    currently shows as visible/complete at the scrubbed timeline date.
    There's no Group B collection here, unlike ClashTest — the "other
    side" of this test is site_capture_id's own point cloud, not a second
    set of BIM elements, so the geometric test itself is asymmetric
    (element-bounding-volume vs. point-density, not mesh-vs-mesh).

    Same "test definition + last-run results persist here, but the actual
    density query runs client-side against the currently-loaded point
    cloud" split as Clash Detective — this table exists to persist the
    test's own configuration and its last run's results
    (ProgressVarianceResult), not to compute anything server-side."""

    __tablename__ = "progress_variance_tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="Progress Variance Test")
    group_a_collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False, index=True
    )
    site_capture_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("site_captures.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The one genuinely-needs-real-data-to-tune number in this whole
    # feature (see the plan's own "Live-tune the density threshold against
    # Maro's real data — treat this as expected, not a fallback plan").
    # Stored per-test, not an ephemeral client-side param that resets on
    # every "Run Test" click, so a test's own calibration is remembered
    # and reproducible across re-runs the same way tolerance_mm already is
    # for ClashTest (clash_test.py) — the frontend's own density-query
    # engine (progressVarianceEngine.ts) reads this straight off the test.
    #
    # PROSOTA PATCH (2026-08-21) — was min_points_threshold: int, a raw
    # scan-point count inside an element's whole bounding box. Replaced
    # with a % of the element's own sampled surface actually confirmed by
    # the scan (surfaceSampling.ts + PointCloudIndex.hasPointNear) — a
    # point count couldn't distinguish "10% poured" from "90% poured,"
    # which is exactly the "built but not complete" case Progress Variance
    # needs to answer.
    min_coverage_percent: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
