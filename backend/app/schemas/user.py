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
