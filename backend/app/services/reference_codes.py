from __future__ import annotations

import uuid

from sqlalchemy import ColumnElement, Integer, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Base


async def _current_max_seq(
    db: AsyncSession, model: type[Base], project_id: uuid.UUID, extra_filter: ColumnElement[bool] | None = None,
) -> int:
    stmt = select(func.max(cast(func.split_part(model.code, "-", 2), Integer))).where(
        model.project_id == project_id
    )
    if extra_filter is not None:
        stmt = stmt.where(extra_filter)
    return (await db.execute(stmt)).scalar() or 0


async def next_code(
    db: AsyncSession,
    model: type[Base],
    prefix: str,
    project_id: uuid.UUID,
    extra_filter: ColumnElement[bool] | None = None,
) -> str:
    """Generate the next sequential human-readable code for a record type, scoped to a
    project (and, for discriminated tables like icd_items, a sub-type via extra_filter).

    Codes are never reused, even after deletes — the next number is always
    max(existing) + 1, not count(existing) + 1.
    """
    next_seq = await _current_max_seq(db, model, project_id, extra_filter) + 1
    return f"{prefix}-{next_seq:04d}"


async def next_codes_batch(
    db: AsyncSession,
    model: type[Base],
    prefix: str,
    project_id: uuid.UUID,
    count: int,
    extra_filter: ColumnElement[bool] | None = None,
) -> list[str]:
    """Same numbering as next_code, but for generating `count` codes at once
    (bulk-generate flows) — one aggregate query for the starting number,
    then a plain Python increment per row, instead of one aggregate query
    (plus the autoflush it forces on every SQLAlchemy select()) per row.
    Real-world impact confirmed at schedule-generation scale: a few-hundred-
    row generation was doing a few hundred serialized round-trips just for
    code numbering, before the actual insert/CPM work even started."""
    if count <= 0:
        return []
    start_seq = await _current_max_seq(db, model, project_id, extra_filter) + 1
    return [f"{prefix}-{seq:04d}" for seq in range(start_seq, start_seq + count)]
