"""Bounded, editable recipes for independently sourced site context."""
from typing import Literal, Annotated
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, model_validator

Coordinate = Annotated[float, Field(ge=-10000, le=10000)]
XY = tuple[Coordinate, Coordinate]

class SurfaceFinish(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    color: str | None = Field(default=None, pattern=r'^#[0-9a-fA-F]{6}$')
    finish: Literal['original', 'concrete', 'glass', 'metal', 'grass', 'brick', 'timber', 'asphalt', 'stone', 'gravel', 'soil', 'tile', 'render', 'painted-metal', 'water', 'moquette', 'grass-mown', 'grass-dry', 'green-roof', 'moquette-checkered'] = 'original'

class FeatureReplacement(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    asset_id: UUID
    width: float = Field(gt=0)
    depth: float = Field(gt=0)
    height: float = Field(gt=0)
    yaw: float = Field(default=0, ge=-360, le=360)
    # Base centre in the reconstruction's ENU coordinates. Static only.
    anchor: tuple[Coordinate, Coordinate, Coordinate]

class MapFeature(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    id: str = Field(max_length=90)
    name: str = Field(max_length=160)
    kind: Literal['building', 'road', 'rail', 'paving', 'grass', 'water', 'tree', 'wood']
    points: list[XY] = Field(min_length=1, max_length=2048)
    holes: list[Annotated[list[XY], Field(min_length=3, max_length=2048)]] = Field(default_factory=list, max_length=40)
    category: str = Field(default='', max_length=50)
    height: float = Field(default=8, ge=0, le=200)
    height_basis: Literal['mapped height', 'mapped floors', 'estimated', 'user'] = 'estimated'
    width: float = Field(default=6, gt=0, le=100)
    roof: Literal['flat', 'gabled', 'hipped', 'industrial'] = 'flat'
    roof_basis: Literal['mapped', 'estimated', 'user'] = 'estimated'
    color: str = Field(default='#d6d5cd', pattern=r'^#[0-9a-fA-F]{6}$')
    roof_color: str = Field(default='#b8bebc', pattern=r'^#[0-9a-fA-F]{6}$')
    hidden: bool = False
    cropped: bool = False
    surfaces: dict[Annotated[str, Field(pattern=r'^(surface|walls|roof|bottom|wall:[0-9]+:[0-9]+|material:[0-9]+)$')], SurfaceFinish] = Field(default_factory=dict, max_length=2200)
    replacement: FeatureReplacement | None = None

    @model_validator(mode='after')
    def valid_geometry(self):
        minimum = 1 if self.kind == 'tree' else 2 if self.kind in ('road', 'rail') else 3
        if len(self.points) < minimum or any(len(h) < 3 for h in self.holes):
            raise ValueError('Incomplete geographic feature geometry')
        if minimum == 3:
            from shapely.geometry import Polygon
            polygon = Polygon(self.points, self.holes)
            if not polygon.is_valid or polygon.area < .001:
                raise ValueError('Use a non-crossing footprint with closed, non-overlapping holes')
        return self

class GeographicContext(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    version: Literal[1] = 1
    source: Literal['OpenStreetMap'] = 'OpenStreetMap'
    attribution: Literal['© OpenStreetMap contributors · ODbL 1.0'] = '© OpenStreetMap contributors · ODbL 1.0'
    source_date: str = Field(max_length=50)
    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, le=180)
    width: float = Field(ge=100, le=1500)
    depth: float = Field(ge=100, le=1500)
    features: list[MapFeature] = Field(max_length=4000)
    hidden_layers: list[Literal['building', 'road', 'rail', 'paving', 'grass', 'water', 'tree', 'wood']] = Field(default_factory=list, max_length=8)
    detail: Literal['balanced', 'detailed'] = 'detailed'
    coverage_note: str = Field(default='', max_length=500)

    @model_validator(mode='after')
    def bounded(self):
        if len({f.id for f in self.features}) != len(self.features):
            raise ValueError('Duplicate map feature IDs')
        if sum(len(f.points) + sum(map(len, f.holes)) for f in self.features) > 100000:
            raise ValueError('Choose a smaller area: too many map vertices')
        if any(abs(x)>self.width/2+.1 or abs(y)>self.depth/2+.1 for f in self.features for ring in [f.points,*f.holes] for x,y in ring):
            raise ValueError('Feature geometry extends beyond the saved study boundary')
        return self
