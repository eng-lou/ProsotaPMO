from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.element_parent import ElementParent
from app.schemas.element_parent import ElementParentCreate, ElementParentResponse


# Walk the *new* parent's own ancestry chain looking for the child itself
# (2026-07-12) — same walk-up-the-chain shape as app/services/collection.py's
# own _validate_no_cycle for Collection's parent_collection_id, copied
# rather than shared cross-module per that function's own precedent
# (unrelated domains that happen to need the identical check). A cycle here
# would mean two rigged parts endlessly parenting each other, which the
# frontend's reparent-resolution effect would recurse on forever.
def _validate_no_cycle(by_child: dict[str, ElementParent], child_ref: str, new_parent_ref: str) -> None:
    cursor: str | None = new_parent_ref
    seen: set[str] = set()
    while cursor is not None:
        if cursor == child_ref:
            raise HTTPException(status_code=422, detail="Cannot set parent: would create a rigging cycle")
        if cursor in seen:
            break  # already-inconsistent data — don't loop forever
        seen.add(cursor)
        parent_row = by_child.get(cursor)
        cursor = parent_row.parent_element_ref if parent_row else None


async def list_element_parents(db: AsyncSession, project_id: uuid.UUID) -> list[ElementParentResponse]:
    rows = (await db.execute(
        select(ElementParent).where(ElementParent.project_id == project_id).order_by(ElementParent.created_at)
    )).scalars().all()
    return [ElementParentResponse.model_validate(r) for r in rows]


# Upsert, not plain create (2026-07-12) — re-parenting a child re-points its
# existing row rather than adding a second, conflicting parent, matching
# PathFollower's own upsert_path_follower pattern exactly (see that
# function's own docstring on why: "drag a different curve onto the
# constraint moves the binding, it doesn't add a second one").
async def upsert_element_parent(db: AsyncSession, data: ElementParentCreate) -> ElementParentResponse:
    if data.child_element_ref == data.parent_element_ref:
        raise HTTPException(status_code=422, detail="An element cannot be parented to itself")

    all_rows = (await db.execute(
        select(ElementParent).where(ElementParent.project_id == data.project_id)
    )).scalars().all()
    by_child = {r.child_element_ref: r for r in all_rows}
    _validate_no_cycle(by_child, data.child_element_ref, data.parent_element_ref)

    existing = by_child.get(data.child_element_ref)
    if existing is not None:
        existing.parent_element_ref = data.parent_element_ref
        await db.commit()
        await db.refresh(existing)
        return ElementParentResponse.model_validate(existing)

    row = ElementParent(**data.model_dump())
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This element is already rigged to a parent")
    await db.refresh(row)
    return ElementParentResponse.model_validate(row)


async def delete_element_parent(db: AsyncSession, element_parent_id: uuid.UUID) -> None:
    row = await db.get(ElementParent, element_parent_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Rig relationship not found")
    await db.delete(row)
    await db.commit()
