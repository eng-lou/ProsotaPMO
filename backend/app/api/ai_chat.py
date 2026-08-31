from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.orchestrator import run_agent_turn
from app.core.auth import require_ai_quota
from app.database import get_db
from app.schemas.ai_chat import AiChatRequest, AiChatResponse

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat", response_model=AiChatResponse)
async def chat(
    data: AiChatRequest,
    db: AsyncSession = Depends(get_db),
    # Per-user daily cap, bypassed for super users (2026-08-31, per Maro) —
    # see require_ai_quota's own header in app/core/auth.py. Deliberately a
    # route-level dependency here rather than router-wide (main.py's own
    # _auth_approved already covers every route including this one; this
    # one additionally needs the real user object to check/increment
    # against, which a router-wide dependencies=[] list can't expose back
    # to the endpoint function).
    _user=Depends(require_ai_quota),
) -> AiChatResponse:
    result = await run_agent_turn(
        db, data.messages, data.project_id, data.schedule_period_id, data.period_id,
        data.client_tools_available,
    )
    return AiChatResponse(
        assistant_content=result.assistant_content, stop_reason=result.stop_reason,
        pending_client_tool_calls=result.pending_client_tool_calls,
        pending_proposals=result.pending_proposals, messages=result.messages,
    )
