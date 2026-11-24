import hashlib
import json
from typing import Literal
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
from app.schemas.site_scene import SiteItem, SceneEdit, HistoryEdit
from app.services import site_history
from app.services.clash_access import owned_project
from app.services.site_scene import evaluate, zone_points

router = APIRouter(prefix="/site-scenes", tags=["site-scenes"])


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


class StaleLayoutSource(HTTPException):
    """The stored boundary can render independently of its authoring path or zone."""


def signature_opening(opening):
    return {key: value for key, value in opening.items()
            if not (key == "pose" and value is None or key == "pose_keys" and not value)}


def construction_signature(item):
    """Preserve pending command identities across the construction-tools release."""
    def omit_defaults(value, defaults):
        return {k:v for k,v in value.items() if k not in defaults or v != defaults[k]}
    item = omit_defaults(item, dict(stage_window=None, pick_lifts=[], construction_mode=None,
                                    construction_sources=[], measured_bearing=False))
    if item.get("enclosure"):
        enclosure = omit_defaults(item["enclosure"], dict(scaffold=None, barrier_base="feet",
                                  blanket=False, reflective=False, blanket_bays=None))
        enclosure["openings"] = [omit_defaults(gate, {"posters":[]}) for gate in enclosure["openings"]]
        item["enclosure"] = enclosure
    return item


async def previously_saved_scene(db, project_id, revision, items, signature_data):
    receipts = select(SiteSceneCommand).where(SiteSceneCommand.project_id == project_id)
    previous = [construction_signature(item) for item in items]
    hashes = {fingerprint(items), fingerprint(previous)}
    # Receipts saved before gate poses did not include empty pose fields.
    if any(item.get("enclosure") for item in items):
        legacy = []
        for item in previous:
            enclosure = item.get("enclosure")
            if enclosure:
                openings = [signature_opening(gate) for gate in enclosure["openings"]]
                item = {**item, "enclosure": {**enclosure, "openings": openings}}
            legacy.append(item)
        hashes.add(fingerprint(legacy))
    prior = await db.execute(receipts.where(SiteSceneCommand.before_removal_hash.in_(hashes)).limit(1))
    if prior.scalar_one_or_none() is not None:
        return True
    # Old browser tabs can retry their pending Undo after a backend deployment.
    # For deletions made before removal fingerprints, check the exact prior PUT.
    prior = await db.execute(receipts.where(SiteSceneCommand.revision == revision - 1))
    return any(command.request_hash == fingerprint({**signature_data, "command_id": str(command.id),
               "expected_revision": command.revision - 1}) for command in prior.scalars())


def result(row):
    return {"revision": row.revision if row else 0, "items": [evaluate(i) for i in row.items] if row else [],
            "history": site_history.summaries(row.history if row else None)}


def pose_only(before, after):
    if not before or not before.get("enclosure") or not after.get("enclosure"):
        return False

    def fixed(item):
        enclosure = item["enclosure"]
        openings = [{k: v for k, v in opening.items() if k not in ("pose", "pose_keys")}
                    for opening in enclosure["openings"]]
        return {**item, "enclosure": {**enclosure, "openings": openings}}

    return fixed(before) == fixed(after)


