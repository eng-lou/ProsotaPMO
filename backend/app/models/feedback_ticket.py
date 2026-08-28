from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class FeedbackTicket(Base, TimestampMixin):
    """User-submitted feedback/bug reports (2026-08-27, per Maro — modelled
    on Reallusion's own support-ticket flow: subject + description + optional
    attachments, a status a super user can move through open -> in_progress
    -> closed, both an end-user's own ticket history and a super-user-only
    view of everyone's). Not project-scoped (created_by only, no project_id
    or org_id) — feedback is about the app itself, not tied to any one
    project or org.
    """

    __tablename__ = "feedback_tickets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    # [{"key": "feedback-attachments/<uuid>.<ext>", "filename": "screenshot.png",
    #   "size_bytes": 12345, "content_type": "image/png"}, ...] — a presigned
    # download URL is computed fresh per-response (schemas/feedback_ticket.py),
    # never stored here, since R2 presigned URLs expire.
    attachments: Mapped[list] = mapped_column(JSONB, nullable=False, default=list, server_default="[]")
