from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.client import run_turn
from app.ai.context_tools import get_project_snapshot
from app.ai.record_tools import explain_causal_baseline, find_records, find_relationships, get_reassessment_history
from app.ai.system_prompt import build_system_prompt
from app.ai.tools import CLIENT_TOOL_NAMES, PROPOSAL_TOOL_NAMES, TOOLS
from app.services import object_storage

# Server-side tool dispatch (2026-08-31, extended 2026-09-01 with
# find_records/explain_causal_baseline, then find_relationships) — every
# tool NOT in CLIENT_TOOL_NAMES/PROPOSAL_TOOL_NAMES is executed inline
# here. Every propose_* tool (propose_create_risks/propose_create_activities/
# propose_link_records/propose_edit_relationships/propose_link_elements)
# never reaches this function at all — PROPOSAL_TOOL_NAMES makes
# run_agent_turn's own loop stop and return them as pending_proposals
# before dispatch is ever considered (see that function's own docstring).


async def _execute_server_tool(db: AsyncSession, name: str, tool_input: dict, project_id: uuid.UUID,
                                schedule_period_id: uuid.UUID | None, period_id: uuid.UUID | None) -> dict:
    if name == "get_project_snapshot":
        return await get_project_snapshot(db, project_id, schedule_period_id, period_id)
    if name == "find_records":
        return await find_records(
            db, project_id, tool_input["record_type"], tool_input["query"], schedule_period_id, period_id,
        )
    if name == "explain_causal_baseline":
        return await explain_causal_baseline(
            db, project_id, tool_input["record_type"], uuid.UUID(tool_input["record_id"]),
        )
    if name == "find_relationships":
        return await find_relationships(db, uuid.UUID(tool_input["activity_id"]))
    if name == "get_reassessment_history":
        return await get_reassessment_history(db, tool_input["record_type"], uuid.UUID(tool_input["record_id"]))
    raise ValueError(f"Unknown server tool: {name}")


# Attachment placeholder expansion + sanitization (2026-08-31, per Maro:
# "add ability to add data, images, spreadsheets etc") — two jobs, both
# needed before any message ever reaches the real Anthropic API:
#
# 1. A chat message carrying an image/PDF attachment holds a deliberately
#    non-Anthropic placeholder block (`{"type": "image", "source":
#    {"type": "storage_key", "key": "..."}}`, see ai_attachments.py's own
#    header for the full upload flow) rather than either the real bytes or
#    a real Anthropic block, specifically so nothing in `messages` itself —
#    what gets returned to the frontend and resent on every later turn
#    (this app has no persisted conversation history, see ai_chat.py's own
#    header) — ever holds a real, time-limited URL. Called fresh on every
#    single run_turn call below (never once at upload time), resolving
#    each placeholder into a real `{"source": {"type": "url", ...}}` block
#    via a *newly* presigned GET url each time, so a conversation running
#    for however long never has a chance to hit an expired one.
# 2. Every block the frontend's own aiAttachments.ts produces (image/
#    document AND the plain text block a spreadsheet attachment becomes)
#    also carries one extra `_poeAttachmentName` field — see that file's
#    own ATTACHMENT_NAME_FIELD header for why (so the UI can render a
#    filename chip for a past turn's attachment without either losing the
#    name or dumping a spreadsheet's raw CSV into the visible bubble).
#    Anthropic's own schema has no concept of this field and may reject an
#    unrecognised one on a content block, so every `_poe*`-prefixed key —
#    not just this one, any future one — is stripped from *every* block
#    here, unconditionally, not only the ones with a storage_key source.
#
# Returns a new list/dict per touched message rather than mutating the
# caller's own `messages`/`working_messages` in place — those must keep
# holding the placeholder shape (and the `_poe*` metadata), not whatever
# got resolved/stripped for one particular API call.
def _expand_attachment_blocks(messages: list[dict]) -> list[dict]:
    expanded = []
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            expanded.append(message)
            continue
        new_content = []
        changed = False
        for block in content:
            if not isinstance(block, dict):
                new_content.append(block)
                continue
            clean_block = {k: v for k, v in block.items() if not k.startswith("_poe")}
            if len(clean_block) != len(block):
                changed = True
            source = clean_block.get("source")
            if isinstance(source, dict) and source.get("type") == "storage_key":
                clean_block = {**clean_block, "source": {"type": "url", "url": object_storage.presigned_get_url(source["key"])}}
                changed = True
            new_content.append(clean_block)
        expanded.append({**message, "content": new_content} if changed else message)
    return expanded


