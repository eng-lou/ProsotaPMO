from __future__ import annotations

import uuid
from datetime import date as date_type

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.cost_element import CostElement
from app.models.icd_item import IcdItem
from app.models.reassessment import Reassessment
from app.models.risk import Risk
from app.schemas.reassessment import ReassessmentCreate, ReassessmentUpdate
from app.services.period_guard import require_live_period

# Registry of every parent type allowed to carry a reassessment log. Each
# parent model has a `last_reviewed_date` (auto-bumped on every new entry)
# plus a freeze check — risk/icd_item/cost_element still key off the shared
# Period table via `period_id`; activity moved onto its own SchedulePeriod in
# the schedule-variants split (docs/SCHEDULE_VARIANTS_PLAN.md), so it's
# checked separately below rather than through the generic period_id lookup.
_PARENT_MODELS: dict[str, type] = {
    "risk": Risk,
    "icd_item": IcdItem,
    "cost_element": CostElement,
    "activity": Activity,
}


async def _get_parent(db: AsyncSession, record_type: str, record_id: uuid.UUID):
    model = _PARENT_MODELS.get(record_type)
    if model is None:
        raise HTTPException(status_code=422, detail=f"Unknown record_type '{record_type}'")
    parent = await db.get(model, record_id)
    if parent is None:
        raise HTTPException(status_code=404, detail=f"{record_type} not found")
    return parent


async def _require_parent_live(db: AsyncSession, record_type: str, parent) -> None:
    if record_type == "activity":
        # Local import: avoids a module-load-time circular import between
        # activity.py (imports create_reassessment for archive_activity's own
        # audit entry) and this module.
        from app.services.activity import _require_live_schedule_period

        await _require_live_schedule_period(db, parent.schedule_period_id)
    else:
        await require_live_period(db, parent.period_id)


async def list_reassessments(db: AsyncSession, record_type: str, record_id: uuid.UUID) -> list[Reassessment]:
    result = await db.execute(
        select(Reassessment)
        .where(Reassessment.record_type == record_type, Reassessment.record_id == record_id)
        .order_by(Reassessment.reviewed_at.desc())
    )
    return list(result.scalars().all())


async def get_reassessment(db: AsyncSession, reassessment_id: uuid.UUID) -> Reassessment:
    entry = await db.get(Reassessment, reassessment_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Reassessment not found")
    return entry


async def create_reassessment(db: AsyncSession, data: ReassessmentCreate) -> Reassessment:
    """Logging a reassessment is itself a review event, so it also bumps the
    parent's last_reviewed_date — per PMBOK7/Rita Mulcahy's Monitor Risks/Costs
    concept of ongoing reassessment, distinct from a one-off narrative field."""
    parent = await _get_parent(db, data.record_type, data.record_id)
    await _require_parent_live(db, data.record_type, parent)

    entry = Reassessment(record_type=data.record_type, record_id=data.record_id, note=data.note)
    db.add(entry)
    parent.last_reviewed_date = date_type.today()
    await db.commit()
    await db.refresh(entry)
    return entry


async def update_reassessment(
    db: AsyncSession, reassessment_id: uuid.UUID, data: ReassessmentUpdate
) -> Reassessment:
    entry = await get_reassessment(db, reassessment_id)
    parent = await _get_parent(db, entry.record_type, entry.record_id)
    await _require_parent_live(db, entry.record_type, parent)
    entry.note = data.note
    await db.commit()
    await db.refresh(entry)
    return entry


async def delete_reassessment(db: AsyncSession, reassessment_id: uuid.UUID) -> None:
    entry = await get_reassessment(db, reassessment_id)
    parent = await _get_parent(db, entry.record_type, entry.record_id)
    await _require_parent_live(db, entry.record_type, parent)
    await db.delete(entry)
    await db.commit()
