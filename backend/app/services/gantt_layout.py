from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.gantt_layout import DEFAULT_STYLE, GanttLayout
from app.models.project_letterhead import ProjectLetterhead
from app.schemas.gantt_layout import GanttLayoutCreate, GanttLayoutResponse, GanttLayoutUpdate, GanttStyle
from app.schemas.project_letterhead import ProjectLetterheadUpsert
from app.services import project_letterhead as letterhead_svc


async def create_layout(db: AsyncSession, data: GanttLayoutCreate) -> GanttLayoutResponse:
    # Snapshots the project's current live letterhead — "the letterhead
    # settings also get saved in the layout" (Maro). Doesn't touch is_active;
    # applying is the separate, deliberate action below.
    current_letterhead = await letterhead_svc.get_or_default(db, data.project_id)
    row = GanttLayout(
        project_id=data.project_id,
        name=data.name,
        is_active=False,
        style=data.style.model_dump(),
        letterhead_snapshot=current_letterhead.model_dump(mode="json", exclude={"id", "created_at", "updated_at"}),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return GanttLayoutResponse.model_validate(row)


async def list_layouts(db: AsyncSession, project_id: uuid.UUID) -> list[GanttLayoutResponse]:
    rows = (await db.execute(
        select(GanttLayout).where(GanttLayout.project_id == project_id).order_by(GanttLayout.created_at.desc())
    )).scalars().all()
    return [GanttLayoutResponse.model_validate(r) for r in rows]


async def apply_layout(db: AsyncSession, layout_id: uuid.UUID) -> GanttLayoutResponse:
    layout = (await db.execute(select(GanttLayout).where(GanttLayout.id == layout_id))).scalar_one()

    # At most one active layout per project — same pattern as
    # ScheduleBaseline.is_active (app/services/schedule_baseline.py).
    await db.execute(
        update(GanttLayout).where(GanttLayout.project_id == layout.project_id, GanttLayout.id != layout.id).values(is_active=False)
    )
    layout.is_active = True

    snapshot = layout.letterhead_snapshot
    await letterhead_svc.upsert(db, ProjectLetterheadUpsert(
        project_id=layout.project_id,
        logo_data_url=snapshot.get("logo_data_url"),
        logo_position=snapshot.get("logo_position", "left"),
        header_left=snapshot.get("header_left", {}),
        header_center=snapshot.get("header_center", {}),
        header_right=snapshot.get("header_right", {}),
        footer_left=snapshot.get("footer_left", {}),
        footer_center=snapshot.get("footer_center", {}),
        footer_right=snapshot.get("footer_right", {}),
        show_gantt_legend=snapshot.get("show_gantt_legend", False),
    ))

    await db.commit()
    await db.refresh(layout)
    return GanttLayoutResponse.model_validate(layout)


async def delete_layout(db: AsyncSession, layout_id: uuid.UUID) -> None:
    layout = (await db.execute(select(GanttLayout).where(GanttLayout.id == layout_id))).scalar_one()
    await db.delete(layout)
    await db.commit()


async def update_layout(db: AsyncSession, layout_id: uuid.UUID, data: GanttLayoutUpdate) -> GanttLayoutResponse:
    layout = (await db.execute(select(GanttLayout).where(GanttLayout.id == layout_id))).scalar_one()
    layout.name = data.name
    layout.style = data.style.model_dump()
    # Refreshed to the current live letterhead, same as create — an edit is
    # "save this layout again with today's settings," not just a style tweak.
    # If this layout happens to be the active one, its style takes effect
    # immediately (get_active_style reads the row directly); the letterhead
    # snapshot itself is not re-pushed live here since it was just captured
    # from that same live state.
    current_letterhead = await letterhead_svc.get_or_default(db, layout.project_id)
    layout.letterhead_snapshot = current_letterhead.model_dump(mode="json", exclude={"id", "created_at", "updated_at"})
    await db.commit()
    await db.refresh(layout)
    return GanttLayoutResponse.model_validate(layout)


async def reset_to_default(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Goes back to the built-in look without deleting any saved layouts —
    clears is_active (so get_active_style falls through to DEFAULT_STYLE) and
    removes the live ProjectLetterhead row (so it falls through to its own
    hardcoded default — see app/services/project_letterhead.py)."""
    await db.execute(update(GanttLayout).where(GanttLayout.project_id == project_id).values(is_active=False))
    row = (await db.execute(select(ProjectLetterhead).where(ProjectLetterhead.project_id == project_id))).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
    await db.commit()


async def get_active_style(db: AsyncSession, project_id: uuid.UUID) -> GanttStyle:
    row = (await db.execute(
        select(GanttLayout).where(GanttLayout.project_id == project_id, GanttLayout.is_active.is_(True))
    )).scalar_one_or_none()
    if row is None:
        return GanttStyle(**DEFAULT_STYLE)
    return GanttStyle(**row.style)
