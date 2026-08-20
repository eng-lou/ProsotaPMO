from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_settings import AppSettings


async def get(db: AsyncSession) -> AppSettings:
    """The one AppSettings row, creating it on first access — there's
    never a caller-supplied id, this is always "the whole app's own
    settings," singular."""
    row = (await db.execute(select(AppSettings).limit(1))).scalar_one_or_none()
    if row is None:
        row = AppSettings()
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def set_google_tiles_api_key(db: AsyncSession, api_key: str) -> AppSettings:
    row = await get(db)
    row.google_tiles_api_key = api_key
    await db.commit()
    await db.refresh(row)
    return row
