from datetime import datetime
from typing import Annotated, Literal
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
    members: list[str] = Field(default_factory=list, max_length=500)
    parent: str | None = None
    control: str
    kind: Literal['hinge', 'slide']
    pivot_rotation: tuple[float, float, float] | None = None
    pivot: tuple[float, float, float]
    axis: tuple[float, float, float]
    minimum: float = Field(ge=-1000000, le=1000000)
    maximum: float = Field(ge=-1000000, le=1000000)
    response: list[tuple[float, float]] = Field(default_factory=lambda: [(0, 0), (1, 1)], min_length=2, max_length=100)


class Follower(Strict):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    barrel: str = Field(min_length=1, max_length=2000)
    piston: str = Field(max_length=2000)  # Empty for a single rigid link.
    base_node: str  # Empty string means equipment root.
    tip_node: str
    base_point: tuple[float, float, float]
    tip_point: tuple[float, float, float]
    flex_curve: list[tuple[float, float, float]] | None = Field(default=None, min_length=2, max_length=512)

    @model_validator(mode='after')
    def check_flexible(self):
        if self.flex_curve and (self.piston or len(set(self.flex_curve)) < 2):
            raise ValueError('Flexible connections need one mesh and a non-zero centreline')
        return self


class SoilCycle(Strict):
    pickup: dict[str, Annotated[float, Field(ge=0, le=1)]] = Field(max_length=100)
    carry: dict[str, Annotated[float, Field(ge=0, le=1)]] = Field(max_length=100)
    tip: dict[str, Annotated[float, Field(ge=0, le=1)]] = Field(max_length=100)
    approach_seconds: float = Field(ge=.1, le=120)
    lift_seconds: float = Field(ge=.1, le=120)
    travel_seconds: float = Field(ge=.1, le=120)
    tip_seconds: float = Field(ge=.1, le=120)
    start_progress: float = Field(ge=0, le=100)
    pickup_progress: float = Field(ge=0, le=100)
    drop_progress: float = Field(ge=0, le=100)


class Soil(Strict):
    material: Literal['soil', 'sand', 'gravel', 'rocks'] = 'soil'
    mode: Literal['excavate', 'preloaded'] = 'excavate'
    initial_fill: float = Field(default=1, ge=0, le=1)
    outlet: tuple[float, float, float] | None = None
    cycle: SoilCycle | None = None
    enabled: bool = True
    show_guide: bool = False
    bucket_node: str = Field(min_length=1, max_length=2000)
    center: tuple[float, float, float]
    size: tuple[float, float, float]
    rotation: tuple[float, float, float]
    opening_direction: tuple[float, float, float] | None = None
    capacity: float = Field(ge=.001, le=100)
    dump_angle: float = Field(ge=10, le=170)
    pour_seconds: float = Field(ge=.2, le=30)
    source: tuple[float, float, float]
    radius: float = Field(ge=.2, le=50)
    height: float = Field(ge=.05, le=20)
    up_axis: Literal['y', 'z']
    start: datetime
    end: datetime
    duration_seconds: float = Field(ge=1, le=300)
    steps: int = Field(ge=60, le=600)
    color: str = Field(pattern=r'^#[0-9a-fA-F]{6}$')

    @model_validator(mode='after')
    def check_soil(self):
        if self.mode != 'preloaded' and self.dump_angle < 45:
            raise ValueError('Excavation pour angle must be at least 45 degrees')
        if self.outlet is not None and any(abs(n) > .5 for n in self.outlet):
            raise ValueError('Discharge edge must be within the calibrated volume')
        if self.start.tzinfo is None or self.end.tzinfo is None or self.end <= self.start:
            raise ValueError('Soil simulation needs an increasing time range with timezones')
        if any(n <= 0 for n in self.size):
            raise ValueError('Bucket dimensions must be positive')
        if self.opening_direction is not None and (sum(n*n for n in self.opening_direction) < 1e-12 or any(abs(n) > 1e7 for n in self.opening_direction)):
            raise ValueError('Bucket opening direction must be a non-zero finite vector')
        if any(abs(n) > 1e7 for v in (self.center, self.size, self.rotation, self.source) for n in v):
            raise ValueError('Soil coordinates exceed supported range')
        return self


class MotionDetail(Strict):
    node: str = Field(min_length=1, max_length=2000)
    joint: str = Field(min_length=1, max_length=80)
    threshold: float = Field(gt=0, le=1000000)


class Definition(Strict):
    schema_version: Literal[1] = 1
    controls: list[Control] = Field(default_factory=list, max_length=100)
    joints: list[Joint] = Field(default_factory=list, max_length=200)
    followers: list[Follower] = Field(default_factory=list, max_length=100)
    motion_details: list[MotionDetail] = Field(default_factory=list, max_length=200)
    soil: Soil | None = None

    @model_validator(mode='after')
    def validate_graph(self):
        if sum(len(c.keys) for c in self.controls) > 20000:
            raise ValueError('Equipment rig exceeds 20,000 keyframes')
        for items in (self.controls, self.joints, self.followers):
            if len({x.id for x in items}) != len(items):
                raise ValueError('IDs must be unique')
        controls = {x.id for x in self.controls}
        joints = {x.id: x for x in self.joints}
        if len({d.node for d in self.motion_details}) != len(self.motion_details) or any(d.joint not in joints for d in self.motion_details):
            raise ValueError('Motion details need unique parts and existing joints')
        if any(j.parent is not None and j.parent not in joints for j in self.joints):
            raise ValueError('Unknown parent joint')
        follower_nodes = [n for f in self.followers for n in (f.barrel, f.piston) if n]
        driven = [n for j in self.joints for n in [j.node, *j.members]] + follower_nodes
        if len(set(driven)) != len(driven) or any(not n for n in driven):
            raise ValueError('Each part may have only one driver; the equipment root cannot be driven')
        for control in self.controls:
            if len({k.date for k in control.keys}) != len(control.keys):
                raise ValueError('Duplicate keyframe time')
        for joint in self.joints:
            group = [joint.node, *joint.members]
            if any(not n or len(n) > 2000 for n in group):
                raise ValueError('Invalid group parts')
            if any(n != a and n.startswith(a + '/') for n in group for a in group):
                raise ValueError('Select a part or its children, not both')
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
            if any(n.startswith(p + '/') and a.id not in seen for n in group for a in self.joints for p in [a.node, *a.members]):
                raise ValueError('Joint must inherit from its driven model ancestor')
            points = joint.response
            if points[0][0] != 0 or points[-1][0] != 1 or any(not 0 <= y <= 1 for _, y in points) or any(a[0] >= b[0] for a, b in zip(points, points[1:])):
                raise ValueError('Response curve must have increasing inputs from 0 to 1 and outputs within 0 to 1')
        visiting, done = set(), set()
        def visit(follower):
            if follower.id in done:
                return
            if follower.id in visiting:
                raise ValueError('Cylinder or hose connections contain a cycle')
            visiting.add(follower.id)
            for other in self.followers:
                if any(n == a or n.startswith(a + '/') for n in (follower.base_node, follower.tip_node) for a in (other.barrel, other.piston) if a):
                    visit(other)
            visiting.remove(follower.id)
            done.add(follower.id)
        for follower in self.followers:
            visit(follower)
        if any(n != a and n.startswith(a + '/') for n in driven for a in follower_nodes):
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
