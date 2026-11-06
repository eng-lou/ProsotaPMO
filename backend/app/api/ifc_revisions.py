from __future__ import annotations
import copy
import hashlib
import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select, delete, update, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.core.auth import get_db_user
from app.models.project import Project
from app.models.model3d_file import Model3DFile
from app.models.model_element_link import ModelElementLink
from app.models.activity import Activity
from app.models.element_keyframe import ElementKeyframe
from app.models.element_transform import ElementTransform
from app.models.element_split import ElementSplit
from app.models.path_follower import PathFollower
from app.models.section_box import SectionBox
from app.models.collection import Collection
from app.models.collection_member import CollectionMember
from app.models.cost_element import CostElement
from app.models.cost_rate_line import CostRateLine
from app.models.period import Period
from app.models.resource_assignment import ResourceAssignment
from app.services import object_storage, ifc_revision as svc

router = APIRouter(prefix='/model3d-files', tags=['IFC revisions'])

@router.post('/ifc-boq/{cost_element_id}/quantities')
async def boq_quantities(cost_element_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    cost = await db.get(CostElement, cost_element_id)
    project = await db.get(Project, cost.project_id) if cost else None
    if not project or project.org_id != user.org_id or project.created_by != user.id: raise HTTPException(404, 'BOQ not found')
    if cost.element_group != 'BOQ': raise HTTPException(422, 'Choose a BOQ')
    models = (await db.execute(select(Model3DFile).where(Model3DFile.project_id == project.id, Model3DFile.kind == 'ifc'))).scalars().all()
    quantities, duplicates = {}, set()
    for model in models:
        result = await run_in_threadpool(svc.process, dict(baseline_key=model.storage_filename, candidate_key=model.storage_filename), 'quantities')
        for guid, area in result['elements'].items():
            if guid in quantities: duplicates.add(guid)
            quantities[guid] = area
    links = (await db.execute(select(ModelElementLink, Activity).join(Activity, Activity.id == ModelElementLink.activity_id)
        .where(ModelElementLink.project_id == project.id, ModelElementLink.source_kind == 'ifc'))).all()
    by_code = {}
    for link, activity in links: by_code.setdefault(activity.code, set()).add(link.element_ref)
    lines = (await db.execute(select(CostRateLine).where(CostRateLine.cost_element_id == cost.id))).scalars().all()
    proposals = []
    for line in lines:
        code = (line.cost_code or '').split('/')[-1]
        guids = by_code.get(code, set())
        if not guids:
            if line.quantity_review_required: proposals.append(dict(id=str(line.id), description=line.description, area_m2=None, qty=None, note='No current IFC links. Review this line manually, including any removed scope.'))
            continue
        if any(g in duplicates or g not in quantities for g in guids):
            proposals.append(dict(id=str(line.id), description=line.description, area_m2=None, qty=None, note='Ambiguous, missing or split IFC elements; measure this line manually.'))
            continue
        areas = [quantities[g] for g in guids]
        basis = {a['basis'] for a in areas if a}
        area = sum(a['m2'] for a in areas) if all(areas) and len(basis) == 1 else None
        unit_name = (line.unit or '').lower().strip()
        qty = area if unit_name in ('m2', 'm²') else len(guids) if unit_name in ('nr', 'no', 'no.', 'each', 'ea') else None
        proposals.append(dict(id=str(line.id), description=line.description, area_m2=area, qty=qty,
            note=f"{len(guids)} linked elements. " + (next(iter(basis)) if area is not None else 'No complete, consistent area quantity supplied.')))
    return proposals

async def owned(db, file_id, user, lock=False):
    query = select(Model3DFile).where(Model3DFile.id == file_id)
    if lock: query = query.with_for_update()
    row = (await db.execute(query)).scalar_one_or_none()
    project = await db.get(Project, row.project_id) if row else None
    if not project or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, 'Model not found')
    return row

def review_for(row, revision_id):
    review = next((r for r in row.ifc_revisions or [] if r['id'] == str(revision_id)), None)
    if not review: raise HTTPException(404, 'Revision review not found')
    return copy.deepcopy(review)

def save_review(row, review):
    row.ifc_revisions = [review if r['id'] == review['id'] else r for r in row.ifc_revisions or []]

def current(row, review):
    if review['baseline_key'] != row.storage_filename:
        raise HTTPException(409, 'The model has changed since this review started. Compare the revised file again.')

@router.get('/{file_id}/content-version')
async def content_version(file_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user)
    return {'version': hashlib.sha256(row.storage_filename.encode()).hexdigest()[:24]}

@router.get('/{file_id}/revisions')
async def history(file_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user)
    return [svc.public(r) for r in row.ifc_revisions or []]

class Start(BaseModel):
    name: str = Field(min_length=1, max_length=300)

