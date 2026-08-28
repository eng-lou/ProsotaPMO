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


class TicketEvent(Base, TimestampMixin):
    """A single entry in a ticket's timeline (2026-08-28, per Maro — "so its
    a two way comms between super user and the user" plus "keep track of
    the progress ... back and forth"). One table for both comment replies
    and status changes, not two, so a ticket's full history — who said what
    and when its status moved — reconstructs from a single ordered query,
    which is also exactly the shape the super user's downloadable audit
    log (app/api/feedback_tickets.py's own export_events) needs.

    kind="comment": body set, old_status/new_status both null.
    kind="status_change": old_status/new_status set (auto-recorded by
    update_ticket_status, author_id is whoever changed it), body null.
    """

    __tablename__ = "feedback_ticket_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    ticket_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("feedback_tickets.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    new_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
