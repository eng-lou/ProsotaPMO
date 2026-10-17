from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DeliveryScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start_date: date = Field(default=date(2026, 10, 19), ge=date(2020, 1, 1), le=date(2040, 12, 31))
    delay_days: int = Field(default=15, ge=0, le=90)
    delay_activity: Literal["foundation", "deck", "procurement", "installation", "commission"] = "foundation"
    overhead_day_rate: float = Field(default=1000, ge=0, le=100000, allow_inf_nan=False)


class OperationsScenario(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cargo: int = Field(default=1200, ge=1, le=100000)
    rate: float = Field(default=30, ge=1, le=120, allow_inf_nan=False)
    arrival: float = Field(default=2, ge=0, le=48, allow_inf_nan=False)
    breakdown: bool = True
    outageStart: float = Field(default=8, ge=0, le=120, allow_inf_nan=False)
    outageHours: float = Field(default=6, ge=0, le=48, allow_inf_nan=False)


class MaritimeMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class MaritimePoeRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    delivery: DeliveryScenario = Field(default_factory=DeliveryScenario)
    operations: OperationsScenario = Field(default_factory=OperationsScenario)
    history: list[MaritimeMessage] = Field(default_factory=list, max_length=8)
