from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.poe_conversation import PoeConversation


async def get_messages(db: AsyncSession, project_id: uuid.UUID) -> list[dict]:
    """The project's persisted Poe conversation, or [] if it's never had
    one — same "no row yet just means empty/default" pattern as everywhere
    else in this codebase, never a 404 for a genuinely-optional record."""
    row = (await db.execute(
        select(PoeConversation).where(PoeConversation.project_id == project_id)
    )).scalar_one_or_none()
    return row.messages if row is not None else []


async def save_messages(db: AsyncSession, project_id: uuid.UUID, messages: list[dict]) -> None:
    """Overwrites the project's conversation with the caller's already-
    complete message list — ai_chat.py calls this with the exact same
    `result.messages` it hands back to the frontend after every turn, so
    the two never drift apart. Upserts rather than requiring a separate
    "create the conversation" step first, since a project's Poe
    conversation is created implicitly by its first message, not by any
    explicit user action."""
    row = (await db.execute(
        select(PoeConversation).where(PoeConversation.project_id == project_id)
    )).scalar_one_or_none()
    if row is None:
        db.add(PoeConversation(project_id=project_id, messages=messages))
    else:
        row.messages = messages
    await db.commit()


async def clear_messages(db: AsyncSession, project_id: uuid.UUID) -> None:
    """Starts a fresh conversation — deletes the row rather than setting
    messages=[] in place, so a project that's never chatted with Poe and
    one that just cleared its history look identical (no stray empty row)."""
    row = (await db.execute(
        select(PoeConversation).where(PoeConversation.project_id == project_id)
    )).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
