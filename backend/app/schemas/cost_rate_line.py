from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict


class CostRateLineBase(BaseModel):
    description: str
    qty: Decimal
    unit: str | None = None
    rate: Decimal
    # location/system/activity — see CostRateLine.cost_code's own docstring.
    cost_code: str | None = None


class CostRateLineCreate(CostRateLineBase):
    cost_element_id: uuid.UUID


class CostRateLineUpdate(BaseModel):
    description: str | None = None
    qty: Decimal | None = None
    unit: str | None = None
    rate: Decimal | None = None


class CostRateLineResponse(CostRateLineBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cost_element_id: uuid.UUID
    # Computed (qty x rate) immediately after model_validate — never read from the ORM object.
    total: Decimal = Decimal("0")
    created_at: datetime
    updated_at: datetime