@router.post('/{file_id}/revisions')
async def start(file_id: uuid.UUID, payload: Start, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user, True)
    if row.kind != 'ifc' or not payload.name.lower().endswith(('.ifc', '.ifc.gz')):
        raise HTTPException(422, 'Choose an IFC revision of this model.')
    key = object_storage.generate_storage_key('ifc-revisions', 'candidate.ifc.gz')
    review = dict(id=str(uuid.uuid4()), name=payload.name, baseline_name=row.name, baseline_key=row.storage_filename,
                  candidate_key=key, upload_key=key, status='uploading', created_at=datetime.now(timezone.utc).isoformat(), reviewer=str(user.id))
    row.ifc_revisions = [*(row.ifc_revisions or []), review]
    await db.commit()
    return {'id': review['id'], 'upload_url': object_storage.presigned_put_url(key, 'application/gzip')}

@router.post('/{file_id}/revisions/{revision_id}/compare')
async def compare(file_id: uuid.UUID, revision_id: uuid.UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user, True)
    review = review_for(row, revision_id)
    current(row, review)
    if review['status'] == 'applied': raise HTTPException(409, 'This review is already applied.')
    # Freeze a private candidate copy: the original signed PUT may remain valid after review.
    if review['status'] == 'uploading':
        import tempfile
        import gzip
        from pathlib import Path
        def freeze():
            with tempfile.TemporaryDirectory(prefix='prosota-review-freeze-') as folder:
                source = Path(folder) / 'source.ifc'
                svc.unpack(review['candidate_key'], source)
                packed = Path(folder) / 'snapshot.ifc.gz'
                with source.open('rb') as incoming, gzip.open(packed, 'wb') as outgoing:
                    while chunk := incoming.read(1024 * 1024): outgoing.write(chunk)
                key = object_storage.generate_storage_key('ifc-revisions', 'snapshot.ifc.gz')
                object_storage.upload_from_path(key, packed, 'application/gzip')
                return key
        review['candidate_key'] = await run_in_threadpool(freeze)
    report = await run_in_threadpool(svc.process, review, 'compare')
    links = (await db.execute(select(ModelElementLink, Activity).join(Activity, Activity.id == ModelElementLink.activity_id)
        .where(ModelElementLink.project_id == row.project_id, ModelElementLink.source_kind == 'ifc'))).all()
    activity_ids = {a.id for _, a in links}
    resources = dict((await db.execute(select(ResourceAssignment.activity_id, func.count()).where(ResourceAssignment.activity_id.in_(activity_ids)).group_by(ResourceAssignment.activity_id))).all())
    costs = dict((await db.execute(select(CostElement.linked_activity_id, func.count()).where(CostElement.project_id == row.project_id, CostElement.linked_activity_id.in_(activity_ids)).group_by(CostElement.linked_activity_id))).all())
    for change in report['changes']:
        change['assignments'] = [{'id': str(link.id), 'activity_id': str(activity.id), 'code': activity.code, 'name': activity.task_name,
                                  'resource_count': resources.get(activity.id, 0), 'cost_count': costs.get(activity.id, 0)}
                                 for link, activity in links if link.element_ref.split('::split:')[0] == change['guid']]
    review.update(report=report, status='review')
    save_review(row, review)
    await db.commit()
    return svc.public(review)

@router.get('/{file_id}/revisions/{revision_id}/geometry/{guid}')
async def geometry(file_id: uuid.UUID, revision_id: uuid.UUID, guid: str, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user)
    review = review_for(row, revision_id)
    if guid not in {c['guid'] for c in review.get('report', {}).get('changes', [])}: raise HTTPException(404, 'Changed element not found')
    return await run_in_threadpool(svc.process, review, 'preview', guid=guid)

class Decision(BaseModel):
    action: Literal['accept', 'reject']
    assignments: Literal['keep', 'remove'] = 'keep'
    rationale: str = Field(default='', max_length=4000)

class Apply(BaseModel):
    decisions: dict[str, Decision]

@router.put('/{file_id}/revisions/{revision_id}/draft')
async def save_draft(file_id: uuid.UUID, revision_id: uuid.UUID, payload: Apply, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user, True)
    review = review_for(row, revision_id)
    current(row, review)
    if review['status'] != 'review': raise HTTPException(409, 'This review is not editable.')
    allowed = {c['guid'] for c in review['report']['changes']}
    if not set(payload.decisions) <= allowed: raise HTTPException(422, 'Unknown changed element')
    review['decisions'] = {g: d.model_dump() for g, d in payload.decisions.items()}
    save_review(row, review)
    await db.commit()
    return svc.public(review)

