from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class ActivityCodeHistory(Base, TimestampMixin):
    """Append-only audit trail of every code change on an activity — auto-logged,
    never user-prompted (unlike the reassessments log, which asks "why did this
    change"; a code change has an obvious mechanical cause, not a judgement call
    needing narration). 2026-07-04, per Maro: promoting/demoting an activity
    (indent/outdent) now auto-renumbers its code to match its new role
    (T-/W-/P-/M- — see app/services/activity.py:_activity_role), and a code that
    changed while the activity was part of a saved baseline needs a clear
    "what was it before, what is it now" trail for audit/traceability — this
    table is that trail. created_at (from TimestampMixin) is the change
    timestamp; these rows are never updated after insert.
    """

    __tablename__ = "activity_code_history"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    activity_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("activities.id", ondelete="CASCADE"), nullable=False
    )
    old_code: Mapped[str | None] = mapped_column(String(20))
    new_code: Mapped[str] = mapped_column(String(20), nullable=False)
    # promoted_to_wbs | demoted_to_task | wbs_reparented (P<->W, top-level status
    # changed but still a WBS summary either way) | manual_edit
    reason: Mapped[str] = mapped_column(String(30), nullable=False)
