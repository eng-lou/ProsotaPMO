from app.schemas.work_sequence import WorkSequence
from app.schemas.climbing_formwork import ClimbingFormwork
from app.schemas.load_handling import LoadHandling
from datetime import timezone
from typing import Literal
from uuid import UUID
from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator
from app.schemas.geographic_context import GeographicContext, FeatureReplacement, GroundFinish
from app.schemas.path import PathPoint


class Point(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)
    z: float = Field(ge=-1000000, le=1000000)


class RoutePoint(PathPoint):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    x: float = Field(ge=-1000000, le=1000000)
    y: float = Field(ge=-1000000, le=1000000)
    z: float = Field(ge=-1000000, le=1000000)


class SiteObjectState(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    content_position: Point = Field(default_factory=lambda: Point(x=0,y=0,z=0))
    content_rotation: Point = Field(default_factory=lambda: Point(x=0,y=0,z=0))
    content_scale: Point = Field(default_factory=lambda: Point(x=1,y=1,z=1))
    pivot: Point | None = None
    pivot_rotation: Point | None = None
    base_position: Point | None = None
    base_rotation: Point | None = None
    base_content_position: Point | None = None
    base_content_rotation: Point | None = None


class SitePathKey(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    date: str = Field(max_length=40)
    progress: float = Field(ge=0, le=100)
    interpolation: Literal["linear", "smooth", "hold"] = "linear"


class PathMotion(BaseModel):
    activity_id: UUID | None = None
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    path_id: UUID
    bind_origin: Point | None = None
    start: str = Field(max_length=40)
    speed: float = Field(default=1.4, gt=0, le=100)
    loop: bool = False
    orient: bool = True
    heading: float = Field(default=0, ge=-36000, le=36000)
    animation_reference_speed: float = Field(default=1.4, gt=0, le=100)
    progress_keys: list[SitePathKey] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def valid_start(self):
        from datetime import datetime
        datetime.fromisoformat(self.start.replace("Z", "+00:00"))
        times = [datetime.fromisoformat(k.date.replace("Z", "+00:00")) for k in self.progress_keys]
        if any(t.tzinfo is None for t in times):
            raise ValueError("Route key times must include a timezone")
        if len(set(times)) != len(times):
            raise ValueError("Choose a different time for each route key")
        return self


class AssetPart(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    path: list[int] = Field(min_length=1, max_length=128)
    transform: list[float] = Field(min_length=16, max_length=16)
    own_mesh: bool = False

    @model_validator(mode="after")
    def valid_part(self):
        if any(i < 0 or i > 100000 for i in self.path):
            raise ValueError('Invalid asset part path')
        if any(abs(self.transform[i]) > 1e-9 for i in (3, 7, 11)) or abs(self.transform[15]-1) > 1e-9:
            raise ValueError('Asset part requires an affine transform')
        return self


class WorkerAction(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: UUID
    name: str = Field(min_length=1, max_length=100)
    start: str = Field(max_length=40)
    end: str = Field(max_length=40)
    clip: int = Field(ge=0)
    speed: float = Field(default=1, gt=0, le=10)
    loop: bool = True
    blend: float = Field(default=.2, ge=0, le=5)

    @model_validator(mode="after")
    def interval(self):
        from datetime import datetime
        times=[datetime.fromisoformat(s.replace('Z','+00:00')) for s in (self.start,self.end)]
        if any(t.tzinfo is None for t in times) or times[1]<=times[0]:
            raise ValueError('An action needs timezone-aware start and finish, with finish after start')
        return self


class SiteAttachment(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    parent_id: UUID
    node: str = Field(default='', max_length=256)
    start: str = Field(max_length=40)
    end: str = Field(max_length=40)
    position: Point = Field(default_factory=lambda: Point(x=0,y=0,z=0))
    rotation: Point = Field(default_factory=lambda: Point(x=0,y=0,z=0))
    only_during: bool = False

    @model_validator(mode="after")
    def interval(self):
        WorkerAction(id=self.parent_id,name='Attachment',start=self.start,end=self.end,clip=0)
        return self


class Illumination(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    type: Literal["point", "sun", "spot", "area"]
    intensity: float = Field(ge=0, le=100000)
    range: float = Field(default=30, gt=0, le=10000)
    beam_angle: float = Field(default=60, ge=1, le=179)
    tilt: float = Field(default=0, ge=0, le=180)


class SiteSectionBox(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: UUID
    name: str = Field(min_length=1, max_length=300)
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float
    rot_x: float = 0
    rot_y: float = 0
    rot_z: float = 0
    active: bool = True
    visible: bool = True


class GatePoseKey(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    date: AwareDatetime
    value: float = Field(ge=0, le=1)


class FenceOpening(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["gap", "vehicle", "pedestrian", "turnstile"]
    start: float = Field(ge=0, le=100000)
    width: float = Field(gt=0, le=30)
    angle: float = Field(default=0, ge=-110, le=110)
    pose: float | None = Field(default=None, ge=0, le=1)
    pose_keys: list[GatePoseKey] = Field(default_factory=list, max_length=128)
    board: str = Field(default="", max_length=48)
    lights: bool = False

    @model_validator(mode="after")
    def usable_width(self):
        if self.pose_keys:
            if self.kind == "gap":
                raise ValueError("A clear gap has no movable gate")
            for key in self.pose_keys:
                key.date = key.date.astimezone(timezone.utc)
            if len({key.date for key in self.pose_keys}) != len(self.pose_keys):
                raise ValueError("Use one pose per gate at each timeline position")
            self.pose_keys.sort(key=lambda key: key.date)
        minimum = {"gap": 0, "vehicle": 2, "pedestrian": 0.7, "turnstile": 1.2}[self.kind]
        if self.width < minimum:
            raise ValueError(f"A {self.kind} entrance needs at least {minimum:g} m in this model")
        return self


class FenceEnclosure(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    style: Literal["plain", "edge", "mesh", "hoarding"] = "edge"
    openings: list[FenceOpening] = Field(default_factory=list, max_length=32)
    levels: list[float] = Field(default_factory=lambda: [0], min_length=1, max_length=64)
    perimeter_lights: bool = False

    @model_validator(mode="after")
    def distinct_levels(self):
        if len(set(self.levels)) != len(self.levels) or any(abs(n) > 2000 for n in self.levels):
            raise ValueError("Use distinct level offsets within 2,000 m of the source path")
        return self


class TowerCover(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    style: Literal["netted", "sheeted"]
    width: float = Field(default=3.16, gt=0, le=100)
    depth: float = Field(default=2.86, gt=0, le=100)
    height: float = Field(default=19.2, gt=0, le=500)
    offset: Point = Field(default_factory=lambda: Point(x=0, y=0, z=0))


class SiteItem(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: UUID
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["fence", "context", "cabin", "tree", "person", "arrow", "asset", "shape", "array", "scatter", "geographic", "light"]
    section_boxes: list[SiteSectionBox] = Field(default_factory=list)
    illumination: Illumination | None = None
    geographic: GeographicContext | None = None
    asset_id: UUID | None = None
    asset_part: AssetPart | None = None
    assembly_id: UUID | None = None
    assembly_name: str | None = Field(default=None, max_length=100)
    operation_inputs: list[str] = Field(default_factory=list, max_length=512)
    object_state: SiteObjectState | None = None
    path_motion: PathMotion | None = None
    animation_playing: bool = True
    animation_clip: int = Field(default=0, ge=0)
    animation_speed: float = Field(default=1, ge=0, le=10)
    motion_actions: list[WorkerAction] = Field(default_factory=list, max_length=200)
    attachment: SiteAttachment | None = None
    load_handling: LoadHandling | None = None
    climbing_formwork: ClimbingFormwork | None = None
    work_sequence: WorkSequence | None = None
    rig_disabled: bool = False
    instance_overrides: dict[int, FeatureReplacement] = Field(default_factory=dict, max_length=200)
    generator_version: Literal[1] = 1
    up_axis: Literal["y", "z"]
    units: Literal["m"] = "m"
    position: Point
    yaw: float = Field(default=0, ge=-360, le=360)
    rotation: Point = Field(default_factory=lambda: Point(x=0, y=0, z=0))
    scale: Point = Field(default_factory=lambda: Point(x=1, y=1, z=1))
    width: float = Field(default=2, gt=0)
    depth: float = Field(default=2, gt=0)
    height: float = Field(default=2, gt=0)
    color: str = Field(default="#94a3b8", pattern=r"^#[0-9a-fA-F]{6}$")
    locked: bool = False
    activity_id: UUID | None = None
    path_id: UUID | None = None
    zone_id: UUID | None = None
    curve_mode: Literal["straight", "curved"] = "straight"
    panel_fit: Literal["fit", "trim", "strict"] = "fit"
    tag: str = Field(default="", max_length=100)
    finish: GroundFinish | Literal["default", "water"] = "default"
    spacing: float = Field(default=3, ge=0.1, le=1000)
    count: int = Field(default=20, ge=1, le=200)
    seed: int = Field(default=1, ge=0, le=2147483647)
    align_to_path: bool = True
    random_rotation: bool = True
    placement_kind: Literal["tree", "person", "cabin", "context", "arrow", "asset"] = "tree"
    points: list[RoutePoint] = Field(default_factory=list, max_length=512)
    closed: bool = False
    enclosure: FenceEnclosure | None = None
    tower_cover: TowerCover | None = None
    module_length: float = Field(default=2, ge=0.1, le=20)
    gate_start: float = Field(default=0, ge=0, le=100000)
    gate_width: float = Field(default=0, ge=0, le=30)

    @model_validator(mode="after")
    def source(self):
        from datetime import datetime
        if (self.kind == "light") != (self.illumination is not None):
            raise ValueError("Provide illumination settings for each site light")
        if self.motion_actions:
            if self.kind != 'asset' or self.asset_part:
                raise ValueError('Motion actions require a complete imported actor')
            if len({a.id for a in self.motion_actions}) != len(self.motion_actions):
                raise ValueError('Duplicate action IDs')
            ordered=sorted(self.motion_actions,key=lambda a:datetime.fromisoformat(a.start.replace('Z','+00:00')))
            if any(datetime.fromisoformat(b.start.replace('Z','+00:00')) < datetime.fromisoformat(a.end.replace('Z','+00:00')) for a,b in zip(ordered,ordered[1:])):
                raise ValueError('Actions for one actor cannot overlap')
        if self.work_sequence and (self.kind != "asset" or self.asset_part):
            raise ValueError("Work sequences require a complete imported machine")
        if self.work_sequence and (self.climbing_formwork or self.path_motion or self.attachment or (self.load_handling and self.load_handling.events)):
            raise ValueError("Work sequences cannot share routes, climbing or attachments")
        if self.work_sequence and any(self.id in (step.excavation_id,step.pile_id) for step in self.work_sequence.steps):
            raise ValueError("A machine cannot be its own work target")
        if self.climbing_formwork and (self.path_motion or self.attachment or (self.load_handling and self.load_handling.events)):
            raise ValueError('Climbing formwork cannot share routes or attachments')
        if self.load_handling and self.load_handling.events and (self.attachment or self.path_motion):
            raise ValueError('Load transfers cannot share a load with a single attachment or its own route')
        if self.attachment and self.path_motion:
            raise ValueError('Unbind this object from its path before attaching it to another object')
        if self.asset_part and self.kind != 'asset':
            raise ValueError('Only imported assets can reference a part')
        if any(i < 0 or i >= 200 for i in self.instance_overrides):
            raise ValueError('Invalid placement index')
        if self.kind == 'geographic' and self.geographic is None:
            raise ValueError('Load open geographic data before saving context')
        if self.kind == "asset" and not self.asset_id:
            raise ValueError("Choose a library asset")
        if self.enclosure and self.kind != "fence":
            raise ValueError("Enclosure settings require a fence")
        if self.tower_cover and (self.kind != "asset" or self.asset_part):
            raise ValueError("A tower cover requires a complete imported asset")
        if self.kind == "fence" and (not self.path_id or len(self.points) < 2):
            raise ValueError("Choose an existing path with at least two points")
        if self.kind in ("shape", "array", "scatter"):
            if not (self.path_id or self.zone_id) or len(self.points) < 2:
                raise ValueError("Choose a path or zone with enough points")
            if self.kind in ("shape", "scatter") and (not self.closed or len(self.points) < 3):
                raise ValueError("Close the source path or use a zone with at least three points")
            if self.kind != "shape" and self.placement_kind == "asset" and not self.asset_id:
                raise ValueError("Choose a library asset to place")
        return self


class HistoryEdit(BaseModel):
    model_config = ConfigDict(extra='forbid')
    command_id: UUID
    expected_revision: int = Field(ge=0)
    action_id: UUID


class SceneEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    expected_revision: int = Field(ge=0)
    items: list[SiteItem]
    label: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError("Duplicate site object IDs")
        by_id={i.id:i for i in self.items}
        claimed=set()
        for machine in self.items:
            if not machine.work_sequence: continue
            for step in machine.work_sequence.steps:
                for target_id in (step.excavation_id,step.pile_id):
                    if not target_id: continue
                    target=by_id.get(target_id)
                    if not target or target_id in claimed:
                        raise ValueError('Work targets must exist and belong to one step')
                    if target.work_sequence or target.climbing_formwork or target.path_motion or target.attachment or (target.load_handling and target.load_handling.events):
                        raise ValueError('Work targets must be stationary objects')
                    claimed.add(target_id)
        done=set()
        def visit(item_id, chain):
            if item_id in chain:
                raise ValueError('Load transfers and attachments cannot form a cycle')
            if item_id in done:
                return
            item=by_id[item_id]
            parents=([item.attachment.parent_id] if item.attachment else [])+[e.parent_id for e in (item.load_handling.events if item.load_handling else []) if e.parent_id]+[leg.parent_id for e in (item.load_handling.events if item.load_handling else []) if e.rigging for leg in e.rigging.legs]
            for parent in parents:
                if parent not in by_id:
                    raise ValueError('Remove load transfers before removing their carrier')
                visit(parent,chain|{item_id})
            done.add(item_id)
        for item_id in by_id:
            visit(item_id,set())
        for item in self.items:
            visited={item.id}; current=item
            while current.attachment:
                parent=current.attachment.parent_id
                if parent not in by_id:
                    raise ValueError('Remove attachments before removing their parent object')
                if parent in visited:
                    raise ValueError('Attachments cannot form a cycle')
                visited.add(parent); current=by_id[parent]
        return self