@router.post('/{file_id}/revisions/{revision_id}/apply')
async def apply(file_id: uuid.UUID, revision_id: uuid.UUID, payload: Apply, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await owned(db, file_id, user, True)
    review = review_for(row, revision_id)
    if review['status'] == 'applied': return svc.public(review)
    current(row, review)
    if review['status'] != 'review': raise HTTPException(409, 'Compare the revision before applying it.')
    decisions = {g: d.model_dump() for g, d in payload.decisions.items()}
    svc.validate_decisions(review['report'], decisions)
    changes = review['report']['changes']
    accepted = {c['guid'] for c in changes if decisions[c['guid']]['action'] == 'accept'}
    removed = {c['guid'] for c in changes if c['kind'] == 'removed' and c['guid'] in accepted}
    unlink = removed | {g for g in accepted if decisions[g]['assignments'] == 'remove'}
    # Links are project-scoped GUIDs. Refuse destructive ambiguity with federated files.
    others = (await db.execute(select(Model3DFile).where(Model3DFile.project_id == row.project_id,
        Model3DFile.kind == 'ifc', Model3DFile.id != row.id))).scalars().all()
    if unlink and others:
        # Native GUID enumeration is isolated, just like comparison.
        for other in others:
            ids = await run_in_threadpool(svc.process, dict(baseline_key=other.storage_filename, candidate_key=other.storage_filename), 'identities')
            if unlink & set(ids['guids']): raise HTTPException(409, 'An affected GlobalId also exists in another loaded IFC. Resolve the duplicate before removing its project-wide assignments.')
    live_links = (await db.execute(select(ModelElementLink).where(ModelElementLink.project_id == row.project_id,
        ModelElementLink.source_kind == 'ifc', func.split_part(ModelElementLink.element_ref, '::split:', 1).in_(accepted)))).scalars().all()
    expected_links = {a['id'] for c in changes if c['guid'] in accepted for a in c['assignments']}
    if {str(x.id) for x in live_links} != expected_links:
        raise HTTPException(409, 'Element assignments changed during review. Compare again before applying decisions.')
    result = await run_in_threadpool(svc.process, review, 'merge', decisions=decisions) if accepted else dict(storage_key=row.storage_filename, size_bytes=row.size_bytes)
    # The existing conversion cache is specific to this file. Invalidate only
    # this derived object; original revision sources remain retained in history.
    from app.services.ifc_conversion import converted_key
    await run_in_threadpool(object_storage.delete_object, converted_key(row.id))
    affected_links = (await db.execute(select(ModelElementLink).where(ModelElementLink.project_id == row.project_id,
        ModelElementLink.source_kind == 'ifc', func.split_part(ModelElementLink.element_ref, '::split:', 1).in_(accepted)))).scalars().all()
    if {str(x.id) for x in affected_links} != expected_links:
        raise HTTPException(409, 'Element assignments changed while the IFC was being processed. Compare again before applying decisions.')
    review['affected_activity_ids'] = sorted({str(x.activity_id) for x in affected_links})
    if unlink:
        await db.execute(delete(ModelElementLink).where(ModelElementLink.project_id == row.project_id,
            ModelElementLink.source_kind == 'ifc', func.split_part(ModelElementLink.element_ref, '::split:', 1).in_(unlink)))
    if removed:
        # These rows refer exclusively to elements explicitly accepted as removed.
        # Their child slices no longer have a source element to reconstruct from.
        await db.execute(delete(ElementSplit).where(ElementSplit.project_id == row.project_id,
            ElementSplit.source_kind == 'ifc', ElementSplit.element_ref.in_(removed)))
        await db.execute(delete(PathFollower).where(PathFollower.project_id == row.project_id,
            PathFollower.target_kind == 'ifc', func.split_part(PathFollower.element_ref, '::split:', 1).in_(removed)))
        await db.execute(delete(SectionBox).where(SectionBox.model3d_file_id == row.id,
            func.split_part(SectionBox.element_ref, '::split:', 1).in_(removed)))
        await db.execute(delete(ElementKeyframe).where(ElementKeyframe.project_id == row.project_id,
            ElementKeyframe.source_kind == 'ifc', func.split_part(ElementKeyframe.element_ref, '::split:', 1).in_(removed)))
        await db.execute(delete(CollectionMember).where(CollectionMember.collection_id.in_(select(Collection.id).where(Collection.project_id == row.project_id)),
            CollectionMember.source_kind == 'ifc', func.split_part(CollectionMember.element_ref, '::split:', 1).in_(removed)))
    # Revised source geometry replaces local element overrides; whole-model placement survives.
    if accepted:
        await db.execute(delete(ElementTransform).where(ElementTransform.model3d_file_id == row.id, ElementTransform.element_ref.in_(accepted)))
        # Manual and generated BOQ lines both require review; never overwrite approved prices or baselines.
        await db.execute(update(CostRateLine).where(CostRateLine.cost_element_id.in_(select(CostElement.id).where(
            CostElement.project_id == row.project_id, CostElement.element_group == 'BOQ',
            CostElement.period_id.in_(select(Period.id).where(Period.freeze_status == 'live'))))).values(quantity_review_required=True))
    row.unloaded_elements = [x for x in row.unloaded_elements or [] if x['guid'] not in removed]
    row.storage_filename = result['storage_key']
    row.size_bytes = result['size_bytes']
    review.update(status='applied', decisions=decisions, applied_at=datetime.now(timezone.utc).isoformat(), result_key=result['storage_key'])
    save_review(row, review)
    await db.commit()
    return svc.public(review)
