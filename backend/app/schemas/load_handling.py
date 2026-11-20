from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class LoadEvent(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: UUID
    date: str = Field(max_length=40)
    parent_id: UUID | None = None
    node: str = Field(default='', max_length=256)
    matrix: list[float] = Field(min_length=16, max_length=16)
    slings: bool = False

    @model_validator(mode='after')
    def valid_event(self):
        if datetime.fromisoformat(self.date.replace('Z', '+00:00')).tzinfo is None:
            raise ValueError('Load event time must include a timezone')
        m = self.matrix
        if any(abs(m[i]) > 1e-8 for i in (3, 7, 11)) or abs(m[15]-1) > 1e-8:
            raise ValueError('Load event requires an affine transform')
        determinant = m[0]*(m[5]*m[10]-m[9]*m[6])-m[4]*(m[1]*m[10]-m[9]*m[2])+m[8]*(m[1]*m[6]-m[5]*m[2])
        if abs(determinant) < 1e-10 or any(abs(v) > 1000000 for v in m):
            raise ValueError('Invalid load event transform')
        return self


class LoadHandling(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    events: list[LoadEvent] = Field(default_factory=list, max_length=200)
    lifting_points: list[tuple[float, float, float]] = Field(default_factory=list, max_length=8)

    lifting_nodes: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode='after')
    def unique_events(self):
        if self.lifting_nodes and len(self.lifting_nodes) != len(self.lifting_points):
            raise ValueError('Lifting node bindings must match point count')
        if any(len(n) > 256 for n in self.lifting_nodes):
            raise ValueError('Lifting node name too long')
        times = [datetime.fromisoformat(e.date.replace('Z', '+00:00')) for e in self.events]
        if len(set(times)) != len(times) or len({e.id for e in self.events}) != len(times):
            raise ValueError('Each load event needs a unique time and ID')
        if any(abs(v) > 1000000 for p in self.lifting_points for v in p):
            raise ValueError('Invalid lifting point')
        return self
