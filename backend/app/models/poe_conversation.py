from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class PoeConversation(Base, TimestampMixin):
    """One continuous Poe conversation per project (2026-09-06, per Maro:
    "the chat history needs to persist" — reversing a deliberate 2026-08-31
    v1 decision to keep it client-only, see app/schemas/ai_chat.py's own
    header on that). messages is the exact same list[dict] of raw
    Anthropic Messages API content blocks ai_chat.py already sends over
    the wire on every turn — stored verbatim, no translation layer, same
    "read/written as one unit" reasoning as DashboardLayout's own config
    column. One row per project (unique constraint below): a genuinely
    separate multi-thread history was considered and deferred — Maro
    confirmed a single ongoing thread per project is what's wanted."""

    __tablename__ = "poe_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    messages: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
