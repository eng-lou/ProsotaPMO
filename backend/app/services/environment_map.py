from __future__ import annotations

import uuid

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.environment_map import EnvironmentMap
from app.schemas.environment_map import EnvironmentMapResponse
from app.schemas.model3d_file import PresignedUpload
from app.services import object_storage

STORAGE_PREFIX = "environment-maps"


async def get_for_project(db: AsyncSession, project_id: uuid.UUID) -> EnvironmentMapResponse | None:
    row = (await db.execute(
        select(EnvironmentMap).where(EnvironmentMap.project_id == project_id)
    )).scalar_one_or_none()
    return EnvironmentMapResponse.model_validate(row) if row is not None else None


def presign_upload(name: str, content_type: str) -> PresignedUpload:
    storage_key = object_storage.generate_storage_key(STORAGE_PREFIX, name)
    upload_url = object_storage.presigned_put_url(storage_key, content_type)
    return PresignedUpload(storage_key=storage_key, upload_url=upload_url)


# Replaces the project's existing environment (one per project), deleting
# its stored object — see EnvironmentMap's own docstring.
async def set_for_project(
    db: AsyncSession, project_id: uuid.UUID, name: str, storage_key: str,
) -> EnvironmentMapResponse:
    # Only keys this feature's own /presign handed out.
    if not storage_key.startswith(f"{STORAGE_PREFIX}/"):
        raise HTTPException(status_code=400, detail="Invalid environment storage key")
    try:
        size = await run_in_threadpool(object_storage.head_object_size, storage_key)
    except Exception:
        raise HTTPException(
            status_code=400, detail="Uploaded environment not found in storage — the upload may have failed or expired",
        ) from None

    existing = (await db.execute(
        select(EnvironmentMap).where(EnvironmentMap.project_id == project_id)
    )).scalar_one_or_none()
    if existing is not None:
        await run_in_threadpool(object_storage.delete_object, existing.storage_filename)
        await db.delete(existing)
        await db.flush()

    row = EnvironmentMap(project_id=project_id, name=name, storage_filename=storage_key, size_bytes=size)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return EnvironmentMapResponse.model_validate(row)


async def get_download(db: AsyncSession, env_id: uuid.UUID) -> RedirectResponse:
    row = await db.get(EnvironmentMap, env_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    url = await run_in_threadpool(object_storage.presigned_get_url, row.storage_filename)
    return RedirectResponse(url)


async def delete(db: AsyncSession, env_id: uuid.UUID) -> None:
    row = await db.get(EnvironmentMap, env_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Environment not found")
    await run_in_threadpool(object_storage.delete_object, row.storage_filename)
    await db.delete(row)
    await db.commit()
