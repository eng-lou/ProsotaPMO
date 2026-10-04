"""Server-only OpenAI HTTP transport; never expose provider bodies or keys."""
import httpx
from fastapi import HTTPException

from app.core.config import settings


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
        if status in (401, 403, 404):
            raise HTTPException(503, "OpenAI credentials or model access need checking by the administrator.") from exc
        if status == 429:
            raise HTTPException(429, "OpenAI usage or rate limit reached. Check API billing and limits, then retry.") from exc
        raise HTTPException(502, "OpenAI could not complete this request.") from exc
    except (httpx.RequestError, ValueError) as exc:
        raise HTTPException(502, "OpenAI returned an unavailable or invalid response.") from exc
