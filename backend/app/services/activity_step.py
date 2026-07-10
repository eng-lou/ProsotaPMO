from __future__ import annotations

import uuid
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity_step import ActivityStep
from app.schemas.activity_step import ActivityStepCreate, ActivityStepUpdate


async def list_steps(db: AsyncSession, activity_id: uuid.UUID) -> list[ActivityStep]:
    result = await db.execute(
        select(ActivityStep).where(ActivityStep.activity_id == activity_id).order_by(ActivityStep.sort_order)
    )
    return list(result.scalars().all())


async def _next_sort_order(db: AsyncSession, activity_id: uuid.UUID) -> int:
    steps = await list_steps(db, activity_id)
    return steps[-1].sort_order + 1 if steps else 0


async def create_step(db: AsyncSession, data: ActivityStepCreate) -> ActivityStep:
    step = ActivityStep(
        activity_id=data.activity_id, name=data.name,
        sort_order=await _next_sort_order(db, data.activity_id),
    )
    db.add(step)
    await db.commit()
    await db.refresh(step)
    return step


async def _get_step(db: AsyncSession, step_id: uuid.UUID) -> ActivityStep:
    step = await db.get(ActivityStep, step_id)
    if step is None:
        raise HTTPException(status_code=404, detail="Activity step not found")
    return step


async def update_step(db: AsyncSession, step_id: uuid.UUID, data: ActivityStepUpdate) -> ActivityStep:
    step = await _get_step(db, step_id)
    if data.name is not None:
        step.name = data.name
    if data.is_complete is not None:
        step.is_complete = data.is_complete
    await db.commit()
    await db.refresh(step)
    return step


async def delete_step(db: AsyncSession, step_id: uuid.UUID) -> None:
    step = await _get_step(db, step_id)
    await db.delete(step)
    await db.commit()


async def move_step(db: AsyncSession, step_id: uuid.UUID, direction: Literal["up", "down"]) -> ActivityStep:
    """Same up/down-swap-with-neighbour reorder as
    app/services/activity.py:move_activity — manual ordering only, not free
    drag-and-drop (docs/SCHEDULING_GAPS_PLAN.md Phase 10). A no-op at either
    end of the list, not an error."""
    step = await _get_step(db, step_id)
    steps = await list_steps(db, step.activity_id)
    for index, s in enumerate(steps):
        s.sort_order = index

    current_index = next(i for i, s in enumerate(steps) if s.id == step.id)
    target_index = current_index - 1 if direction == "up" else current_index + 1
    if 0 <= target_index < len(steps):
        steps[current_index].sort_order, steps[target_index].sort_order = (
            steps[target_index].sort_order,
            steps[current_index].sort_order,
        )

    await db.commit()
    await db.refresh(step)
    return step
