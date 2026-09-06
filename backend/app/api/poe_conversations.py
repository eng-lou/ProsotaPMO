from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.poe_conversation import PoeConversationResponse
from app.services import poe_conversation as svc

router = APIRouter(prefix="/poe-conversations", tags=["poe-conversations"])


@router.get("/{project_id}", response_model=PoeConversationResponse)
async def get_conversation(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Loaded once when Poe's panel first mounts for a project, so a page
    reload (or coming back the next day) picks up where the conversation
    left off instead of starting blank."""
    return PoeConversationResponse(messages=await svc.get_messages(db, project_id))


@router.delete("/{project_id}", status_code=204)
async def clear_conversation(project_id: uuid.UUID, db: AsyncSession = Depends(get_db)) -> Response:
    """The panel's own "Clear conversation" action — now that history
    survives a reload, there needs to be an explicit way to start fresh
    instead of relying on that reload to do it for free."""
    await svc.clear_messages(db, project_id)
    return Response(status_code=204)
