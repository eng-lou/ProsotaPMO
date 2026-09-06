from __future__ import annotations

from pydantic import BaseModel


class PoeConversationResponse(BaseModel):
    # Raw Anthropic Messages API content blocks, same shape ai_chat.py's
    # own AiChatRequest/AiChatResponse already use verbatim — see
    # PoeConversation's own docstring.
    messages: list[dict]
