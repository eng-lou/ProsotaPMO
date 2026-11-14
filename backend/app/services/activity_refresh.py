from __future__ import annotations

import uuid
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.activity import Activity


async def refresh_changed_activities(db: AsyncSession, activity_ids: set[uuid.UUID]) -> None:
    """Reload committed rows in batches, including expired server-generated fields.

    populate_existing updates the same identity-map objects held by callers.
    This replaces one round trip per changed activity after a CPM cascade.
    """
    ids = list(activity_ids)
    for offset in range(0, len(ids), 500):
        result = await db.execute(
            select(Activity).where(Activity.id.in_(ids[offset:offset + 500]))
            .execution_options(populate_existing=True)
        )
        result.scalars().all()
