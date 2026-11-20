from typing import Literal
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator
class WorkPoint(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    x: float = Field(ge=-1e8,le=1e8)
    y: float = Field(ge=-1e8,le=1e8)
    z: float = Field(ge=-1e8,le=1e8)
class WorkStep(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False, populate_by_name=True)
    id: UUID
    activity_id: UUID
    start: str | None = Field(default=None,max_length=40)
    finish: str | None = Field(default=None,max_length=40)
    start_chainage: float = Field(ge=0,le=1e7)
    end_chainage: float = Field(ge=0,le=1e7)
    position: WorkPoint
    depth: float = Field(gt=0,le=10000)
    travel_hours: float = Field(ge=0,le=87600)
    excavation_id: UUID | None = None
    pile_id: UUID | None = None
    @model_validator(mode='after')
    def times(self):
        for value in (self.start,self.finish):
            if value and datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is None:
                raise ValueError('Time must include timezone')
        if self.start and self.finish and datetime.fromisoformat(self.finish.replace('Z','+00:00'))<=datetime.fromisoformat(self.start.replace('Z','+00:00')):
            raise ValueError('Finish must follow start')
        return self
class WorkSequence(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    kind: Literal['tbm','piling']
    offset: WorkPoint
    path_id: UUID | None = None
    axis: Literal['y','z']
    steps: list[WorkStep] = Field(default_factory=list,max_length=500)
    tool_control: str | None = Field(default=None,max_length=100)
    tool_travel: float = Field(default=20,gt=0,le=10000)
    tool_rest: float = Field(default=0,ge=0,le=1)
    tool_full: float = Field(default=1,ge=0,le=1)
    @model_validator(mode='after')
    def validate_steps(self):
        if len({s.id for s in self.steps})!=len(self.steps): raise ValueError('Duplicate step IDs')
        if self.kind=='tbm' and self.steps and not self.path_id: raise ValueError('Choose tunnel alignment')
        if self.kind=='tbm' and any(s.end_chainage<=s.start_chainage for s in self.steps): raise ValueError('Invalid chainages')
        if self.kind=='piling' and self.tool_control and any(s.depth>self.tool_travel for s in self.steps): raise ValueError('Depth exceeds tool travel')
        targets=[x for s in self.steps for x in (s.excavation_id,s.pile_id) if x]
        if len(targets)!=len(set(targets)): raise ValueError('Each visual target must belong to one step')
        return self
