from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String
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

    organisation: Mapped[Organisation] = relationship(back_populates="users")
