from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.base import Base, TimestampMixin
from app.models.project import Project
from app.models.user import User


async def check_project_capacity(db, user):
    # Serialize creation/import/duplication for the same trial account.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    if not user.is_super_user:
        count = await db.scalar(select(func.count()).select_from(Project).where(Project.created_by == user.id))
        if count >= 2:
            raise HTTPException(403, "You've reached the 2-project limit for trial accounts.")


def _clone_row(row: Base, new_id: uuid.UUID, **overrides):
    """Copies every real column off an existing row into a brand-new instance
    of the same class, generating a fresh id, then applies FK-remap overrides
    on top. Deliberately generic (reflects on `__table__.columns`) rather than
    hand-listing every field per model — with ~25 tables involved in a full
    project clone, a hand-written field list per model is exactly the kind of
    thing that quietly goes stale the next time a column is added to one of
    them, whereas this picks up new columns automatically.

    created_at/updated_at are excluded only for genuine TimestampMixin rows —
    those are ORM-managed "when was this row inserted" metadata, which should
    read as "now" for a freshly-cloned row, not the original's insert time.
    A handful of models (Reassessment.reviewed_at, RecordLink.created_at) have
    their own domain-meaningful timestamp under a similar name without using
    TimestampMixin at all — those are genuine data (when a reassessment was
    logged, when a link was actually made) and are deliberately preserved
    verbatim, which is exactly why this checks isinstance(row, TimestampMixin)
    rather than excluding columns by name alone.
    """
    cls = type(row)
    exclude = {"id"}
    if isinstance(row, TimestampMixin):
        exclude |= {"created_at", "updated_at"}
    data = {col.name: getattr(row, col.name) for col in cls.__table__.columns if col.name not in exclude}
    data["id"] = new_id
    data.update(overrides)
    return cls(**data)
