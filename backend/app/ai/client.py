from __future__ import annotations

from functools import lru_cache

import anthropic
from fastapi import HTTPException

from app.core.config import settings
from app.ai.openai_client import TurnResponse, run_turn as run_openai_turn

# Project Controls Assistant (2026-08-31) — see app/ai/orchestrator.py for
# the loop this client feeds. claude-opus-5 per this app's own decided AI
# provider (Anthropic Claude, see the vision doc's stack list); adaptive
# thinking + effort "high" are the current API's replacement for the older
# fixed budget_tokens knob (removed on this model — see anthropic's own
# CHANGELOG), not something this app tunes per-request.
MODEL = "claude-opus-5"
MAX_TOKENS = 16000


@lru_cache(maxsize=1)
def _get_client() -> anthropic.AsyncAnthropic:
    if not settings.anthropic_api_key:
        # Fails loudly at call time, not at import time — importing this
        # module (e.g. for a health check or a future non-AI use of
        # app/ai/) must not itself require a key to be configured.
        raise HTTPException(status_code=503, detail="AI assistant is not configured (missing anthropic_api_key)")
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


async def run_turn(
    system: str,
    messages: list[dict],
    tools: list[dict],
) -> anthropic.types.Message | TurnResponse:
    """One provider call — the orchestrator's loop (app/ai/orchestrator.py)
    calls this once per turn, executing server tools and re-calling in
    between. Non-streaming (2026-08-31 v1 deviation, see the plan's own
    header on this — no SSE precedent anywhere in this app's frontend, and
    the client-tool round-trip already breaks a conversation into discrete
    request/responses regardless)."""
    if settings.ai_provider == 'openai' or (settings.ai_provider == 'auto' and settings.openai_api_key):
        return await run_openai_turn(system, messages, tools)
    client = _get_client()
    # OpenAI output envelopes are retained for Responses replay, but are not
    # Anthropic content blocks. Their text/tool mirrors remain on rollback.
    messages = [
        {**message, 'content': [b for b in message['content'] if b.get('type') != 'openai_item']}
        if isinstance(message.get('content'), list) else message
        for message in messages
    ]
    return await client.messages.create(
        model=MODEL,
        max_tokens=MAX_TOKENS,
        system=system,
        messages=messages,
        tools=tools,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
    )
