from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field, model_serializer, model_validator
from typing import Literal

class BoomKey(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    date: datetime
    deployment: float = Field(ge=0, le=1)
    slew: float = Field(ge=-180, le=180)

    @model_validator(mode='after')
    def dated(self):
        if self.date.tzinfo is None:
            raise ValueError('Boom key must include timezone')
        return self


class PourBoomKey(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    progress: float = Field(ge=0, le=1)
    deployment: float | None = Field(default=None, ge=0, le=1)
    slew: float | None = Field(default=None, ge=-180, le=180)

    @model_validator(mode='after')
    def has_channel(self):
        if self.deployment is None and self.slew is None:
            raise ValueError('A pour key needs a slew or deployment value')
        return self


class PourSweep(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    start_angle: float = Field(ge=-180, le=180)
    finish_angle: float = Field(ge=-180, le=180)


class ClimbLift(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    id: UUID
    activity_id: UUID | None = None
    climb_activity_id: UUID | None = None
    pour_activity_id: UUID | None = None
    pour_keys: list[PourBoomKey] = Field(default_factory=list, max_length=128)
    strip_activity_id: UUID | None = None
    height: float = Field(ge=-10000, le=10000)
    duration_hours: float = Field(default=24, gt=0, le=87600)
    start: str | None = Field(default=None, max_length=40)
    finish: str | None = Field(default=None, max_length=40)
    @model_validator(mode='after')
    def valid_times(self):
        if len({key.progress for key in self.pour_keys}) != len(self.pour_keys):
            raise ValueError('Duplicate progress in pour keys')
        for value in (self.start,self.finish):
            if value and datetime.fromisoformat(value.replace('Z','+00:00')).tzinfo is None:
                raise ValueError('Climb time must include timezone')
        if not self.activity_id and not self.finish:
            raise ValueError('Choose an activity or manual finish')
        if self.start and self.finish and datetime.fromisoformat(self.start.replace('Z','+00:00')) >= datetime.fromisoformat(self.finish.replace('Z','+00:00')):
            raise ValueError('Climb finish must follow start')
        return self

    @model_serializer(mode='wrap')
    def recipe(self, handler):
        data = handler(self)
        if not self.pour_keys:
            data.pop('pour_keys', None)
        for key in ('climb_activity_id', 'pour_activity_id', 'strip_activity_id'):
            if data.get(key) is None:
                data.pop(key, None)
        return data


class ClimbingFormwork(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    mode: Literal['simple', 'articulated'] = 'simple'
    boom_deployment: float | None = Field(default=None, ge=0, le=1)
    boom_slew: float = Field(default=0, ge=-180, le=180)
    pour_sweep: PourSweep | None = None
    boom_keys: list[BoomKey] = Field(default_factory=list, max_length=128)
    axis: Literal['y','z']
    reference_elevation: float = Field(default=0, ge=-1000000, le=1000000)
    lifts: list[ClimbLift] = Field(default_factory=list, max_length=300)
    @model_validator(mode='after')
    def unique_lifts(self):
        if len({k.date for k in self.boom_keys}) != len(self.boom_keys):
            raise ValueError('Duplicate boom key times')
        if len({l.id for l in self.lifts}) != len(self.lifts):
            raise ValueError('Duplicate climb lift IDs')
        return self

    @model_serializer(mode='wrap')
    def recipe(self, handler):
        # Keep old command fingerprints and saved undo receipts valid for simple climbs.
        data = handler(self)
        for key, default in [('mode', 'simple'), ('boom_deployment', None), ('boom_keys', []), ('boom_slew', 0), ('pour_sweep', None)]:
            if data.get(key) == default:
                data.pop(key, None)
        return data