@dataclass
class AgentTurnResult:
    assistant_content: list[dict] = field(default_factory=list)
    stop_reason: str | None = None
    pending_client_tool_calls: list[dict] = field(default_factory=list)
    # Proposal tool_use blocks (2026-08-31) — e.g. propose_create_risks.
    # Kept as its own field, not merged into pending_client_tool_calls: a
    # human approving/rejecting a draft record in a chat card is a
    # fundamentally different frontend job than a viewport action, and the
    # two should never be conflated just because both happen to "stop the
    # loop and hand it to the frontend" the same way.
    pending_proposals: list[dict] = field(default_factory=list)
    messages: list[dict] = field(default_factory=list)


async def run_agent_turn(
    db: AsyncSession,
    messages: list[dict],
    project_id: uuid.UUID,
    schedule_period_id: uuid.UUID | None,
    period_id: uuid.UUID | None,
    client_tools_available: list[str],
) -> AgentTurnResult:
    """Loops Messages API calls, executing server tools inline, until either
    a final text response or a client-tool/proposal-tool request pauses it
    (see the approved plan's "three tool kinds" architecture). Every tool in
    CLIENT_TOOL_NAMES that also appears in client_tools_available is left
    unexecuted and returned as pending_client_tool_calls for the frontend
    to resolve and resume with; every tool in PROPOSAL_TOOL_NAMES (e.g.
    propose_create_risks) is likewise left unexecuted and returned as
    pending_proposals instead, for the frontend's own review-card UI to
    resolve — see app/api/ai_chat.py for the resume-with-tool-results half
    of both contracts.

    If a turn contains ANY pending client- or proposal-tool_use block, the
    WHOLE turn's tool_use blocks are returned pending (in whichever of the
    two fields applies) rather than partially executing the server ones —
    the Messages API requires every tool_result for a turn to land in a
    single follow-up user message, so a turn can't be "half continued"
    server-side while a client/proposal tool in the same turn is still
    outstanding. This should be uncommon in practice (the system prompt
    asks the model to ground itself first via get_project_snapshot, which
    naturally resolves before it reaches for either), but the dispatch
    logic below handles it correctly either way.
    """
    tools = [t for t in TOOLS if t["name"] not in CLIENT_TOOL_NAMES or t["name"] in client_tools_available]
    system = build_system_prompt()
    working_messages = list(messages)

    while True:
        response = await run_turn(system, _expand_attachment_blocks(working_messages), tools)
        content = [block.model_dump() for block in response.content]

        if response.stop_reason != "tool_use":
            return AgentTurnResult(
                assistant_content=content, stop_reason=response.stop_reason,
                messages=working_messages + [{"role": "assistant", "content": content}],
            )

        tool_use_blocks = [b for b in content if b["type"] == "tool_use"]
        client_calls = [b for b in tool_use_blocks if b["name"] in CLIENT_TOOL_NAMES]
        proposal_calls = [b for b in tool_use_blocks if b["name"] in PROPOSAL_TOOL_NAMES]

        working_messages = working_messages + [{"role": "assistant", "content": content}]

        if client_calls or proposal_calls:
            return AgentTurnResult(
                assistant_content=content, stop_reason=response.stop_reason,
                pending_client_tool_calls=tool_use_blocks if client_calls else [],
                pending_proposals=tool_use_blocks if proposal_calls else [],
                messages=working_messages,
            )

        tool_results = []
        for block in tool_use_blocks:
            try:
                result = await _execute_server_tool(
                    db, block["name"], block["input"], project_id, schedule_period_id, period_id,
                )
                tool_results.append({
                    "type": "tool_result", "tool_use_id": block["id"], "content": json.dumps(result),
                })
            except Exception as exc:  # noqa: BLE001 — a tool failure becomes a tool_result the model sees, not a 500
                tool_results.append({
                    "type": "tool_result", "tool_use_id": block["id"], "content": str(exc), "is_error": True,
                })
        working_messages = working_messages + [{"role": "user", "content": tool_results}]
