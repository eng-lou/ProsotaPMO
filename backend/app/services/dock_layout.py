from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dock_layout import DEFAULT_CONFIG, DockLayout
from app.schemas.dock_layout import DockLayoutConfig, DockLayoutCreate, DockLayoutResponse, DockLayoutUpdate


async def create_layout(db: AsyncSession, data: DockLayoutCreate) -> DockLayoutResponse:
    row = DockLayout(project_id=data.project_id, name=data.name, is_active=False, config=data.config.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DockLayoutResponse.model_validate(row)


async def list_layouts(db: AsyncSession, project_id: uuid.UUID) -> list[DockLayoutResponse]:
    rows = (await db.execute(
        select(DockLayout).where(DockLayout.project_id == project_id).order_by(DockLayout.created_at.desc())
    )).scalars().all()
    return [DockLayoutResponse.model_validate(r) for r in rows]


async def apply_layout(db: AsyncSession, layout_id: uuid.UUID) -> DockLayoutResponse:
    layout = (await db.execute(select(DockLayout).where(DockLayout.id == layout_id))).scalar_one()
    # At most one active layout per project — same pattern as
    # GanttLayout.is_active (app/services/gantt_layout.py).
    await db.execute(
        update(DockLayout).where(DockLayout.project_id == layout.project_id, DockLayout.id != layout.id).values(is_active=False)
    )
    layout.is_active = True
    await db.commit()
    await db.refresh(layout)
    return DockLayoutResponse.model_validate(layout)


async def update_layout(db: AsyncSession, layout_id: uuid.UUID, data: DockLayoutUpdate) -> DockLayoutResponse:
    layout = (await db.execute(select(DockLayout).where(DockLayout.id == layout_id))).scalar_one()
    layout.name = data.name
    layout.config = data.config.model_dump()
    await db.commit()
    await db.refresh(layout)
    return DockLayoutResponse.model_validate(layout)


async def delete_layout(db: AsyncSession, layout_id: uuid.UUID) -> None:
    layout = (await db.execute(select(DockLayout).where(DockLayout.id == layout_id))).scalar_one()
    await db.delete(layout)
    await db.commit()


async def reset_to_default(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Goes back to the built-in dock layout without deleting any saved
    ones — just clears is_active so get_active_config falls through to
    DEFAULT_CONFIG."""
    await db.execute(update(DockLayout).where(DockLayout.project_id == project_id).values(is_active=False))
    await db.commit()


async def get_active_config(db: AsyncSession, project_id: uuid.UUID) -> DockLayoutConfig:
    row = (await db.execute(
        select(DockLayout).where(DockLayout.project_id == project_id, DockLayout.is_active.is_(True))
    )).scalar_one_or_none()
    if row is None:
        return DockLayoutConfig(**DEFAULT_CONFIG)
    return DockLayoutConfig(**row.config)
