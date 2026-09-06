from __future__ import annotations

import uuid

from pydantic import BaseModel


class AiChatRequest(BaseModel):
    project_id: uuid.UUID
    schedule_period_id: uuid.UUID | None = None
    period_id: uuid.UUID | None = None
    # Raw Anthropic Messages API content blocks, not a custom shape — the
    # frontend holds and resends the full conversation each call, and this
    # endpoint persists the updated list verbatim after every turn
    # (app/services/poe_conversation.py, added 2026-09-06) so it survives
    # a reload — round-tripping the SDK's own block shape avoids a lossy
    # custom translation layer anywhere in that path.
    messages: list[dict]
    # Tool names the frontend can currently execute — e.g. the viewport
    # tools only while the 4D module is mounted (see AiFourDBridgeContext
    # in the approved plan). Empty until later phases add any client tools.
    client_tools_available: list[str] = []


class AiChatResponse(BaseModel):
    assistant_content: list[dict]
    stop_reason: str | None
    pending_client_tool_calls: list[dict]
    # Proposal tool_use blocks awaiting human approve/reject in the UI (e.g.
    # propose_create_risks) — see orchestrator.py's own AgentTurnResult
    # header for why this stays separate from pending_client_tool_calls.
    pending_proposals: list[dict]
    messages: list[dict]
