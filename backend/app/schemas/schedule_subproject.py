from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ScheduleSubprojectBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    owning_party_org_id: uuid.UUID | None = None
    root_wbs_id: uuid.UUID


class ScheduleSubprojectCreate(ScheduleSubprojectBase):
    project_id: uuid.UUID


class ScheduleSubprojectUpdate(ScheduleSubprojectBase):
    pass


class ScheduleSubprojectResponse(ScheduleSubprojectBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
