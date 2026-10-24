from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictMotion(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class MotionSettings(StrictMotion):
    offset: float = Field(default=0, ge=-100000, le=100000)
    kind: Literal['hold', 'orbit', 'dolly', 'slide', 'crane', 'pan', 'tilt', 'flyover', 'transition']
    duration: float = Field(ge=1, le=300)
    amount: float = Field(ge=0, le=100)
    angle: float = Field(ge=-360, le=360)
    reverse: bool
    easing: Literal['linear', 'smooth']
    shotSize: Literal['wide', 'medium', 'close']
    alignment: Literal['center', 'left', 'right']
    lookAt: bool
    startView: Literal['current', 'auto']


class MotionPose(StrictMotion):
    base_position_x: float
    base_position_y: float
    base_position_z: float
    base_target_x: float
    base_target_y: float
    base_target_z: float
    base_focal_length: float = Field(gt=0, le=10000)
    base_clip_start: float = Field(gt=0)
    base_clip_end: float = Field(gt=0)


class MotionTracking(StrictMotion):
    objectId: str = Field(min_length=1, max_length=200)
    position: tuple[float, float, float]
    rotation: tuple[float, float, float, float]


class MotionShot(StrictMotion):
    tracking: MotionTracking | None = None
    followMode: Literal['fixed', 'aim', 'translate', 'aligned'] = 'fixed'
    actorClock: Literal['presentation', 'construction'] = 'presentation'
    id: str = Field(max_length=100)
    name: str = Field(min_length=1, max_length=100)
    settings: MotionSettings
    target: tuple[float, float, float]
    radius: float = Field(gt=0)
    upAxis: Literal['y', 'z']
    start: MotionPose
    end: MotionPose | None = None
    startOffset: tuple[float, float, float]
    endOffset: tuple[float, float, float]
    stage: Literal['fixed', 'progress']
    dateStart: datetime
    dateEnd: datetime
    blend: float = Field(ge=0, le=30)

    @model_validator(mode='after')
    def coherent_shot(self):
        if self.stage == 'progress' and self.dateEnd < self.dateStart:
            raise ValueError('Construction end must be on or after its start')
        if self.settings.kind == 'transition' and self.end is None:
            raise ValueError('View-to-view motion needs an end viewpoint')
        if self.start.base_clip_end <= self.start.base_clip_start:
            raise ValueError('Camera far clip must exceed near clip')
        return self


class CameraMotion(StrictMotion):
    version: Literal[1] = 1
    shots: list[MotionShot] = Field(min_length=1, max_length=100)
