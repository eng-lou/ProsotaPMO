from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.ai.planning_tools import PlanningApproval, apply_operation
from app.core.auth import get_db_user
from app.models.project import Project
from fastapi import HTTPException
from pydantic import ValidationError

from app.ai.orchestrator import run_agent_turn
from app.core.auth import require_ai_quota
from app.database import get_db
from app.schemas.ai_chat import AiChatRequest, AiChatResponse
from app.services import poe_conversation as poe_conversation_svc

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
    project = await db.get(Project, data.project_id)
    if project is None or project.org_id != _user.org_id or project.created_by != _user.id:
        raise HTTPException(404, "Project not found")
    # Save approval results before the next paid request can fail.
    async def checkpoint(messages):
        await poe_conversation_svc.save_messages(db, data.project_id, messages)

    await checkpoint(data.messages)
    result = await run_agent_turn(
        db, data.messages, data.project_id, data.schedule_period_id, data.period_id,
        data.client_tools_available, checkpoint=checkpoint,
    )
    # Persisted verbatim so a page reload (or coming back later) picks up
    # where the conversation left off (2026-09-06, per Maro: "the chat
    # history needs to persist") — the exact same messages the frontend
    # is about to hold in its own state, so the two can never drift apart.
    await poe_conversation_svc.save_messages(db, data.project_id, result.messages)
    return AiChatResponse(
        assistant_content=result.assistant_content, stop_reason=result.stop_reason,
        pending_client_tool_calls=result.pending_client_tool_calls,
        pending_proposals=result.pending_proposals, messages=result.messages,
    )


@router.post("/planning-approval")
async def approve_planning(data: PlanningApproval, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    project = await db.get(Project, data.project_id)
    if project is None or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, "Project not found")
    results = []
    for op in data.operations:
        try:
            result = await apply_operation(db, op, data.project_id, data.schedule_period_id, data.period_id)
            results.append({"ok": True, **result})
        except (HTTPException, ValidationError, ValueError) as exc:
            await db.rollback()
            results.append({"ok": False, "label": op.label,
                            "error": exc.detail if isinstance(exc, HTTPException) else "Invalid fields: check the proposed values."})
        except Exception:
            await db.rollback()
            results.append({"ok": False, "label": op.label, "error": "Could not confirm this change. Read saved records before retrying."})
    return {"results": results}
