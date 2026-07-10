from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ScheduleSubproject(Base, TimestampMixin):
    """A PM-tagged WBS branch given its own scoped float calculation
    (2026-07-05, per Maro — docs/SUBPROJECT_FLOAT_PLAN.md in the private
    docs repo). The master CPM pass (app/services/scheduling_cpm.py) never
    changes — this is a *second*, additional lens: the same forward/backward
    algorithm re-run on just this branch's own internal activities/
    relationships, so a small package's activities can show their own real
    zero-slack chain instead of being drowned out by the whole programme's
    much longer timeline.

    root_wbs_id marks the branch (a wbs_summary Activity — enforced at the
    service layer, not the DB, same as other cross-table business rules in
    this codebase). Sub-projects can nest (one's root_wbs_id can sit inside
    another's own subtree) — deliberately not modelled with an explicit
    parent-subproject FK, since that nesting is already fully implied by the
    normal WBS hierarchy (wbs_path prefix containment) with no extra column
    needed.

    No milestone/finish-anchor field on purpose — the scoped pass's anchor
    is simply the latest-finishing activity within the branch, the same
    "anchor logic" the master pass already uses, just scoped down. Deleting
    this row un-tags the branch; its activities' sub_total_float_hours/
    sub_is_critical revert to null on the next recompute, but the branch's
    root WBS activity code (see app/services/activity.py's "SP-" role,
    Phase 2 of the plan) stays frozen rather than reverting, matching how
    an archived activity's code already stays frozen today."""

    __tablename__ = "schedule_subprojects"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Which external delivery party owns this package, if any — PM-assigned,
    # purely informational at this stage (no cascading to the branch's own
    # activities; deliberately deferred, see the plan doc's §G).
    owning_party_org_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organisations.id", ondelete="SET NULL"), nullable=True
    )
    root_wbs_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False)
