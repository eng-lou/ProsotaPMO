from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.feedback_ticket import FeedbackTicket
from app.models.user import User
from app.schemas.feedback_ticket import (
    PresignedUpload, PresignedUploadRequest, TicketAttachmentResponse, TicketCreate, TicketResponse,
    TicketStatusUpdate,
)
from app.services import object_storage

router = APIRouter(prefix="/feedback-tickets", tags=["feedback-tickets"])

STORAGE_PREFIX = "feedback-attachments"
# Reallusion's own "less than 25MB" example (per Maro, modelled on their
# form) — feedback attachments are screenshots/short clips/logs, not the
# GB-scale IFC/point-cloud files site_capture.py's own upload deals with.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _to_response(row: FeedbackTicket, reporter: User) -> TicketResponse:
    return TicketResponse(
        id=row.id,
        created_by=row.created_by,
        subject=row.subject,
        description=row.description,
        status=row.status,
        attachments=[
            TicketAttachmentResponse(
                filename=a["filename"],
                size_bytes=a["size_bytes"],
                content_type=a["content_type"],
                download_url=object_storage.presigned_get_url(a["key"]),
            )
            for a in row.attachments
        ],
        created_at=row.created_at,
        updated_at=row.updated_at,
        reporter_email=reporter.email,
        reporter_display_name=reporter.display_name,
    )


# Direct-to-R2 upload (same three-step presign/PUT/record flow as
# site_capture.py's own — see object_storage.py's header for the full
# "why", Vercel's hard 4.5MB Function request-body cap).
@router.post("/presign", response_model=PresignedUpload)
async def presign_attachment_upload(payload: PresignedUploadRequest):
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, payload.name)
    upload_url = object_storage.presigned_put_url(storage_key, payload.content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


@router.post("/", response_model=TicketResponse, status_code=201)
async def create_ticket(
    data: TicketCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    attachments = []
    for a in data.attachments:
        try:
            size = await run_in_threadpool(object_storage.head_object_size, a.key)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail=f'"{a.filename}" wasn\'t found in storage — the upload may have failed or expired',
            ) from None
        if size > MAX_ATTACHMENT_BYTES:
            raise HTTPException(status_code=400, detail=f'"{a.filename}" is over the 25MB attachment limit')
        # Authoritative size read back from R2 itself, never the client's own
        # claim (same reasoning as every other upload path in this app —
        # object_storage.py's head_object_size docstring).
        attachments.append({"key": a.key, "filename": a.filename, "size_bytes": size, "content_type": a.content_type})

    row = FeedbackTicket(
        created_by=current_user.id, subject=data.subject, description=data.description, attachments=attachments,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _to_response(row, current_user)


@router.get("/", response_model=list[TicketResponse])
async def list_tickets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    """Super users see every ticket (their own admin queue); everyone else
    sees only their own submission history."""
    query = select(FeedbackTicket, User).join(User, FeedbackTicket.created_by == User.id)
    if not current_user.is_super_user:
        query = query.where(FeedbackTicket.created_by == current_user.id)
    query = query.order_by(FeedbackTicket.created_at.desc())
    rows = (await db.execute(query)).all()
    return [_to_response(ticket, reporter) for ticket, reporter in rows]


@router.patch("/{ticket_id}", response_model=TicketResponse)
async def update_ticket_status(
    ticket_id: uuid.UUID,
    data: TicketStatusUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    if not current_user.is_super_user:
        raise HTTPException(status_code=403, detail={"code": "forbidden"})
    row = await db.get(FeedbackTicket, ticket_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Ticket not found")
    row.status = data.status
    await db.commit()
    await db.refresh(row)
    reporter = await db.get(User, row.created_by)
    return _to_response(row, reporter)
