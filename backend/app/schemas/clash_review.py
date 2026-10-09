from datetime import date
import uuid
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from app.schemas.clash_test import ClashResultPair


class Geometry(BaseModel):
    # Explicit geometry only: no object JSON, URLs, textures or hidden metadata.
    positions: list[float] = Field(min_length=9, max_length=900000)
    indices: list[int] = Field(min_length=3, max_length=900000)

    @model_validator(mode="after")
    def valid_mesh(self):
        import math
        if len(self.positions) % 3 or len(self.indices) % 3:
            raise ValueError("Geometry must contain triangles")
        if any(not math.isfinite(v) or abs(v) > 1e12 for v in self.positions):
            raise ValueError("Invalid vertex")
        if any(i < 0 or i >= len(self.positions) // 3 for i in self.indices):
            raise ValueError("Invalid triangle index")
        return self


class ElementGeometry(BaseModel):
    key: str = Field(max_length=320)
    meshes: list[Geometry] = Field(max_length=100)


class RunRequest(BaseModel):
    up_axis: Literal["y", "z"] | None = None
    background_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    pairs: list[ClashResultPair] = Field(max_length=10000)
    scope: Literal["all", "visible"]
    timeline_date: str | None = Field(default=None, max_length=60)
    expected: int = Field(ge=1)
    resolved: int = Field(ge=1)
    excluded: int = Field(default=0, ge=0)
    complete: bool
    models: list[str] = Field(max_length=1000)
    warnings: list[str] = Field(default_factory=list, max_length=100)
    geometry: list[ElementGeometry] = Field(default_factory=list, max_length=10000)
    geometry_fingerprint: str = Field(default="", max_length=64, pattern=r"^[0-9a-f]{0,64}$")
    geometry_z: str | None = Field(default=None, max_length=200000000)
    member_ids: list[uuid.UUID] = Field(max_length=100000)
    checked_keys: list[str] = Field(max_length=100000)
    metres_per_unit: float = Field(default=1, gt=0, le=1000, allow_inf_nan=False)
    test_updated_at: str


class Viewpoint(BaseModel):
    eye: tuple[float, float, float]
    target: tuple[float, float, float]
    up: tuple[float, float, float]

    @model_validator(mode="after")
    def finite(self):
        import math
        if not all(math.isfinite(x) and abs(x) <= 1e12 for x in (*self.eye, *self.target, *self.up)):
            raise ValueError("Invalid viewpoint")
        return self


class ReportRequest(BaseModel):
    up_axis: Literal["y", "z"] | None = None
    background_color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    run_id: uuid.UUID
    result_ids: list[uuid.UUID] = Field(min_length=1, max_length=1000)
    viewpoints: dict[uuid.UUID, Viewpoint] = Field(default_factory=dict, max_length=1000)
    expires_days: int = Field(default=14, ge=1, le=90)
    allow_comments: bool = False


class ReportComment(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    text: str = Field(min_length=1, max_length=2000)
    result_id: uuid.UUID


class EmailRequest(BaseModel):
    recipient: str = Field(min_length=3, max_length=254, pattern=r"^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$")
    token: str = Field(min_length=40, max_length=100)


class IssueRequest(BaseModel):
    period_id: uuid.UUID
    owner: str = Field(default="", max_length=200)
    due_date: date | None = None


class UploadedRunRequest(BaseModel):
    upload_id: uuid.UUID
