from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.cost_element import CostElement
from app.models.period import Period
from app.models.risk import Risk
from app.schemas.risk_bulk_generate import RiskBulkGenerateRequest, RiskBulkGenerateResponse
from app.services.reference_codes import next_code, next_codes_batch
from app.services.risk import _apply_computed_fields

_CONTINGENCY_DESCRIPTION = "Contingency (Risk-Derived)"
_RATE_QUANT = Decimal("0.000001")  # matches CostElement.rate's Numeric(8, 6)


async def _require_live_period(db: AsyncSession, period_id: uuid.UUID) -> None:
    period = await db.get(Period, period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Period not found")
    if period.freeze_status != "live":
        raise HTTPException(
            status_code=422,
            detail=f"Period '{period.period_label}' is {period.freeze_status}. Writes to frozen periods are not allowed.",
        )


async def bulk_generate(db: AsyncSession, data: RiskBulkGenerateRequest) -> RiskBulkGenerateResponse:
    await _require_live_period(db, data.period_id)

    to_create = data.risks
    if data.dedupe_by_title and data.risks:
        existing_result = await db.execute(
            select(Risk.title).where(
                Risk.project_id == data.project_id,
                Risk.title.in_({r.title for r in data.risks}),
            )
        )
        existing_titles = {row[0] for row in existing_result.all()}
        to_create = [r for r in data.risks if r.title not in existing_titles]

    created_ids: list[uuid.UUID] = []
    total_emv_cost = Decimal("0")
    codes = await next_codes_batch(db, Risk, "RSK", data.project_id, len(to_create))
    for r, code in zip(to_create, codes):
        risk = Risk(
            id=uuid.uuid4(), project_id=data.project_id, period_id=data.period_id, code=code,
            title=r.title, category=r.category, area=r.area, status="open",
            risk_type=r.risk_type, response_strategy=r.response_strategy,
            cause=r.cause, effect=r.effect, rationale=r.rationale,
            probability=r.probability, impact=r.impact,
            cost_most_likely=r.cost_most_likely, schedule_most_likely_days=r.schedule_most_likely_days,
        )
        # Same computation a normal single risk create goes through
        # (app/services/risk.py) — rating/EMV are never accepted as input,
        # always derived from probability/impact/cost/schedule here too.
        _apply_computed_fields(risk)
        db.add(risk)
        created_ids.append(risk.id)
        if risk.risk_type == "threat" and risk.emv_cost is not None:
            total_emv_cost += -risk.emv_cost  # emv_cost is already negative for a threat; store as a positive magnitude

    contingency_id: uuid.UUID | None = None
    contingency_rate: Decimal | None = None
    # Rolls this run's new threats into one Contingency CostElement — skipped
    # (not created with a meaningless rate) unless both a real EMV total AND
    # a real fixed-cost baseline exist (2026-07-17, per Maro's own "CRA
    # applied to get our contingency which will feed into the costing"
    # framing — see the schema's own docstring on why zero on either side
    # means skip, not "create a 0% line").
    if data.sync_contingency and total_emv_cost > 0:
        fixed_total_result = await db.execute(
            select(func.sum(CostElement.budget)).where(
                CostElement.project_id == data.project_id, CostElement.element_type == "fixed",
            )
        )
        fixed_total = fixed_total_result.scalar()
        if fixed_total and fixed_total > 0:
            contingency_rate = (total_emv_cost / fixed_total).quantize(_RATE_QUANT, rounding=ROUND_HALF_UP)
            # Clamped to CostElement.rate's own schema bound (ge=-1, le=10) —
            # an EMV total that would imply a >1000% contingency almost
            # certainly means the fixed-cost baseline itself isn't populated
            # yet (Auto Assign Resources not run), not a real number to
            # persist as-is.
            if contingency_rate <= Decimal("10"):
                existing_contingency = (await db.execute(
                    select(CostElement).where(
                        CostElement.project_id == data.project_id,
                        CostElement.description == _CONTINGENCY_DESCRIPTION,
                    )
                )).scalar_one_or_none()
                if existing_contingency is not None:
                    # Re-running risk generation later (more elements linked,
                    # more risks drafted) should refresh the contingency
                    # figure to match the latest EMV total, not silently
                    # leave a stale rate behind the same way
                    # dedupe_by_title/dedupe_resources_by_name intentionally
                    # DON'T touch an existing row's other fields — this one
                    # rate is the entire point of the line, so it's the one
                    # exception that's kept live-synced rather than frozen
                    # on first generation.
                    existing_contingency.rate = contingency_rate
                    contingency_id = existing_contingency.id
                else:
                    code = await next_code(db, CostElement, "CST", data.project_id)
                    contingency = CostElement(
                        id=uuid.uuid4(), project_id=data.project_id, period_id=data.period_id, code=code,
                        element_type="percentage", rate=contingency_rate,
                        element_group="Risk", description=_CONTINGENCY_DESCRIPTION, source="manual",
                    )
                    db.add(contingency)
                    contingency_id = contingency.id

    await db.commit()
    return RiskBulkGenerateResponse(
        risk_count=len(created_ids), risk_ids=created_ids, total_emv_cost=total_emv_cost,
        contingency_cost_element_id=contingency_id, contingency_rate=contingency_rate,
    )
