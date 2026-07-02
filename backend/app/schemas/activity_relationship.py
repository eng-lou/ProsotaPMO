from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

RelationshipType = Literal["FS", "SS", "FF", "SF"]


class ActivityRelationshipBase(BaseModel):
    predecessor_id: uuid.UUID
    successor_id: uuid.UUID
    relationship_type: RelationshipType = "FS"
    # Positive = lag (wait after the trigger event), negative = lead (overlap).
    lag_days: int = 0


class ActivityRelationshipCreate(ActivityRelationshipBase):
    pass


class ActivityRelationshipUpdate(BaseModel):
    # predecessor_id/successor_id are not editable — delete and recreate to change
    # the endpoints of a link, same as every other sub-list in this codebase.
    relationship_type: RelationshipType | None = None
    lag_days: int | None = None


class ActivityRelationshipResponse(ActivityRelationshipBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
