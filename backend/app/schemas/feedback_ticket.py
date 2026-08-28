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


class TicketAttachmentResponse(BaseModel):
    filename: str
    size_bytes: int
    content_type: str
    # Computed fresh per-response (see app/api/feedback_tickets.py) — never
    # stored, R2 presigned URLs expire.
    download_url: str


class TicketResponse(BaseModel):
    id: uuid.UUID
    created_by: uuid.UUID
    subject: str
    description: str
    status: TicketStatus
    attachments: list[TicketAttachmentResponse]
    created_at: datetime
    updated_at: datetime

    # Reported by whom (2026-08-27) — the panel's own "all tickets" view (super
    # users) needs to show who filed each one; not on the DB row itself
    # (that's just created_by), populated by the endpoint from a join.
    reporter_email: str
    reporter_display_name: str
