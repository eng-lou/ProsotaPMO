from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

# "cost_element" (not "cost") to match the actual model/table name — see
# app/models/cost_element.py. Risk/ICD could gain their own entity_type later
# the same way, not built ahead of that need (docs/SCHEDULING_GAPS_PLAN.md
# Phase 9).
UdfEntityType = Literal["activity", "resource", "cost_element"]

# Which of UserDefinedFieldValue's four value_* columns a definition's own
# values live in — see that model's own docstring.
UdfDataType = Literal["text", "number", "integer", "cost", "start_date", "finish_date", "indicator"]

# Fixed 8-state icon/colour set (2026-07-07, per Maro's own P6 reference
# screenshot) — not free text, since the whole point of "Indicator" is a
# picker of exactly these, each with its own colour/icon in the UI.
IndicatorValue = Literal[
    "none", "in_progress", "delayed", "at_risk", "problem", "paused", "cancelled", "completed"
]


class UserDefinedFieldDefinitionCreate(BaseModel):
    project_id: uuid.UUID
    entity_type: UdfEntityType
    name: str = Field(min_length=1, max_length=100)
    data_type: UdfDataType


class UserDefinedFieldDefinitionUpdate(BaseModel):
    """Rename and/or change the data type of an existing definition
    (2026-07-07, per Maro — "I want to be able to edit the custom field").
    Changing data_type clears every existing value under this definition —
    see app/services/user_defined_field.py:update_definition — since a value
    stored under the old type's column (e.g. value_text) has no meaningful
    equivalent under a different one (e.g. value_date); the frontend warns
    before sending a data_type change for a field that already has values."""
    name: str | None = Field(default=None, min_length=1, max_length=100)
    data_type: UdfDataType | None = None


class UserDefinedFieldDefinitionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    project_id: uuid.UUID
    entity_type: UdfEntityType
    name: str
    data_type: UdfDataType
    created_at: datetime
    updated_at: datetime


class UserDefinedFieldValueUpdate(BaseModel):
    """Exactly one of these four should be set, matching the target
    definition's own data_type — app/services/user_defined_field.py:set_value
    validates that server-side (the caller already knows the data_type from
    the definition it's editing a value for, so this isn't asking the client
    to guess). All four present as None is how a value gets cleared back to
    empty."""
    value_text: str | None = None
    value_number: Decimal | None = None
    value_date: datetime | None = None
    value_indicator: IndicatorValue | None = None

    @model_validator(mode="after")
    def only_one_value_set(self) -> "UserDefinedFieldValueUpdate":
        set_fields = [v for v in (self.value_text, self.value_number, self.value_date, self.value_indicator) if v is not None]
        if len(set_fields) > 1:
            raise ValueError("Only one of value_text/value_number/value_date/value_indicator may be set at a time")
        return self


class UserDefinedFieldValuesBulkFetch(BaseModel):
    """POST, not a GET with repeated query params — a grid page can easily
    have 100+ activities across several UDF columns at once, which would
    risk exceeding practical URL length limits as a query string."""
    field_definition_ids: list[uuid.UUID]
    record_ids: list[uuid.UUID]


class UserDefinedFieldValueResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    field_definition_id: uuid.UUID
    record_id: uuid.UUID
    value_text: str | None
    value_number: Decimal | None
    value_date: datetime | None
    value_indicator: str | None
