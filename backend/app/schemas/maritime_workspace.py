from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


Name = Annotated[str, Field(min_length=1, max_length=120, pattern=r'.*\S.*')]
Hours = Annotated[float, Field(ge=0, le=336)]


class ElementRef(StrictModel):
    source_kind: Literal['ifc', 'mesh', 'ifc_split']
    element_ref: str = Field(min_length=1, max_length=500)
    element_label: str = Field(default='', max_length=500)


class Asset(StrictModel):
    id: UUID
    name: Name
    kind: Literal['berth', 'crane', 'truck', 'yard', 'gate', 'vessel', 'infrastructure']
    rate: float = Field(default=30, ge=0, le=10000)
    capacity: float = Field(default=1000, ge=0, le=1000000)
    initial_stock: float = Field(default=0, ge=0, le=1000000)
    hourly_cost: float = Field(default=0, ge=0, le=1000000)
    elements: list[ElementRef] = Field(default_factory=list, max_length=10000)
    resource_id: UUID | None = None
    activity_id: UUID | None = None
    notes: str = Field(default='', max_length=4000)

    @model_validator(mode='after')
    def stock_limit(self):
        if self.initial_stock > self.capacity:
            raise ValueError('Initial stock exceeds capacity')
        return self


class VesselCall(StrictModel):
    id: UUID
    name: Name
    vessel_id: UUID
    berth_id: UUID
    crane_ids: list[UUID] = Field(min_length=1, max_length=20)
    arrival_hour: Hours = 0
    cargo_moves: int = Field(default=1200, ge=1, le=1000000)


class Downtime(StrictModel):
    asset_id: UUID
    start_hour: Hours = 8
    duration_hours: float = Field(default=6, gt=0, le=336)


class Scenario(StrictModel):
    id: UUID
    name: Name
    downtime: list[Downtime] = Field(default_factory=list, max_length=100)


class WorkOrder(StrictModel):
    id: UUID
    name: Name
    asset_id: UUID
    start_hour: Hours = 8
    duration_hours: float = Field(default=2, gt=0, le=336)
    cost: float = Field(default=0, ge=0, le=10000000)
    status: Literal['draft', 'scheduled', 'complete'] = 'draft'
    notes: str = Field(default='', max_length=4000)


class Exercise(StrictModel):
    id: UUID
    name: Name
    asset_id: UUID
    hazard: str = Field(default='Lifting zone intrusion', min_length=1, max_length=500)
    required_actions: list[Name] = Field(default_factory=lambda: ['Identify hazard', 'Stop lift', 'Secure zone', 'Notify supervisor'], min_length=1, max_length=20)
    response_limit_seconds: int = Field(default=60, ge=1, le=3600)


class WorkspaceDefinition(StrictModel):
    currency: str = Field(default='GBP', pattern=r'^[A-Z]{3}$')
    source: Literal['synthetic', 'user_entered'] = 'user_entered'
    start_at: datetime = Field(default_factory=lambda: datetime.fromisoformat('2026-10-19T08:00:00+00:00'))
    horizon_hours: int = Field(default=72, ge=1, le=336)
    assets: list[Asset] = Field(default_factory=list, max_length=250)
    calls: list[VesselCall] = Field(default_factory=list, max_length=100)
    scenarios: list[Scenario] = Field(default_factory=list, max_length=100)
    work_orders: list[WorkOrder] = Field(default_factory=list, max_length=250)
    exercises: list[Exercise] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def references(self):
        if self.start_at.tzinfo is None:
            raise ValueError('Start time must include a timezone')
        for collection in (self.assets, self.calls, self.scenarios, self.work_orders, self.exercises):
            if len({x.id for x in collection}) != len(collection):
                raise ValueError('Duplicate record identifier')
        assets = {a.id: a for a in self.assets}
        def require(id, kind=None):
            if id not in assets or (kind and assets[id].kind != kind):
                raise ValueError(f'Asset reference must resolve to {kind or "an asset"}')
        for call in self.calls:
            require(call.vessel_id, 'vessel'); require(call.berth_id, 'berth')
            if len(set(call.crane_ids)) != len(call.crane_ids):
                raise ValueError('Duplicate crane assignment')
            for id in call.crane_ids:
                require(id, 'crane')
        for scenario in self.scenarios:
            for d in scenario.downtime:
                require(d.asset_id)
                if assets[d.asset_id].kind not in ('crane', 'truck', 'gate', 'berth'):
                    raise ValueError('Availability restrictions support cranes, trucks, gates and berths')
        for order in self.work_orders:
            require(order.asset_id)
            if assets[order.asset_id].kind not in ('crane', 'truck', 'gate', 'berth'):
                raise ValueError('Maintenance availability supports cranes, trucks, gates and berths')
        for exercise in self.exercises:
            require(exercise.asset_id)
            if len(set(exercise.required_actions)) != len(exercise.required_actions):
                raise ValueError('Exercise actions must be unique')
        return self


class WorkspaceSave(StrictModel):
    version: int = Field(ge=0)
    definition: WorkspaceDefinition


class RunRequest(StrictModel):
    version: int = Field(ge=1)
    scenario_id: UUID | None = None


class AttemptAction(StrictModel):
    action: Name
    seconds: float = Field(ge=0, le=86400)


class AttemptRequest(StrictModel):
    version: int = Field(ge=1)
    exercise_id: UUID
    actions: list[AttemptAction] = Field(max_length=200)
