from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)

    @field_validator('*', mode='after')
    @classmethod
    def project_time(cls, value):
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value


class Window(Strict):
    start: datetime
    end: datetime

    @model_validator(mode='after')
    def ordered(self):
        if self.end <= self.start:
            raise ValueError('Window end must follow its start')
        return self


class Demand(Strict):
    resource_id: str
    units: int = Field(default=1, ge=1, le=100)


class SimResource(Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    source_resource_id: str | None = None
    kind: Literal['equipment', 'crew', 'space'] = 'equipment'
    capacity: int = Field(default=1, ge=1, le=100)
    calendar_id: str | None = None
    hourly_cost: float | None = Field(default=None, ge=0, le=1000000)
    model_ref: str | None = None


class StepLink(Strict):
    step_id: str
    any_group: str | None = None  # An SS activity starts when any of its steps starts.
    release_fraction: float = Field(default=1, gt=0, le=1)
    relation: Literal['finish', 'start'] = 'finish'
    lag_basis: Literal['elapsed', 'working'] = 'elapsed'
    lag_hours: float = Field(default=0, ge=0, le=100000)
    programme_relationship_id: str | None = None
    treatment: Literal['additional', 'refines'] = 'additional'


class Gate(Strict):
    name: str = Field(min_length=1, max_length=200)
    kind: Literal['physical', 'approval', 'material', 'access', 'space'] = 'physical'
    status: Literal['ready', 'pending', 'assumed'] = 'ready'
    available_from: datetime | None = None
    owner: str = Field(default='', max_length=200)
    source: str = Field(default='', max_length=1000)


class Pose(Strict):
    position: tuple[float, float, float] = (0, 0, 0)
    rotation: tuple[float, float, float] = (0, 0, 0)


class ObjectState(Strict):
    model_ref: str
    element_id: str | None = None  # IFC GlobalId, never a transient express ID
    state: Literal['delivered', 'waiting', 'attached', 'moving', 'placed', 'installed'] = 'moving'
    from_pose: Pose = Field(default_factory=Pose)
    to_pose: Pose = Field(default_factory=Pose)
    carrier_ref: str | None = None
    carrier_part: str | None = None
    attachment: Pose = Field(default_factory=Pose)


class BucketLoading(Strict):
    capacity_m3: float = Field(gt=0, le=1000)
    fill_factor: float = Field(default=1, gt=0, le=2)
    cycle_seconds: float = Field(gt=0, le=86400)


class Phase(Strict):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    hours: float | None = Field(default=None, ge=0, le=100000)
    resources: list[Demand] = Field(default_factory=list, max_length=20)
    state: str = Field(default='working', max_length=80)
    route_id: str | None = None
    speed_mps: float | None = Field(default=None, gt=0, le=100)
    object_states: list[ObjectState] = Field(default_factory=list, max_length=100)
    bucket_loading: BucketLoading | None = None


class WorkerRoute(Strict):
    id: str
    # Original route geometry is checked against the project before execution.
    geometry: dict
    samples: list[tuple[float, float, float]] = Field(min_length=2, max_length=513)
    length_m: float = Field(gt=0, le=100000)


class WorkerMethod(Strict):
    version: Literal[1] = 1
    kind: Literal['walk_work_continue'] = 'walk_work_continue'
    worker_id: str
    worker_asset_id: str
    tool_id: str
    tool_asset_id: str
    route_id: str
    route: WorkerRoute | None = None
    idle_clip: str = Field(min_length=1, max_length=300)
    walk_clip: str = Field(min_length=1, max_length=300)
    work_clip: str = Field(min_length=1, max_length=300)
    work_position: float = Field(default=50, ge=0, le=100)
    speed_mps: float = Field(default=1.2, gt=0, le=5)
    stride_mps: float = Field(default=1.2, gt=0, le=5)
    work_seconds: float = Field(default=10, gt=0, le=86400)
    heading: float = Field(default=0, ge=-360, le=360)
    hand: str = Field(min_length=1, max_length=300)
    grip: Pose = Field(default_factory=Pose)  # metres / degrees in hand axes
    tool_during: Literal['work', 'whole_method'] = 'work'

    @model_validator(mode='after')
    def distinct_roles(self):
        if self.worker_id == self.tool_id:
            raise ValueError('Choose different objects for worker and tool')
        if self.route and self.route.id != self.route_id:
            raise ValueError('Rebuild the method route snapshot')
        return self


class SimStep(Strict):
    id: str = Field(min_length=1, max_length=100)
    source_step_id: str | None = None
    activity_id: str
    name: str = Field(min_length=1, max_length=200)
    basis: Literal['illustrative', 'fixed', 'rate', 'cycle'] = 'fixed'
    hours: float | None = Field(default=None, ge=0, le=100000)
    quantity: float | None = Field(default=None, ge=0, le=1e12)
    completed_quantity: float = Field(default=0, ge=0, le=1e12)
    unit: Literal['nr', 'm', 'm2', 'm3', 't', 'kg'] = 'nr'
    rate_per_hour: float | None = Field(default=None, gt=0, le=1e12)
    cycle_quantity: float | None = Field(default=None, gt=0, le=1e12)
    phases: list[Phase] = Field(default_factory=list, max_length=20)
    resources: list[Demand] = Field(default_factory=list, max_length=20)
    hold_resources: list[Demand] = Field(default_factory=list, max_length=10)
    dependencies: list[StepLink] = Field(default_factory=list, max_length=200)
    conditions: list[Gate] = Field(default_factory=list, max_length=30)
    access_windows: list[Window] = Field(default_factory=list, max_length=200)
    access_required: bool = False
    resumable: bool = True
    priority: int = Field(default=0, ge=-100, le=100)
    earliest_start: datetime | None = None
    is_complete: bool = False
    assumptions: str = Field(default='', max_length=4000)
    object_states: list[ObjectState] = Field(default_factory=list, max_length=100)
    worker_method: WorkerMethod | None = None


class Disruption(Strict):
    id: str
    name: str = Field(min_length=1, max_length=200)
    target: Literal['resource', 'step']
    target_id: str
    kind: Literal['outage', 'productivity'] = 'outage'
    start: datetime
    end: datetime | None = None
    unavailable_units: int = Field(default=1, ge=1, le=100)
    factor: float = Field(default=0.5, gt=0, le=10)

    @model_validator(mode='after')
    def valid_end(self):
        if self.end is not None and self.end <= self.start:
            raise ValueError('Disruption end must follow its start')
        return self


class SimulationConfig(Strict):
    activity_ids: list[str] = Field(min_length=1, max_length=300)
    start: datetime
    horizon_days: int = Field(default=365, ge=1, le=730)
    steps: list[SimStep] = Field(default_factory=list, max_length=500)
    resources: list[SimResource] = Field(default_factory=list, max_length=200)
    disruptions: list[Disruption] = Field(default_factory=list, max_length=200)
    assumptions: str = Field(default='', max_length=8000)
    boundary_policy: Literal['reserve', 'assume_available'] = 'reserve'

    @model_validator(mode='after')
    def references(self):
        ids={s.id for s in self.steps}; resources={r.id for r in self.resources}
        if len(ids)!=len(self.steps) or len(resources)!=len(self.resources) or len(set(self.activity_ids))!=len(self.activity_ids):
            raise ValueError('Activity, step and resource IDs must be unique')
        if any(r.startswith('@actor:') for r in resources):
            raise ValueError('Reserved scene actor resource ID')
        workers={s.worker_method.worker_id for s in self.steps if s.worker_method}
        tools={s.worker_method.tool_id for s in self.steps if s.worker_method}
        if workers & tools:
            raise ValueError('A scene object cannot act as both worker and tool in this scenario')
        owned={'site:'+key for key in workers|tools}
        for s in self.steps:
            for h in [*s.object_states,*[h for p in s.phases for h in p.object_states]]:
                if h.model_ref in owned or h.carrier_ref in owned:
                    raise ValueError('A worker method owns this object; remove its separate element handling in this scenario')
        for s in self.steps:
            if s.worker_method and (s.basis not in ('fixed', 'illustrative') or s.object_states or s.phases):
                raise ValueError('A worker method owns its three phases; use a separate step for other handling or cycles')
            if any(p.bucket_loading for p in s.phases) and (s.basis!='cycle' or s.unit!='m3'):
                raise ValueError('Bucket-derived loading requires a cycle with quantities in m3')
            if any(p.bucket_loading and p.route_id for p in s.phases):
                raise ValueError('Choose bucket loading or route timing for a phase, not both')
            if len({p.id for p in s.phases}) != len(s.phases): raise ValueError('Phase IDs must be unique within a step')
            if s.activity_id not in self.activity_ids: raise ValueError('Step is outside the selected scope')
            if s.completed_quantity > (s.quantity if s.quantity is not None else 1e12): raise ValueError('Completed quantity exceeds total')
            if any(d.step_id not in ids or d.step_id==s.id for d in s.dependencies): raise ValueError('Choose another existing step as predecessor')
            for reqs in [s.resources,s.hold_resources,*[p.resources for p in s.phases]]:
                if len({r.resource_id for r in reqs})!=len(reqs): raise ValueError('Duplicate resource requirement')
                if any(r.resource_id not in resources for r in reqs): raise ValueError('Unknown resource requirement')
        edges={s.id:[d.step_id for d in s.dependencies] for s in self.steps}; visited=set(); stack=set()
        def visit(key):
            if key in stack: raise ValueError('Step dependencies contain a cycle')
            if key in visited:return
            stack.add(key)
            for other in edges[key]:visit(other)
            stack.remove(key);visited.add(key)
        for key in ids:visit(key)
        for d in self.disruptions:
            if d.target_id not in (ids if d.target=='step' else resources): raise ValueError('Disruption target is missing')
        return self


class ScenarioCreate(Strict):
    project_id: str
    schedule_period_id: str
    name: str = Field(min_length=1, max_length=200)
    config: SimulationConfig


class ScenarioUpdate(Strict):
    revision: int
    name: str = Field(min_length=1, max_length=200)
    config: SimulationConfig


class ApplySimulation(Strict):
    revision: int
    activity_ids: list[str] = Field(min_length=1, max_length=300)
    rationale: str = Field(min_length=1, max_length=4000)
