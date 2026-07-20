from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.icd_item import IcdItem
from app.models.period import Period
from app.models.record_link import RecordLink
from app.schemas.icd_bulk_generate import IcdBulkGenerateRequest, IcdBulkGenerateResponse
from app.services.reference_codes import next_code

_CODE_PREFIXES = {"issue": "ISS", "change": "CHA", "decision": "DEC"}


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def _reconcile_links(db: AsyncSession, item_type: str, item_id: uuid.UUID, activity_ids: set[uuid.UUID]) -> bool:
    """Makes this item's own "impacts" links onto activities match
    activity_ids exactly — deletes links to activities no longer in the set,
    adds links for newly-included ones, leaves the rest untouched. Returns
    whether anything actually changed, so the caller can tell a genuine
    rescan-driven update apart from a no-op re-run."""
    existing = (await db.execute(
        select(RecordLink).where(RecordLink.source_type == item_type, RecordLink.source_id == item_id, RecordLink.target_type == "activity")
    )).scalars().all()
    existing_by_activity = {link.target_id: link for link in existing}

    changed = False
    for activity_id, link in existing_by_activity.items():
        if activity_id not in activity_ids:
            await db.delete(link)
            changed = True

    for activity_id in activity_ids:
        if activity_id not in existing_by_activity:
            db.add(RecordLink(
                source_type=item_type, source_id=item_id, target_type="activity", target_id=activity_id,
                link_type="impacts",
            ))
            changed = True

    return changed


async def bulk_generate(db: AsyncSession, data: IcdBulkGenerateRequest) -> IcdBulkGenerateResponse:
    """Generates (first run) or rescans (later runs) the Decision/Issue/Change
    watch-flag catalog for every discipline actually present in the schedule
    — see frontend/src/modules/icd/icdGeneration.ts's own header for the
    catalog itself. Matched by (project_id, item_type, title): a match only
    ever gets its required_by refreshed (Decisions only — an Issue/Change
    watch-flag has no real trigger date to refresh) and its record_links
    reconciled — status/decision_maker/ccb_decision/anything a human may
    already have filled in is never touched, same "don't clobber a human's
    own edits" rule risk_bulk_generate.py's dedupe already follows."""
    await _require_live_period(db, data.period_id)

    existing_result = await db.execute(
        select(IcdItem).where(
            IcdItem.project_id == data.project_id,
            IcdItem.title.in_({i.title for i in data.items}),
        )
    )
    existing_by_type_title = {(item.item_type, item.title): item for item in existing_result.scalars().all()}

    created_count = updated_count = 0
    item_ids: list[uuid.UUID] = []

    for d in data.items:
        existing = existing_by_type_title.get((d.item_type, d.title))
        if existing is None:
            code = await next_code(db, IcdItem, _CODE_PREFIXES[d.item_type], data.project_id, extra_filter=IcdItem.item_type == d.item_type)
            item = IcdItem(
                id=uuid.uuid4(), project_id=data.project_id, period_id=data.period_id, code=code,
                item_type=d.item_type, title=d.title, description=d.description, status="open",
                required_by=d.required_by,
            )
            db.add(item)
            await db.flush()
            await _reconcile_links(db, d.item_type, item.id, set(d.linked_activity_ids))
            created_count += 1
            item_ids.append(item.id)
        else:
            changed = existing.required_by != d.required_by
            existing.required_by = d.required_by
            links_changed = await _reconcile_links(db, d.item_type, existing.id, set(d.linked_activity_ids))
            if changed or links_changed:
                updated_count += 1
            item_ids.append(existing.id)

    await db.commit()
    return IcdBulkGenerateResponse(created_count=created_count, updated_count=updated_count, item_ids=item_ids)
