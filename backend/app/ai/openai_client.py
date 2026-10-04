"""Responses adapter retaining Poe's saved messages and proposal-card contract.

Existing Anthropic-shaped history is translated on input. New Responses output
items (including encrypted reasoning) are replayed intact alongside the UI's
text/tool mirrors. No provider-stored conversation is required.
"""
from dataclasses import dataclass
import json

from fastapi import HTTPException

from app.ai.openai_transport import post_openai
from app.core.config import settings


@dataclass
class ContentBlock:
    value: dict

    def model_dump(self) -> dict:
        return self.value


@dataclass
class TurnResponse:
    content: list[ContentBlock]
    stop_reason: str


def replay_item(item: dict) -> dict:
    """Accept only assistant output, never a client-supplied privileged role."""
    if not isinstance(item, dict):
        raise HTTPException(400, "Invalid saved AI response.")
    kind = item.get('type')
    if kind == 'message':
        if item.get('role') != 'assistant' or not isinstance(item.get('content'), list):
            raise HTTPException(400, "Invalid saved assistant message.")
        if any(not isinstance(p, dict) or p.get('type') not in ('output_text', 'refusal') for p in item['content']):
            raise HTTPException(400, "Invalid saved assistant content.")
        allowed = ('id', 'type', 'role', 'content', 'status', 'phase')
    elif kind == 'function_call':
        if not all(isinstance(item.get(k), str) for k in ('name', 'call_id', 'arguments')):
            raise HTTPException(400, "Invalid saved tool call.")
        allowed = ('id', 'type', 'name', 'call_id', 'arguments', 'status')
    elif kind == 'reasoning':
        allowed = ('id', 'type', 'summary', 'encrypted_content', 'status')
    else:
        raise HTTPException(400, "Unsupported saved AI response.")
    return {k: item[k] for k in allowed if k in item}


def responses_input(messages: list[dict]) -> list[dict]:
    result = []
    for message in messages:
        role = message.get("role")
        if role not in ("user", "assistant"):
            raise HTTPException(400, "Unsupported conversation role.")
        blocks = message.get("content", [])
        if isinstance(blocks, str):
            result.append({"role": role, "content": blocks})
            continue
        # These items already contain the exact text and tool calls; don't
        # send their visible UI mirrors again or execute duplicate calls.
        if not isinstance(blocks, list) or any(not isinstance(b, dict) for b in blocks):
            raise HTTPException(400, "Invalid conversation content.")
        replay = [replay_item(b.get("item")) for b in blocks if b.get("type") == "openai_item"]
        if replay and role == "assistant":
            result.extend(replay)
            continue
        parts = []

        def flush():
            if parts:
                result.append({"role": role, "content": list(parts)})
                parts.clear()

        for block in blocks:
            kind = block.get("type")
            if kind == "text":
                parts.append({"type": "input_text", "text": block.get("text", "")})
            elif kind in ("image", "document"):
                source = block.get("source", {})
                if source.get("type") == "url":
                    url = source["url"]
                elif source.get("type") == "base64":
                    url = f"data:{source['media_type']};base64,{source['data']}"
                else:
                    raise HTTPException(400, "Attachment could not be resolved.")
                if kind == "image":
                    parts.append({"type": "input_image", "image_url": url})
                elif source.get("type") == "url":
                    parts.append({"type": "input_file", "file_url": url})
                else:
                    parts.append({"type": "input_file", "filename": "attachment.pdf", "file_data": url})
            elif kind == "tool_use":
                flush()
                result.append({"type": "function_call", "call_id": block["id"], "name": block["name"],
                               "arguments": json.dumps(block["input"])})
            elif kind == "tool_result":
                flush()
                output = block.get("content", "")
                if not isinstance(output, str):
                    output = json.dumps(output)
                if block.get("is_error"):
                    output = json.dumps({"error": output})
                result.append({"type": "function_call_output", "call_id": block["tool_use_id"], "output": output})
            elif kind not in ("thinking", "redacted_thinking", "openai_item"):
                raise HTTPException(400, "Unsupported conversation content.")
        flush()
    return result


def parse_response(response: dict) -> TurnResponse:
    # Never run a partial/truncated function call.
    if response.get("status") != "completed":
        raise HTTPException(502, "OpenAI did not complete the response. Please retry or shorten the request.")
    content = []
    has_calls = False
    try:
        for item in response.get("output", []):
            content.append(ContentBlock({"type": "openai_item", "item": item}))
            if item["type"] == "message":
                for part in item.get("content", []):
                    if part["type"] == "output_text":
                        content.append(ContentBlock({"type": "text", "text": part["text"]}))
                    elif part["type"] == "refusal":
                        content.append(ContentBlock({"type": "text", "text": part["refusal"]}))
            elif item["type"] == "function_call":
                arguments = json.loads(item["arguments"])
                if not isinstance(arguments, dict):
                    raise ValueError("Function arguments must be an object")
                has_calls = True
                content.append(ContentBlock({"type": "tool_use", "id": item["call_id"], "name": item["name"], "input": arguments}))
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(502, "OpenAI returned an invalid tool response.") from exc
    if not any(b.value["type"] in ("text", "tool_use") for b in content):
        raise HTTPException(502, "OpenAI returned no answer.")
    return TurnResponse(content, "tool_use" if has_calls else "end_turn")


async def run_turn(system: str, messages: list[dict], tools: list[dict]) -> TurnResponse:
    response = await post_openai("responses", json={
        "model": settings.openai_chat_model,
        "instructions": system,
        "input": responses_input(messages),
        "tools": [{"type": "function", "name": t["name"], "description": t["description"],
                   "parameters": t["input_schema"], "strict": False} for t in tools],
        "reasoning": {"effort": settings.openai_reasoning_effort},
        "max_output_tokens": 16000,
        "store": False,
        "include": ["reasoning.encrypted_content"],
    })
    return parse_response(response)
