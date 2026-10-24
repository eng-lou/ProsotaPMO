from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Point(BaseModel):
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

    @model_validator(mode="after")
    def valid_start(self):
        from datetime import datetime
        datetime.fromisoformat(self.start.replace("Z", "+00:00"))
        return self


class SiteItem(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: UUID
    name: str = Field(min_length=1, max_length=100)
    kind: Literal["fence", "context", "cabin", "tree", "person", "arrow", "asset", "shape", "array", "scatter"]
    asset_id: UUID | None = None
    operation_inputs: list[str] = Field(default_factory=list, max_length=512)
    object_state: SiteObjectState | None = None
    path_motion: PathMotion | None = None
    animation_playing: bool = True
    animation_clip: int = Field(default=0, ge=0)
    animation_speed: float = Field(default=1, ge=0, le=10)
    generator_version: Literal[1] = 1
    up_axis: Literal["y", "z"]
    units: Literal["m"] = "m"
    position: Point
    yaw: float = Field(default=0, ge=-360, le=360)
    rotation: Point = Field(default_factory=lambda: Point(x=0, y=0, z=0))
    scale: Point = Field(default_factory=lambda: Point(x=1, y=1, z=1))
    width: float = Field(default=2, gt=0, le=1000)
    depth: float = Field(default=2, gt=0, le=1000)
    height: float = Field(default=2, gt=0, le=500)
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
    points: list[Point] = Field(default_factory=list, max_length=512)
    closed: bool = False
    module_length: float = Field(default=2, ge=0.1, le=20)
    gate_start: float = Field(default=0, ge=0, le=100000)
    gate_width: float = Field(default=0, ge=0, le=30)

    @model_validator(mode="after")
    def source(self):
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
    items: list[SiteItem] = Field(max_length=200)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError("Duplicate site object IDs")
        return self
