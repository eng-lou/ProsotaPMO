from __future__ import annotations

import uuid

from pydantic import BaseModel


class P6ImportSummaryResponse(BaseModel):
    schedule_variant_id: uuid.UUID
    schedule_period_id: uuid.UUID
    variant_name: str
    calendar_count: int
    resource_count: int
    activity_count: int
    relationship_count: int
    assignment_count: int
    udf_value_count: int
    # Human-readable notes on anything skipped or approximated during
    # parsing/import — never silently dropped, see
    # app/services/p6_import.py's own P6ImportSummary docstring.
    skipped: list[str]
