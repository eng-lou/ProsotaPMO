import hashlib
import json
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_db_user
from app.database import get_db
from app.models.project import Project
from app.models.path import Path
from app.models.zone import Zone
from app.models.activity import Activity
from app.models.site_asset import SiteAsset
from app.models.site_scene import SiteScene, SiteSceneCommand
from app.schemas.site_scene import SiteItem, SceneEdit
from app.services.clash_access import owned_project
from app.services.site_scene import evaluate, zone_points

router = APIRouter(prefix="/site-scenes", tags=["site-scenes"])


def result(row):
    return {"revision": row.revision if row else 0, "items": [evaluate(i) for i in row.items] if row else []}


async def validate_item(db, project_id, item):
    if item.asset_id:
        asset = await db.get(SiteAsset, item.asset_id)
        if not asset or asset.project_id != project_id or asset.status not in ("ready", "archived"):
            raise HTTPException(422, "Choose a ready asset in this project")
    if item.activity_id:
        activity = await db.get(Activity, item.activity_id)
        if not activity or activity.project_id != project_id:
            raise HTTPException(422, "Choose an activity in this project")
        if not activity.start or not activity.finish:
            raise HTTPException(422, "The linked activity needs start and finish dates")
    if item.path_motion:
        motion_path = await db.get(Path, item.path_motion.path_id)
        if not motion_path or motion_path.project_id != project_id or len(motion_path.points) < 2:
            raise HTTPException(422, "Choose a movement path in this project with at least two points")
    if item.kind in ("fence", "shape", "array", "scatter") and item.path_id:
        path = await db.get(Path, item.path_id)
        if not path or path.project_id != project_id:
            raise HTTPException(422, "The source path is missing or belongs to another project")
        if path.points != [p.model_dump() for p in item.points] or path.closed != item.closed or (getattr(path, "curve_mode", "curved") != item.curve_mode):
            raise HTTPException(409, "The source path changed. Preview it again before saving")
    if item.zone_id and item.kind in ("shape", "array", "scatter"):
        zone = await db.get(Zone, item.zone_id)
        if not zone or zone.project_id != project_id:
            raise HTTPException(422, "Choose a zone in this project")
        expected = zone_points(zone, item.up_axis)
        if len(expected) != len(item.points) or any(abs(a[k]-getattr(b,k))>1e-7 for a,b in zip(expected,item.points) for k in "xyz"):
            raise HTTPException(409, "The source zone changed. Preview again before saving")
    try:
        return evaluate(item.model_dump(mode="json"))
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


@router.get("/{project_id}")
async def get_scene(project_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    return result(await db.get(SiteScene, project_id))


@router.post("/{project_id}/preview")
async def preview(project_id: UUID, item: SiteItem, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    return await validate_item(db, project_id, item)


@router.put("/{project_id}")
async def commit(project_id: UUID, data: SceneEdit, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    # Serialize initial creation and every command against the same parent row.
    await db.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    row = await db.get(SiteScene, project_id)
    signature = hashlib.sha256(json.dumps(data.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()
    previous = await db.get(SiteSceneCommand, data.command_id)
    if previous:
        if previous.project_id != project_id or previous.request_hash != signature:
            raise HTTPException(409, "Command ID already used for a different operation")
        return result(row)
    if (row.revision if row else 0) != data.expected_revision:
        raise HTTPException(409, "Site scene changed. Reload before saving")
    old = {i["id"]: SiteItem.model_validate(i).model_dump(mode="json") for i in row.items} if row else {}
    items = [i.model_dump(mode="json") for i in data.items]
    for item, encoded in zip(data.items, items):
        before = old.get(str(item.id))
        if before == encoded:
            continue
        if before and before.get("locked") and encoded.get("locked"):
            raise HTTPException(409, "Unlock this object before changing it")
        await validate_item(db, project_id, item)
    if sum(len((evaluate(i).get("layout") or {}).get("panels", [])) for i in items) > 5000:
        raise HTTPException(422, "This site scene is limited to 5,000 fence panels")
    if sum(len((evaluate(i).get("layout") or {}).get("placements", [])) for i in items) > 1000:
        raise HTTPException(422, "Limit the scene to 1,000 generated placements")
    if any(i.get("locked") and i["id"] not in {j["id"] for j in items} for i in old.values()):
        raise HTTPException(409, "Unlock an object before removing it")
    if not row:
        row = SiteScene(project_id=project_id, revision=0, items=[])
        db.add(row)
    row.items = items
    row.revision += 1
    db.add(SiteSceneCommand(id=data.command_id, project_id=project_id, request_hash=signature, revision=row.revision))
    await db.commit()
    return result(row)
