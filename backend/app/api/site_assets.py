"""Project-owned GLB library; immutable versions use existing object storage."""
import json
import struct
import tempfile
from pathlib import Path
from typing import Literal
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_db_user
from app.database import get_db
from app.models.site_asset import SiteAsset
from app.services.clash_access import owned_project
from app.services import object_storage

router = APIRouter(prefix="/site-assets", tags=["site-assets"])
Category = Literal["Cabins", "Vegetation", "Trees", "Fences", "Context buildings", "Road arrows", "Equipment", "People", "Vehicles", "Other"]


class Register(BaseModel):
    project_id: UUID
    name: str = Field(min_length=1, max_length=100)
    category: Category = "Other"


class AssetEdit(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    category: Category


class Dimensions(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False, extra="forbid")
    width: float = Field(gt=0, le=1000)
    height: float = Field(gt=0, le=500)
    depth: float = Field(gt=0, le=1000)


def record(row):
    return {"id": row.id, "project_id": row.project_id, "name": row.name,
            "category": row.category, "status": row.status, "dimensions": row.dimensions,
            "size_bytes": row.size_bytes, "created_at": row.created_at}


async def owned(db, id, user, lock=False):
    query = select(SiteAsset).where(SiteAsset.id == id)
    if lock:
        query = query.with_for_update()
    row = await db.scalar(query)
    if not row:
        raise HTTPException(404, "Asset not found")
    await owned_project(db, row.project_id, user)
    return row


@router.get("/")
async def inventory(project_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    rows = (await db.scalars(select(SiteAsset).where(SiteAsset.project_id == project_id, SiteAsset.status == "ready").order_by(SiteAsset.created_at.desc()))).all()
    return [record(row) for row in rows]


@router.post("/", status_code=201)
async def register(data: Register, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, data.project_id, user)
    id = uuid4()
    row = SiteAsset(id=id, **data.model_dump(), storage_key=f"site-assets/{id}.glb",
                    upload_key=f"site-asset-uploads/{id}.glb", status="pending", size_bytes=0, dimensions={})
    db.add(row)
    await db.commit()
    return {"id": id, "upload_url": object_storage.presigned_put_url(row.upload_key, "model/gltf-binary")}


def publish(row):
    size = object_storage.head_object_size(row.upload_key)
    if not 20 <= size <= 512 * 1024 * 1024:
        raise ValueError("Choose a self-contained GLB under 512 MB")
    with tempfile.TemporaryDirectory(prefix="prosota-site-") as folder:
        file = Path(folder) / "asset.glb"
        object_storage.download_to_path(row.upload_key, file)
        raw = file.read_bytes()
        if len(raw) != size or struct.unpack_from("<4sII", raw) != (b"glTF", 2, size):
            raise ValueError("Invalid GLB file")
        length, kind = struct.unpack_from("<II", raw, 12)
        if kind != 0x4E4F534A or length > size - 20:
            raise ValueError("Invalid GLB metadata")
        data = json.loads(raw[20:20 + length])
        for entry in data.get("buffers", []) + data.get("images", []):
            if entry.get("uri"):
                raise ValueError("Embed all buffers and textures in the GLB before importing")
        if data.get("extensionsRequired"):
            raise ValueError("Export an uncompressed GLB without required extensions for this release")
        object_storage.upload_from_path(row.storage_key, file, "model/gltf-binary")
    return size


@router.post("/{id}/ready")
async def ready(id: UUID, data: Dimensions, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, id, user, True)
    if row.status == "archived":
        raise HTTPException(409, "Asset was removed from the library")
    if row.status != "ready":
        try:
            row.size_bytes = await run_in_threadpool(publish, row)
        except (ValueError, KeyError, struct.error) as exc:
            raise HTTPException(422, str(exc)) from exc
        row.dimensions = data.model_dump()
        row.status = "ready"
        await db.commit()
        await run_in_threadpool(object_storage.delete_object, row.upload_key)
    return record(row)


@router.get("/{id}/download")
async def download(id: UUID, direct: bool = False, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, id, user)
    if row.status not in ("ready", "archived"):
        raise HTTPException(409, "Asset is not ready")
    url = object_storage.presigned_get_url(row.storage_key)
    # Fetch storage separately from the authenticated API request. Keep the
    # redirect for older clients, but avoid cross-origin redirects in new ones.
    if direct:
        return {"download_url": url}
    return RedirectResponse(url)


@router.patch("/{id}")
async def edit(id: UUID, data: AssetEdit, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, id, user, True)
    if row.status != "ready":
        raise HTTPException(409, "Asset is not in the library")
    row.name, row.category = data.name.strip(), data.category
    if not row.name:
        raise HTTPException(422, "Enter an asset name")
    await db.commit()
    return record(row)


@router.delete("/{id}", status_code=204)
async def remove(id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, id, user, True)
    # Preserve pinned scene instances and undo/backup references to this version.
    row.status = "archived"
    await db.commit()
