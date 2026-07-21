from __future__ import annotations

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.dashboard_layout import DEFAULT_CONFIG, DashboardLayout
from app.schemas.dashboard_layout import DashboardLayoutConfig, DashboardLayoutCreate, DashboardLayoutResponse, DashboardLayoutUpdate


async def create_layout(db: AsyncSession, data: DashboardLayoutCreate) -> DashboardLayoutResponse:
    row = DashboardLayout(project_id=data.project_id, name=data.name, is_active=False, config=data.config.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return DashboardLayoutResponse.model_validate(row)


async def list_layouts(db: AsyncSession, project_id: uuid.UUID) -> list[DashboardLayoutResponse]:
    rows = (await db.execute(
        select(DashboardLayout).where(DashboardLayout.project_id == project_id).order_by(DashboardLayout.created_at.desc())
    )).scalars().all()
    return [DashboardLayoutResponse.model_validate(r) for r in rows]


async def apply_layout(db: AsyncSession, layout_id: uuid.UUID) -> DashboardLayoutResponse:
    layout = (await db.execute(select(DashboardLayout).where(DashboardLayout.id == layout_id))).scalar_one()
    await db.execute(
        update(DashboardLayout).where(DashboardLayout.project_id == layout.project_id, DashboardLayout.id != layout.id).values(is_active=False)
    )
    layout.is_active = True
    await db.commit()
    await db.refresh(layout)
    return DashboardLayoutResponse.model_validate(layout)


async def update_layout(db: AsyncSession, layout_id: uuid.UUID, data: DashboardLayoutUpdate) -> DashboardLayoutResponse:
    layout = (await db.execute(select(DashboardLayout).where(DashboardLayout.id == layout_id))).scalar_one()
    layout.name = data.name
    layout.config = data.config.model_dump()
    await db.commit()
    await db.refresh(layout)
    return DashboardLayoutResponse.model_validate(layout)


async def delete_layout(db: AsyncSession, layout_id: uuid.UUID) -> None:
    layout = (await db.execute(select(DashboardLayout).where(DashboardLayout.id == layout_id))).scalar_one()
    await db.delete(layout)
    await db.commit()


async def reset_to_default(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Goes back to the built-in dashboard layout without deleting any saved
    ones — just clears is_active so get_active_config falls through to
    DEFAULT_CONFIG."""
    await db.execute(update(DashboardLayout).where(DashboardLayout.project_id == project_id).values(is_active=False))
    await db.commit()


async def get_active_config(db: AsyncSession, project_id: uuid.UUID) -> DashboardLayoutConfig:
    row = (await db.execute(
        select(DashboardLayout).where(DashboardLayout.project_id == project_id, DashboardLayout.is_active.is_(True))
    )).scalar_one_or_none()
    if row is None:
        return DashboardLayoutConfig(**DEFAULT_CONFIG)
    return DashboardLayoutConfig(**row.config)
