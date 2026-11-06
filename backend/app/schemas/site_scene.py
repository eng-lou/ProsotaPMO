from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.schemas.geographic_context import GeographicContext, FeatureReplacement
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


class SiteItem(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: UUID
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["fence", "context", "cabin", "tree", "person", "arrow", "asset", "shape", "array", "scatter", "geographic"]
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
    finish: Literal["default", "water"] = "default"
    spacing: float = Field(default=3, ge=0.1, le=1000)
    count: int = Field(default=20, ge=1, le=200)
    seed: int = Field(default=1, ge=0, le=2147483647)
    align_to_path: bool = True
    random_rotation: bool = True
    placement_kind: Literal["tree", "person", "cabin", "context", "arrow", "asset"] = "tree"
    points: list[RoutePoint] = Field(default_factory=list, max_length=512)
    closed: bool = False
    module_length: float = Field(default=2, ge=0.1, le=20)
    gate_start: float = Field(default=0, ge=0, le=100000)
    gate_width: float = Field(default=0, ge=0, le=30)

    @model_validator(mode="after")
    def source(self):
        from datetime import datetime
        if self.motion_actions:
            if self.kind != 'asset' or self.asset_part:
                raise ValueError('Motion actions require a complete imported actor')
            if len({a.id for a in self.motion_actions}) != len(self.motion_actions):
                raise ValueError('Duplicate action IDs')
            ordered=sorted(self.motion_actions,key=lambda a:datetime.fromisoformat(a.start.replace('Z','+00:00')))
            if any(datetime.fromisoformat(b.start.replace('Z','+00:00')) < datetime.fromisoformat(a.end.replace('Z','+00:00')) for a,b in zip(ordered,ordered[1:])):
                raise ValueError('Actions for one actor cannot overlap')
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


class SceneEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command_id: UUID
    expected_revision: int = Field(ge=0)
    items: list[SiteItem]

    @model_validator(mode="after")
    def unique_ids(self):
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError("Duplicate site object IDs")
        by_id={i.id:i for i in self.items}
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
