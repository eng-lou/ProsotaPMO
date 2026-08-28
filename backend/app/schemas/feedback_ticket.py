from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel

TicketStatus = Literal["open", "in_progress", "closed"]


class TicketAttachmentInput(BaseModel):
    key: str
    filename: str
    size_bytes: int
    content_type: str


class PresignedUploadRequest(BaseModel):
    name: str
    content_type: str


class PresignedUpload(BaseModel):
    storage_key: str
    upload_url: str


class TicketCreate(BaseModel):
    subject: str
    description: str
    attachments: list[TicketAttachmentInput] = []


class TicketStatusUpdate(BaseModel):
    status: TicketStatus


class TicketCommentCreate(BaseModel):
    body: str


class TicketAttachmentResponse(BaseModel):
    filename: str
    size_bytes: int
    content_type: str
    # Computed fresh per-response (see app/api/feedback_tickets.py) — never
    # stored, R2 presigned URLs expire.
    download_url: str


EventKind = Literal["comment", "status_change"]


class TicketEventResponse(BaseModel):
    id: uuid.UUID
    kind: EventKind
    body: str | None
    old_status: TicketStatus | None
    new_status: TicketStatus | None
    created_at: datetime

    # Who posted the comment / made the status change — same "populated
    # from a join, not the row itself" reasoning as TicketResponse's own
    # reporter_* fields below.
    author_email: str
    author_display_name: str


class TicketResponse(BaseModel):
    id: uuid.UUID
    created_by: uuid.UUID
    subject: str
    description: str
    status: TicketStatus
    attachments: list[TicketAttachmentResponse]
    events: list[TicketEventResponse]
    created_at: datetime
    updated_at: datetime

    # Reported by whom (2026-08-27) — the panel's own "all tickets" view (super
    # users) needs to show who filed each one; not on the DB row itself
    # (that's just created_by), populated by the endpoint from a join.
    reporter_email: str
    reporter_display_name: str
