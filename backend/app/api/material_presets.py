from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.schemas.material_preset import MaterialPresetResponse, MaterialPresetSlot
from app.services import material_preset as svc

router = APIRouter(prefix="/material-presets", tags=["material-presets"])


@router.get("/", response_model=list[MaterialPresetResponse])
async def list_presets(
    project_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> list:
    return await svc.list_presets(db, project_id)


def _slot_files(
    map: UploadFile | None, metalnessMap: UploadFile | None, roughnessMap: UploadFile | None,
    normalMap: UploadFile | None, aoMap: UploadFile | None, displacementMap: UploadFile | None,
) -> dict[MaterialPresetSlot, UploadFile]:
    raw: dict[MaterialPresetSlot, UploadFile | None] = {
        "map": map, "metalnessMap": metalnessMap, "roughnessMap": roughnessMap,
        "normalMap": normalMap, "aoMap": aoMap, "displacementMap": displacementMap,
    }
    return {slot: f for slot, f in raw.items() if f is not None and f.filename}


# multipart/form-data, not JSON (2026-07-13 fix) — a preset's six texture
# slots are real image files now, not base64 embedded in a JSON config (see
# material_preset_texture.py's own docstring on why: a genuine 8K texture
# blew straight through Postgres's 256MB-per-JSONB-element ceiling). Same
# "metadata as form fields alongside the file(s)" shape model3d_files.py's
# own create_file already uses, just with up to six optional files instead
# of one required one.
@router.post("/", response_model=MaterialPresetResponse, status_code=201)
async def create_preset(
    project_id: uuid.UUID = Form(...),
    name: str = Form(...),
    map: UploadFile | None = File(None),
    metalnessMap: UploadFile | None = File(None),
    roughnessMap: UploadFile | None = File(None),
    normalMap: UploadFile | None = File(None),
    aoMap: UploadFile | None = File(None),
    displacementMap: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
):
    slot_files = _slot_files(map, metalnessMap, roughnessMap, normalMap, aoMap, displacementMap)
    return await svc.create_preset(db, project_id, name, slot_files)


# cleared_slots: comma-joined slot names (2026-07-13) — explicitly nulls a
# slot without uploading a replacement. A slot named in neither a file
# field nor here is left completely untouched, so renaming a preset with
# several large existing textures doesn't require re-uploading any of them
# (see material_preset.py service's own update_preset).
@router.patch("/{preset_id}", response_model=MaterialPresetResponse)
async def update_preset(
    preset_id: uuid.UUID,
    name: str = Form(...),
    cleared_slots: str = Form(""),
    map: UploadFile | None = File(None),
    metalnessMap: UploadFile | None = File(None),
    roughnessMap: UploadFile | None = File(None),
    normalMap: UploadFile | None = File(None),
    aoMap: UploadFile | None = File(None),
    displacementMap: UploadFile | None = File(None),
    db: AsyncSession = Depends(get_db),
):
    slot_files = _slot_files(map, metalnessMap, roughnessMap, normalMap, aoMap, displacementMap)
    cleared: list[MaterialPresetSlot] = [s.strip() for s in cleared_slots.split(",") if s.strip()]  # type: ignore[assignment]
    return await svc.update_preset(db, preset_id, name, slot_files, cleared)


@router.get("/{preset_id}/textures/{slot}")
async def download_texture(
    preset_id: uuid.UUID,
    slot: MaterialPresetSlot,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    return await svc.get_texture_download(db, preset_id, slot)


@router.delete("/{preset_id}", status_code=204)
async def delete_preset(
    preset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
) -> Response:
    await svc.delete_preset(db, preset_id)
    return Response(status_code=204)
