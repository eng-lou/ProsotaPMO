from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class ProjectCreate(BaseModel):
    name: str
    client_name: str | None = None
    status: str = "active"
    gfa_m2: Decimal | None = None
    space_count: int | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    client_name: str | None = None
    status: str | None = None
    gfa_m2: Decimal | None = None
    space_count: int | None = None


class ProjectDuplicateRequest(BaseModel):
    # Optional — app/api/projects.py falls back to f"{original.name} (Copy)"
    # when omitted, matching the frontend's own default suggestion.
    name: str | None = None


class ProjectResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    org_id: uuid.UUID
    created_by: uuid.UUID
    name: str
    client_name: str | None
    status: str
    gfa_m2: Decimal | None
    space_count: int | None
    created_at: datetime
    updated_at: datetime
