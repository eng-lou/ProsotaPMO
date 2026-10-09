from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)


class Key(Strict):
    date: datetime
    value: float = Field(ge=0, le=1)
    interpolation: Literal['linear', 'smooth', 'hold'] = 'linear'

    @model_validator(mode='after')
    def timezone_required(self):
        if self.date.tzinfo is None:
            raise ValueError('Keyframe dates require a timezone')
        return self


class Control(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    value: float = Field(ge=0, le=1)
    rest: float = Field(default=0, ge=0, le=1)
    keys: list[Key] = Field(default_factory=list, max_length=10000)


class Joint(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    node: str = Field(min_length=1, max_length=2000)
    parent: str | None = None
    control: str
    kind: Literal['hinge', 'slide']
    pivot: tuple[float, float, float]
    axis: tuple[float, float, float]
    minimum: float = Field(ge=-1000000, le=1000000)
    maximum: float = Field(ge=-1000000, le=1000000)
    response: list[tuple[float, float]] = Field(default_factory=lambda: [(0, 0), (1, 1)], min_length=2, max_length=100)


class Follower(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    barrel: str
    piston: str
    base_node: str  # Empty string means equipment root.
    tip_node: str
    base_point: tuple[float, float, float]
    tip_point: tuple[float, float, float]


class Definition(Strict):
    schema_version: Literal[1] = 1
    controls: list[Control] = Field(default_factory=list, max_length=100)
    joints: list[Joint] = Field(default_factory=list, max_length=200)
    followers: list[Follower] = Field(default_factory=list, max_length=100)

    @model_validator(mode='after')
    def validate_graph(self):
        if sum(len(c.keys) for c in self.controls) > 20000:
            raise ValueError('Equipment rig exceeds 20,000 keyframes')
        for items in (self.controls, self.joints, self.followers):
            if len({x.id for x in items}) != len(items):
                raise ValueError('IDs must be unique')
        controls = {x.id for x in self.controls}
        joints = {x.id: x for x in self.joints}
        if any(j.parent is not None and j.parent not in joints for j in self.joints):
            raise ValueError('Unknown parent joint')
        driven = [j.node for j in self.joints] + [n for f in self.followers for n in (f.barrel, f.piston)]
        if len(set(driven)) != len(driven) or any(not n for n in driven):
            raise ValueError('Each part may have only one driver; the equipment root cannot be driven')
        for control in self.controls:
            if len({k.date for k in control.keys}) != len(control.keys):
                raise ValueError('Duplicate keyframe time')
        for joint in self.joints:
            if joint.control not in controls or (joint.parent is not None and joint.parent not in joints):
                raise ValueError('Unknown control or parent joint')
            if sum(x*x for x in joint.axis) < 1e-12:
                raise ValueError('Joint axis cannot be zero')
            seen = {joint.id}
            parent = joint.parent
            while parent is not None:
                if parent in seen:
                    raise ValueError('Joint hierarchy contains a cycle')
                seen.add(parent)
                parent = joints[parent].parent
            if any(joint.node.startswith(a.node + '/') and a.id not in seen for a in self.joints):
                raise ValueError('Joint must inherit from its driven model ancestor')
            points = joint.response
            if points[0][0] != 0 or points[-1][0] != 1 or any(not 0 <= y <= 1 for _, y in points) or any(a[0] >= b[0] for a, b in zip(points, points[1:])):
                raise ValueError('Response curve must have increasing inputs from 0 to 1 and outputs within 0 to 1')
        for follower in self.followers:
            follower_nodes = driven[len(self.joints):]
            if any(n == a or n.startswith(a + '/') for n in (follower.base_node, follower.tip_node) for a in follower_nodes):
                raise ValueError('Cylinder attachments must reference joint parts or fixed parts, not followers')
        if any(n != a and n.startswith(a + '/') for n in driven for a in driven[len(self.joints):]):
            raise ValueError('Followers cannot be ancestors of another driven part')
        return self


class RigCreate(Strict):
    project_id: UUID
    model_ref: str = Field(min_length=1, max_length=300)
    name: str = Field(min_length=1, max_length=200)
    definition: Definition


class RigUpdate(Strict):
    version: int = Field(ge=1)
    name: str = Field(min_length=1, max_length=200)
    definition: Definition


class RigResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    model_ref: str
    name: str
    version: int
    definition: Definition
