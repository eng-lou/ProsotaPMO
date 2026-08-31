from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.organisation import Organisation


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organisations.id"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    auth0_sub: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(50), nullable=False, default="member")
    # Trial/beta access gate (2026-08-25) — "pending" until a super user
    # approves the account; see get_approved_user/get_db_user in
    # app/core/auth.py for how this is enforced and self-healed.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", server_default="pending")
    is_super_user: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    requested_title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requested_organisation: Mapped[str | None] = mapped_column(String(255), nullable=True)
    requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Access Manager "last accessed" column (2026-08-25) — throttled in
    # get_db_user (only rewritten if >5 min stale) so this stays a rare
    # write, not one on every single request; NULL means never recorded yet.
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Access Manager "time spent" (2026-08-30) — a running total accumulated
    # onto last_active_at's own throttled heartbeat in get_db_user, not a
    # session table (no logout event exists to close one against). See that
    # function's own comment for the accumulation heuristic.
    total_active_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # Feedback ticket unread-notification tracking (2026-08-28) — set to
    # now() whenever this user opens the Feedback panel (POST
    # /feedback-tickets/mark-read); "unread" is computed by comparing this
    # against feedback_ticket_events.created_at, not stored as a count/flag,
    # so it's always correct even across multiple tickets/devices.
    last_viewed_feedback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # AI assistant daily usage cap (2026-08-31) — see require_ai_quota in
    # app/core/auth.py for how these two are actually enforced/reset.
    # ai_messages_reset_date NULL means "never used it yet" (treated as
    # today's date, i.e. 0 used, the first time it's checked) rather than
    # forcing a migration-time backfill for every existing user row.
    ai_messages_today: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    ai_messages_reset_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    organisation: Mapped[Organisation] = relationship(back_populates="users")
