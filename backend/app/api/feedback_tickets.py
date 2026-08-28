from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.feedback_ticket import FeedbackTicket, TicketEvent
from app.models.user import User
from app.schemas.feedback_ticket import (
    PresignedUpload, PresignedUploadRequest, TicketAttachmentResponse, TicketCommentCreate, TicketCreate,
    TicketEventResponse, TicketResponse, TicketStatusUpdate,
)
from app.services import object_storage

router = APIRouter(prefix="/feedback-tickets", tags=["feedback-tickets"])

STORAGE_PREFIX = "feedback-attachments"
# Reallusion's own "less than 25MB" example (per Maro, modelled on their
# form) — feedback attachments are screenshots/short clips/logs, not the
# GB-scale IFC/point-cloud files site_capture.py's own upload deals with.
MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024


def _can_see(ticket: FeedbackTicket, user: User) -> bool:
    return user.is_super_user or ticket.created_by == user.id


async def _load_events(db: AsyncSession, ticket_ids: list[uuid.UUID]) -> dict[uuid.UUID, list[TicketEventResponse]]:
    if not ticket_ids:
        return {}
    rows = (await db.execute(
        select(TicketEvent, User)
        .join(User, TicketEvent.author_id == User.id)
        .where(TicketEvent.ticket_id.in_(ticket_ids))
        .order_by(TicketEvent.created_at)
    )).all()
    by_ticket: dict[uuid.UUID, list[TicketEventResponse]] = {tid: [] for tid in ticket_ids}
    for event, author in rows:
        by_ticket[event.ticket_id].append(TicketEventResponse(
            id=event.id, kind=event.kind, body=event.body,
            old_status=event.old_status, new_status=event.new_status,
            created_at=event.created_at, author_email=author.email, author_display_name=author.display_name,
        ))
    return by_ticket


def _to_response(row: FeedbackTicket, reporter: User, events: list[TicketEventResponse]) -> TicketResponse:
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
        events=events,
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
    return _to_response(row, current_user, [])


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
    events_by_ticket = await _load_events(db, [ticket.id for ticket, _ in rows])
    return [_to_response(ticket, reporter, events_by_ticket[ticket.id]) for ticket, reporter in rows]


# 2026-08-28, per Maro: "the feedback icon needs to show there's a new
# notification" — checked separately from list_tickets (a lightweight bool,
# not the full ticket+event payload) since both Sidebar and ProjectSelector
# need to poll this just to decide whether to show a dot on their own
# trigger button, without loading the whole panel.
@router.get("/unread")
async def has_unread(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
) -> dict:
    since = current_user.last_viewed_feedback_at or datetime.fromtimestamp(0, tz=timezone.utc)
    if current_user.is_super_user:
        # Anything from anyone else, on any ticket — a new ticket counts too
        # (created_at is that ticket's own first "event").
        new_ticket = (await db.execute(
            select(FeedbackTicket.id).where(FeedbackTicket.created_at > since, FeedbackTicket.created_by != current_user.id).limit(1)
        )).first()
        new_event = (await db.execute(
            select(TicketEvent.id).where(TicketEvent.created_at > since, TicketEvent.author_id != current_user.id).limit(1)
        )).first()
        return {"has_unread": bool(new_ticket or new_event)}
    new_event = (await db.execute(
        select(TicketEvent.id)
        .join(FeedbackTicket, TicketEvent.ticket_id == FeedbackTicket.id)
        .where(
            FeedbackTicket.created_by == current_user.id,
            TicketEvent.created_at > since,
            TicketEvent.author_id != current_user.id,
        )
        .limit(1)
    )).first()
    return {"has_unread": bool(new_event)}


@router.post("/mark-read")
async def mark_read(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
) -> dict:
    current_user.last_viewed_feedback_at = datetime.now(timezone.utc)
    await db.commit()
    return {"ok": True}


# Super-user-only audit trail across every ticket (2026-08-28, per Maro:
# "i need to be able to keep track of the progress ... across all users, i
# can download the log") — every comment and every status change, in one
# flat CSV, not scoped to a single ticket.
@router.get("/export")
async def export_events(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    if not current_user.is_super_user:
        raise HTTPException(status_code=403, detail={"code": "forbidden"})
    rows = (await db.execute(
        select(TicketEvent, FeedbackTicket, User)
        .join(FeedbackTicket, TicketEvent.ticket_id == FeedbackTicket.id)
        .join(User, TicketEvent.author_id == User.id)
        .order_by(TicketEvent.created_at)
    )).all()

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["ticket_id", "subject", "event_time_utc", "kind", "author", "old_status", "new_status", "comment"])
    for event, ticket, author in rows:
        writer.writerow([
            str(ticket.id), ticket.subject, event.created_at.isoformat(), event.kind, author.email,
            event.old_status or "", event.new_status or "", (event.body or "").replace("\n", " "),
        ])
    return Response(
        content=buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=feedback-ticket-log.csv"},
    )


@router.post("/{ticket_id}/comments", response_model=TicketResponse)
async def add_comment(
    ticket_id: uuid.UUID,
    data: TicketCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_db_user),
):
    row = await db.get(FeedbackTicket, ticket_id)
    if row is None or not _can_see(row, current_user):
        raise HTTPException(status_code=404, detail="Ticket not found")
    db.add(TicketEvent(ticket_id=ticket_id, author_id=current_user.id, kind="comment", body=data.body))
    await db.commit()
    await db.refresh(row)
    reporter = current_user if row.created_by == current_user.id else await db.get(User, row.created_by)
    events = (await _load_events(db, [ticket_id]))[ticket_id]
    return _to_response(row, reporter, events)


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
    old_status = row.status
    row.status = data.status
    if old_status != data.status:
        db.add(TicketEvent(
            ticket_id=ticket_id, author_id=current_user.id, kind="status_change",
            old_status=old_status, new_status=data.status,
        ))
    await db.commit()
    await db.refresh(row)
    reporter = await db.get(User, row.created_by)
    events = (await _load_events(db, [ticket_id]))[ticket_id]
    return _to_response(row, reporter, events)
