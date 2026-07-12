from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ElementParentBase(BaseModel):
    child_element_ref: str = Field(min_length=1, max_length=300)
    parent_element_ref: str = Field(min_length=1, max_length=300)


class ElementParentCreate(ElementParentBase):
    project_id: uuid.UUID


class ElementParentResponse(ElementParentBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
