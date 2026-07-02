from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ResourceType = Literal["labour", "equipment", "material", "subcontractor"]


class ResourceBase(BaseModel):
    resource_type: ResourceType
    name: str
    unit: str
    rate: Decimal = Field(ge=0)
    max_hours_per_day: Decimal = Field(default=Decimal("8"), gt=0, le=24)


class ResourceCreate(ResourceBase):
    project_id: uuid.UUID


class ResourceUpdate(BaseModel):
    resource_type: ResourceType | None = None
    name: str | None = None
    unit: str | None = None
    rate: Decimal | None = Field(default=None, ge=0)
    max_hours_per_day: Decimal | None = Field(default=None, gt=0, le=24)


class ResourceResponse(ResourceBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime


class ResourceAssignmentBase(BaseModel):
    resource_id: uuid.UUID
    role: str | None = None
    # Which of these is required depends on the resource's type — enforced in
    # app/services/resource_assignment.py, not here (a partial PATCH can't tell
    # "not sent" from "not applicable to this resource type" at the schema level).
    # labour/equipment use utilisation_pct; material uses quantity; subcontractor
    # uses neither. See app/models/resource_assignment.py.
    quantity: Decimal | None = Field(default=None, gt=0)
    utilisation_pct: Decimal | None = Field(default=None, gt=0, le=100)


class ResourceAssignmentCreate(ResourceAssignmentBase):
    activity_id: uuid.UUID


class ResourceAssignmentUpdate(BaseModel):
    role: str | None = None
    quantity: Decimal | None = Field(default=None, gt=0)
    utilisation_pct: Decimal | None = Field(default=None, gt=0, le=100)


class ResourceAssignmentResponse(ResourceAssignmentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    activity_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Denormalized from the linked Resource for display convenience — never
    # accepted as input, always refreshed from the resource at read time (see
    # app/services/resource_assignment.py). budget is computed, never stored.
    resource_name: str
    resource_type: ResourceType
    unit: str
    rate: Decimal
    max_hours_per_day: Decimal
    budget: Decimal