async def validate_item(db, project_id, item, references=None, *, restore_layout=False):
    # A split assembly can have thousands of items sharing one library asset.
    # Retain lookups for this request only, including missing references.
    if references is None:
        references = {}

    async def lookup(model, identity):
        key = (model, identity)
        if key not in references:
            references[key] = await db.get(model, identity)
        return references[key]

    asset_ids = {item.asset_id} if item.asset_id else set()
    asset_ids.update(r.asset_id for r in item.instance_overrides.values())
    if item.geographic:
        asset_ids.update(f.replacement.asset_id for f in item.geographic.features if f.replacement)
    for asset_id in asset_ids:
        asset = await lookup(SiteAsset, asset_id)
        if not asset or asset.project_id != project_id or asset.status not in ("ready", "archived"):
            raise HTTPException(422, "Choose a ready asset in this project")
    if item.activity_id:
        activity = await lookup(Activity, item.activity_id)
        if not activity or activity.project_id != project_id:
            raise HTTPException(422, "Choose an activity in this project")
        if not activity.start or not activity.finish:
            raise HTTPException(422, "The linked activity needs start and finish dates")
    stage_refs = {pick.activity_id for pick in item.pick_lifts}
    if item.stage_window:
        stage_refs.update(ref for ref in (item.stage_window.from_activity_id, item.stage_window.until_activity_id) if ref)
    for ref in stage_refs:
        activity = await lookup(Activity, ref)
        if not activity or activity.project_id != project_id or not activity.start or not activity.finish:
            raise HTTPException(422, "Choose dated construction activities in this project")
    if item.path_motion:
        motion_path = await lookup(Path, item.path_motion.path_id)
        if not motion_path or motion_path.project_id != project_id or len(motion_path.points) < 2:
            raise HTTPException(422, "Choose a movement path in this project with at least two points")
    if item.kind in ("fence", "shape", "array", "scatter") and item.path_id:
        path = await lookup(Path, item.path_id)
        if path and path.project_id != project_id:
            raise HTTPException(422, "The source path is missing or belongs to another project")
        if not restore_layout:
            if not path:
                raise StaleLayoutSource(422, "The source path is missing")
            if path.points != [p.model_dump(mode="json") for p in item.points] or path.closed != item.closed or (getattr(path, "curve_mode", "curved") != item.curve_mode):
                raise StaleLayoutSource(409, "The source path changed. Preview it again before saving")
    if item.zone_id and item.kind in ("shape", "array", "scatter"):
        zone = await lookup(Zone, item.zone_id)
        if zone and zone.project_id != project_id:
            raise HTTPException(422, "Choose a zone in this project")
        if not restore_layout:
            if not zone:
                raise StaleLayoutSource(422, "The source zone is missing")
            expected = zone_points(zone, item.up_axis)
            if len(expected) != len(item.points) or any(abs(a[k]-getattr(b,k))>1e-7 for a,b in zip(expected,item.points) for k in "xyz"):
                raise StaleLayoutSource(409, "The source zone changed. Preview again before saving")
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
    signature_data = data.model_dump(mode="json")
    if signature_data["label"] is None:
        del signature_data["label"]
    # A retry sent across this release must match its pre-enclosure command.
    signature_data["items"] = [construction_signature(item) for item in signature_data["items"]]
    for recipe in signature_data["items"]:
        if recipe.get("enclosure"):
            enclosure = recipe["enclosure"]
            enclosure["openings"] = [signature_opening(gate) for gate in enclosure["openings"]]
        for field in ("enclosure", "tower_cover"):
            if recipe[field] is None:
                del recipe[field]
    signature = fingerprint(signature_data)
    row, repeated = await checked_scene(db, project_id, data, signature)
    if repeated:
        return result(row)
    old = {i["id"]: SiteItem.model_validate(i).model_dump(mode="json") for i in row.items} if row else {}
    items = [i.model_dump(mode="json") for i in data.items]
    references = {}
    restoring = None
    for item, encoded in zip(data.items, items):
        before = old.get(str(item.id))
        if before == encoded:
            continue
        if before and before.get("locked") and encoded.get("locked"):
            raise HTTPException(409, "Unlock this object before changing it")
        try:
            await validate_item(db, project_id, item, references, restore_layout=pose_only(before, encoded))
        except StaleLayoutSource:
            if before is not None or not row:
                raise
            if restoring is None:
                restoring = await previously_saved_scene(db, project_id, row.revision, items, signature_data)
            if not restoring:
                raise
            await validate_item(db, project_id, item, references, restore_layout=True)
    if sum(len((evaluate(i).get("layout") or {}).get("panels", [])) for i in items) > 5000:
        raise HTTPException(422, "This site scene is limited to 5,000 fence panels")
    if sum(len((evaluate(i).get("layout") or {}).get("placements", [])) for i in items) > 1000:
        raise HTTPException(422, "Limit the scene to 1,000 generated placements")
    new_ids = {i["id"] for i in items}
    if any(i.get("locked") and i["id"] not in new_ids for i in old.values()):
        raise HTTPException(409, "Unlock an object before removing it")
    if not row:
        row = SiteScene(project_id=project_id, revision=0, items=[])
        db.add(row)
    row.history = site_history.record(row.history, data.command_id, data.label, row.items, items)
    row.items = items
    row.revision += 1
    db.add(SiteSceneCommand(id=data.command_id, project_id=project_id, request_hash=signature, revision=row.revision,
                            before_removal_hash=fingerprint(list(old.values())) if old.keys() - new_ids else None))
    await db.commit()
    return result(row)


async def checked_scene(db, project_id, data, signature):
    await db.execute(select(Project.id).where(Project.id == project_id).with_for_update())
    row = await db.get(SiteScene, project_id)
    receipt = await db.get(SiteSceneCommand, data.command_id)
    if receipt:
        if receipt.project_id != project_id or receipt.request_hash != signature:
            raise HTTPException(409, "Command ID already used for a different operation")
        return row, True
    if (row.revision if row else 0) != data.expected_revision:
        raise HTTPException(409, "Site scene changed. Reload the site objects before continuing.")
    return row, False


@router.post("/{project_id}/history/{direction}")
async def travel(project_id: UUID, direction: Literal["undo", "redo"], data: HistoryEdit,
                 db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await owned_project(db, project_id, user)
    signature = fingerprint({"operation": direction, **data.model_dump(mode="json")})
    row, repeated = await checked_scene(db, project_id, data, signature)
    if repeated:
        return result(row)
    if not row:
        raise HTTPException(409, "There are no saved site edits for this project.")
    try:
        items, history = site_history.replay(row.history, row.items, data.action_id, direction)
    except ValueError as error:
        raise HTTPException(409, str(error)) from error
    # Only database-held recipes, previously saved in this project, can reach here.
    row.items, row.history = items, history
    row.revision += 1
    db.add(SiteSceneCommand(id=data.command_id, project_id=project_id,
                            request_hash=signature, revision=row.revision))
    await db.commit()
    return result(row)
