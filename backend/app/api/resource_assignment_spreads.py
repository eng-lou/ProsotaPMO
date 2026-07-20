from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.resource import ResourceAssignmentResponse
from app.schemas.resource_assignment_spread import (
    ResourceSpreadBatchResponse,
    ResourceSpreadBulkFetch,
    ResourceSpreadResponse,
    SpreadRangeUpdate,
)
from app.services import resource_assignment_spread as svc

router = APIRouter(prefix="/resource-assignment-spreads", tags=["resource-assignment-spreads"])


@router.get("/", response_model=ResourceSpreadResponse)
async def get_spread(
    resource_id: uuid.UUID,
    start: date,
    end: date,
    db: AsyncSession = Depends(get_db),
):
    days, cells = await svc.get_spread_for_resource(db, resource_id, start, end)
    return {"days": days, "cells": cells}


@router.post("/bulk-fetch", response_model=ResourceSpreadBatchResponse)
async def bulk_fetch_spreads(
    data: ResourceSpreadBulkFetch,
    db: AsyncSession = Depends(get_db),
):
    """One shared calendar-lookup build across every requested resource,
    instead of the Resources tab's old one-HTTP-request-per-resource pattern
    (2026-07-17 perf fix) — see get_spreads_for_resources' own header."""
    results = await svc.get_spreads_for_resources(db, data.resource_ids, data.start, data.end)
    return {
        "spreads": {str(rid): {"days": days, "cells": cells} for rid, (days, cells) in results.items()},
    }


@router.patch("/", status_code=204)
async def set_spread_range(
    data: SpreadRangeUpdate,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.set_spread_range(db, data.resource_assignment_id, data.period_start, data.period_end, data.total_hours)
    return Response(status_code=204)


@router.post("/{resource_assignment_id}/recalculate-costs", response_model=ResourceAssignmentResponse)
async def recalculate_costs(
    resource_assignment_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
):
    return await svc.recalculate_costs(db, resource_assignment_id)
