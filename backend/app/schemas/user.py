from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    email: str
    display_name: str
    role: str
    status: str
    is_super_user: bool
    requested_title: str | None
    requested_organisation: str | None
    requested_at: datetime | None
    last_active_at: datetime | None
    created_at: datetime
    updated_at: datetime


class AccessRequestSubmit(BaseModel):
    name: str
    title: str
    organisation: str | None = None


class PendingUserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    requested_title: str | None
    requested_organisation: str | None
    requested_at: datetime | None
    created_at: datetime


class CurrentUserSummaryResponse(BaseModel):
    """Access Manager's "current users" list (2026-08-25) — deliberately
    lighter than UserResponse (no org_id, updated_at). requested_title/
    requested_organisation *are* included despite the name (2026-08-30, per
    Maro: "i still want to see their role/organisation details" for
    already-approved users too, not just pending ones) — they're captured
    once at request time and never cleared on approval, so they're still
    real, current values for an approved user, just named after how they
    were originally collected."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    display_name: str
    role: str
    is_super_user: bool
    requested_title: str | None
    requested_organisation: str | None
    last_active_at: datetime | None
    total_active_seconds: int
    created_at: datetime
