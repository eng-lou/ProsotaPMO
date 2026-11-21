from typing import Literal
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class SlingLeg(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    point: int = Field(ge=0, le=7)
    parent_id: UUID
    node: str = Field(default='', max_length=256)
    length: float = Field(gt=0.001, le=10000)
    offset: tuple[float,float,float] = (0,0,0)
    capacity_kn: float | None = Field(default=None, gt=0, le=1000000)

    @model_validator(mode='after')
    def valid_offset(self):
        if any(abs(v)>1000 for v in self.offset):
            raise ValueError('Invalid rigging hook offset')
        return self

class LiftRig(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    legs: list[SlingLeg] = Field(min_length=1, max_length=8)
    mass_kg: float = Field(gt=0, le=100000000)
    floor: float | None = Field(default=None, ge=-1000000, le=1000000)

class LoadEvent(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: UUID
    date: str = Field(max_length=40)
    parent_id: UUID | None = None
    node: str = Field(default='', max_length=256)
    matrix: list[float] = Field(min_length=16, max_length=16)
    slings: bool = False
    rigging: LiftRig | None = None
    sling_offset: tuple[float, float, float] = (0,0,0)
    sling_ring_angle: float = Field(default=0, ge=-360, le=360)

    @model_validator(mode='after')
    def valid_event(self):
        if datetime.fromisoformat(self.date.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError('Load event time must include a timezone')
        if any(abs(v) > 1000 for v in self.sling_offset):
            raise ValueError('Invalid hook connection offset')
        if self.rigging and (not self.parent_id or not self.slings):
            raise ValueError("Rigging requires an attached sling event")
        m = self.matrix
        if any(abs(m[i]) > 1e-8 for i in (3, 7, 11)) or abs(m[15]-1) > 1e-8:
            raise ValueError('Load event requires an affine transform')
        determinant = m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2])
        if abs(determinant) < 1e-10 or any(abs(v) > 1000000 for v in m):
            raise ValueError('Invalid load event transform')
        return self


class LoadHandling(BaseModel):
    balance_mode: Literal['gravity','fixed'] = 'gravity'
    center_of_gravity: tuple[float,float,float] | None = None
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    events: list[LoadEvent] = Field(default_factory=list, max_length=200)
    lifting_points: list[tuple[float, float, float]] = Field(default_factory=list, max_length=8)

    lifting_nodes: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def unique_events(self):
        if self.center_of_gravity and any(abs(v)>1000000 for v in self.center_of_gravity):
            raise ValueError("Invalid centre of gravity")
        if self.lifting_nodes and len(self.lifting_nodes) != len(self.lifting_points):
            raise ValueError('Lifting node bindings must match point count')
        if any(len(n) > 256 for n in self.lifting_nodes):
            raise ValueError('Lifting node name too long')
        if any(leg.point >= len(self.lifting_points) for e in self.events if e.rigging for leg in e.rigging.legs):
            raise ValueError("Rigging references a missing lifting point")
        times = [datetime.fromisoformat(e.date.replace('Z', '+00:00')) for e in self.events]
        if len(set(times)) != len(times) or len({e.id for e in self.events}) != len(times):
            raise ValueError('Each load event needs a unique time and ID')
        if any(abs(v) > 1000000 for p in self.lifting_points for v in p):
            raise ValueError('Invalid lifting point')
        return self
