from __future__ import annotations

import uuid

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AppSettings(Base, TimestampMixin):
    """App-wide (not per-project, not per-organisation) settings editable
    from within the product itself, rather than a server .env file
    (2026-08-19, per Maro, after being asked to edit backend/.env by hand
    for the Google Maps Platform key: "unable to put my key... the user
    experience going to notepad to do all of that and back is not good").
    Singleton with no natural parent key at all — unlike SiteContext
    (one row per *project*) or ProjectLetterhead, there's exactly one row
    ever, full stop; the service layer always operates on "the first row,
    creating it if it doesn't exist yet" rather than looking one up by an
    id the caller has to know.

    google_tiles_api_key mirrors config.py's own google_tiles_api_key
    Settings field (the .env-based path, still supported as a fallback
    default for ops-managed deployments) — the DB value here wins
    whenever it's set; see api/site_context.py's own GET /tiles-key for
    the actual precedence. Kept as its own single-purpose table rather
    than folded into an existing model so a future second app-wide
    setting doesn't have to retrofit an unrelated table."""

    __tablename__ = "app_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    google_tiles_api_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
