from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.cost_element import ElementType


# "Generate Cost Plan" (2026-07-17, per Maro: "full costing in costing" — the
# third stage of the schedule -> resources -> cost -> risk pipeline, same
# "frontend computes, backend just persists" split schedule_bulk_generate.py
# already established). Resource-loaded fixed CostElements already flow in
# live and automatically via cost_sync.py the moment an activity gets a
# resource assignment (Auto Assign Resources already triggers this — nothing
# new needed there). This endpoint only ever adds the non-resource-loaded
# on-cost lines (Prelims, Design Fees, Overhead, Inflation, and later
# Contingency once Risk generation supplies a real EMV-derived rate) that
# nothing auto-creates on its own.
class BulkCostElementInput(BaseModel):
    element_type: ElementType = "percentage"
    rate: Decimal | None = Field(default=None, ge=-1, le=10)
    element_group: str | None = None
    description: str = Field(min_length=1, max_length=500)
    cost_owner: str | None = None


class CostBulkGenerateRequest(BaseModel):
    project_id: uuid.UUID
    period_id: uuid.UUID
    elements: list[BulkCostElementInput] = []
    # Reuses an existing element by (project_id, description) instead of
    # creating a duplicate — same "Generate Resources" idempotency reasoning
    # (schedule_bulk_generate.py's own dedupe_resources_by_name) applied
    # here: re-running this after tweaking the schedule shouldn't spawn a
    # second "Prelims" line every time. Defaults True (unlike schedule_bulk_
    # generate's own default False) since this endpoint has no other caller
    # that would need the old create-always behaviour — every real call site
    # is this same repeatable "Generate Cost Plan" action.
    dedupe_by_description: bool = True


class CostBulkGenerateResponse(BaseModel):
    # Actually-inserted new CostElement rows — can be less than
    # len(request.elements) when dedupe_by_description reused an existing
    # one by name instead.
    element_count: int
    element_ids: list[uuid.UUID]
