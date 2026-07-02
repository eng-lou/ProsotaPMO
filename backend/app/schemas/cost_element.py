from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

ElementType = Literal["fixed", "percentage"]
# Workflow status only. Over Budget/Monitor/On Budget/Saving is a computed variance-band
# badge (see CostVarianceCriterion, Phase 3), not a stored status; Applied % is auto-shown
# for percentage-type elements.
CostElementStatus = Literal["approved", "cr_pending", "tbc", "credit"]


class CostElementBase(BaseModel):
    element_type: ElementType = "fixed"
    # Negative allowed (up to -100%) so a percentage element can represent a genuine
    # credit/deduction (e.g. Market Conditions Deduction), not just a positive on-cost.
    rate: Decimal | None = Field(default=None, ge=-1, le=10)
    element_group: str | None = None
    description: str
    cost_owner: str | None = None
    status: CostElementStatus | None = None
    scope_note: str | None = None
    variance_commentary: str | None = None
    qs_signoff_name: str | None = None
    qs_signoff_date: date | None = None
    budget: Decimal | None = None
    actuals: Decimal | None = None
    # Physical progress (0-100) — the real EVM input; see CostElement model docstring.
    pct_complete: int | None = Field(default=None, ge=0, le=100)
    last_reviewed_date: date | None = None

    @model_validator(mode="after")
    def validate_type_fields(self) -> "CostElementBase":
        if self.element_type == "percentage" and self.rate is None:
            raise ValueError("rate is required for percentage elements")
        if self.element_type == "fixed" and self.rate is not None:
            raise ValueError("rate must be null for fixed elements")
        return self


class CostElementCreate(CostElementBase):
    project_id: uuid.UUID
    period_id: uuid.UUID


class CostElementUpdate(BaseModel):
    element_type: ElementType | None = None
    rate: Decimal | None = Field(default=None, ge=-1, le=10)
    element_group: str | None = None
    description: str | None = None
    cost_owner: str | None = None
    status: CostElementStatus | None = None
    scope_note: str | None = None
    variance_commentary: str | None = None
    qs_signoff_name: str | None = None
    qs_signoff_date: date | None = None
    budget: Decimal | None = None
    actuals: Decimal | None = None
    pct_complete: int | None = Field(default=None, ge=0, le=100)
    last_reviewed_date: date | None = None


class CostElementResponse(CostElementBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    code: str
    project_id: uuid.UUID
    period_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    # Resources module (Phase 2) — never accepted as create/update input, always
    # server-managed. See app/services/cost_sync.py.
    source: Literal["manual", "schedule"] = "manual"
    linked_activity_id: uuid.UUID | None = None
    # Populated at query time for percentage elements; None for fixed elements
    computed_budget: Decimal | None = None
    computed_forecast: Decimal | None = None
    computed_actuals: Decimal | None = None
    # Cost-side EVM, computed server-side — never accepted as input (same discipline as
    # Risk's EMV fix). AC = actuals, EV = BAC x pct_complete/100, BAC = budget.
    # Schedule-side EVM (SV/SPI) is deliberately not exposed — see cost_element service.
    # forecast = EAC once progress has been assessed (they're the same concept — "what do
    # we now expect this line to finally cost"); budget is the best available forecast
    # before then. No longer a separate manual input.
    forecast: Decimal | None = None
    # rev_a_baseline is set ONCE, automatically, to whatever budget was at creation —
    # it IS the original budget, not a second figure to type in. It's then frozen
    # (never touched by routine budget updates) so variance stays meaningful; a genuine
    # re-baseline is a distinct, deliberate action, not implemented yet.
    rev_a_baseline: Decimal | None = None
    variance: Decimal | None = None
    cost_per_m2: Decimal | None = None
    cv: Decimal | None = None
    cpi: Decimal | None = None
    eac: Decimal | None = None
    etc: Decimal | None = None
    vac: Decimal | None = None
    tcpi: Decimal | None = None
    # Schedule-side EVM (Resources module, Phase 3) — only computable for a
    # "schedule"-sourced element whose linked activity has captured baseline dates
    # (bl_start/bl_finish); null otherwise, same "leave it blank rather than show a
    # fake number" discipline used everywhere else. See app/services/cost_element.py.
    pv: Decimal | None = None
    ev: Decimal | None = None
    sv: Decimal | None = None
    spi: Decimal | None = None
