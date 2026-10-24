from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class CalloutContent(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mode: Literal["text", "icon", "icon_text", "image", "video"] = "text"
    media_id: UUID | None = None
    symbol: str = Field(default="", max_length=12)
    width: int = Field(default=240, ge=32, le=1024)
    height: int = Field(default=160, ge=32, le=1024)
    fit: Literal["cover", "contain"] = "cover"
    loop: bool = True
    start_seconds: float = Field(default=0, ge=0, le=86400)


class CalloutMediaCreate(BaseModel):
    project_id: UUID
    name: str = Field(min_length=1, max_length=200)
    content_type: Literal["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]
