"""Server-only OpenAI HTTP transport; never expose provider bodies or keys."""
import logging
import re

import httpx
from fastapi import HTTPException

from app.core.config import settings

logger = logging.getLogger(__name__)


def _error_detail(response: httpx.Response) -> str:
    """Use provider metadata for diagnosis, never echo its free-form message."""
    try:
        error = response.json().get("error", {})
    except (ValueError, AttributeError):
        error = {}
    if not isinstance(error, dict):
        error = {}
    # Only structural metadata is logged: messages can contain signed URLs,
    # filenames or document text. Do not log response bodies or exceptions.
    def safe(value):
        return value if isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.\[\]-]{1,160}", value) else "unknown"
    code = safe(error.get("code"))
    param = safe(error.get("param"))
    request_id = safe(response.headers.get("x-request-id"))
    logger.warning("OpenAI rejected request: status=%s code=%s param=%s request_id=%s",
                   response.status_code, code, param, request_id)
    message = "OpenAI could not complete this request."
    if response.status_code == 400:
        if any(word in param.lower() for word in ("file", "filename")) or code in (
            "invalid_file", "unsupported_file", "file_not_found", "file_download_failed",
        ):
            message = "OpenAI could not read an attachment. Try reattaching it, or save it as PDF and retry."
        else:
            message = "OpenAI rejected the request format. The administrator needs to check the AI integration."
    if request_id != "unknown":
        message += f" Reference: {request_id}."
    return message


async def post_openai(path: str, *, timeout: float = 120, **kwargs) -> dict:
    if not settings.openai_api_key:
        raise HTTPException(503, "OpenAI is not configured. Set OPENAI_API_KEY on the server.")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=10)) as client:
            response = await client.post(
                f"https://api.openai.com/v1/{path}",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                **kwargs,
            )
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError('Expected an object response')
            return data
    except httpx.TimeoutException as exc:
        raise HTTPException(504, "OpenAI timed out. Please try again.") from exc
    except httpx.HTTPStatusError as exc:
        status = exc.response.status_code
        detail = _error_detail(exc.response)
        if status in (401, 403, 404):
            raise HTTPException(503, "OpenAI credentials or model access need checking by the administrator.") from exc
        if status == 429:
            raise HTTPException(429, "OpenAI usage or rate limit reached. Check API billing and limits, then retry.") from exc
        raise HTTPException(502, detail) from exc
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(502, "OpenAI returned an unavailable or invalid response.") from exc
