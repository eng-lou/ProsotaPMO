from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_validator
from typing import Literal

class ClimbLift(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: UUID
    activity_id: UUID | None = None
    height: float = Field(ge=-10000, le=10000)
    duration_hours: float = Field(default=24, gt=0, le=87600)
    start: str | None = Field(default=None, max_length=40)
    finish: str | None = Field(default=None, max_length=40)
    @model_validator(mode='after')
    def valid_times(self):
        for value in (self.start,self.finish):
            if value and datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is None:
                raise ValueError('Climb time must include timezone')
        if not self.activity_id and not self.finish:
            raise ValueError('Choose an activity or manual finish')
        if self.start and self.finish and datetime.fromisoformat(self.start.replace('Z','+00:00')) >= datetime.fromisoformat(self.finish.replace('Z','+00:00')):
            raise ValueError('Climb finish must follow start')
        return self

class ClimbingFormwork(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    axis: Literal['y','z']
    reference_elevation: float = Field(default=0, ge=-1000000, le=1000000)
    lifts: list[ClimbLift] = Field(default_factory=list, max_length=300)
    @model_validator(mode='after')
    def unique_lifts(self):
        if len({l.id for l in self.lifts}) != len(self.lifts):
            raise ValueError('Duplicate climb lift IDs')
        return self
