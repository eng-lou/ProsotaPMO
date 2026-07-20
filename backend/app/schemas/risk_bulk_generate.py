from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.schemas.risk import RiskType, _validate_response_strategy


# "Generate Risk Register" (2026-07-17, per Maro: "generate the risks from
# [the schedule/resources/cost data]. cost risks and general ones. understand
# the scope and draft" — the fourth and final stage of the schedule ->
# resources -> cost -> risk pipeline). Same "frontend computes, backend just
# persists" split every other *_bulk_generate endpoint already follows: the
# actual risk catalog (which risks, for which disciplines actually present in
# this project, with what probability/impact/cost/schedule estimate) is
# entirely a frontend concern (frontend/src/modules/risks/riskGeneration.ts)
# — this endpoint only validates, computes rating/EMV the exact same way a
# normal single risk create does (app/services/risk.py:_apply_computed_fields,
# reused verbatim here), and persists.
class BulkRiskInput(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    category: str | None = None
    area: str | None = None
    risk_type: RiskType = "threat"
    response_strategy: str | None = None
    cause: str | None = None
    effect: str | None = None
    rationale: str | None = None
    probability: Decimal | None = Field(default=None, ge=0, le=1)
    impact: Decimal | None = Field(default=None, ge=0, le=1)
    cost_most_likely: Decimal | None = None
    schedule_most_likely_days: int | None = None

    @model_validator(mode="after")
    def _check_response_strategy(self) -> "BulkRiskInput":
        _validate_response_strategy(self.risk_type, self.response_strategy)
        return self


class RiskBulkGenerateRequest(BaseModel):
    project_id: uuid.UUID
    period_id: uuid.UUID
    risks: list[BulkRiskInput] = []
    # Same idempotency reasoning as cost_bulk_generate.py's own
    # dedupe_by_description — re-running this after the schedule changes
    # shouldn't spawn a second "Material Price Escalation" risk every time.
    dedupe_by_title: bool = True
    # Rolls every newly-created threat's emv_cost into one Contingency
    # CostElement (2026-07-17, per Maro's own original framing: "a risk
    # adjusted schedule/CRA applied to get our contingency which will feed
    # into the costing") — a percentage-type element whose rate is set,
    # once, to (sum of |emv_cost| across this run's new threats) / (sum of
    # every existing FIXED cost element's budget), the project's own real
    # cost baseline. Skipped entirely (not created with a bogus 0% rate) if
    # either side of that fraction is zero/missing — see the service's own
    # docstring on why a contingency rate with no real baseline underneath
    # it is worse than not creating the line at all.
    sync_contingency: bool = True


class RiskBulkGenerateResponse(BaseModel):
    # Actually-inserted new Risk rows — can be less than len(request.risks)
    # when dedupe_by_title reused an existing one by title instead.
    risk_count: int
    risk_ids: list[uuid.UUID]
    # Total EMV cost the newly-created risks contribute (sum of emv_cost
    # across threats, positive magnitude) — 0 if sync_contingency was False
    # or nothing new was created.
    total_emv_cost: Decimal
    # Set only when sync_contingency actually created/updated a Contingency
    # line — None otherwise (no fixed-cost baseline yet, or no new risks).
    contingency_cost_element_id: uuid.UUID | None = None
    contingency_rate: Decimal | None = None
