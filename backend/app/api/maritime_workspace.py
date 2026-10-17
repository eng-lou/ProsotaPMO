from uuid import UUID
import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from app.core.auth import get_db_user
from app.database import get_db
from app.models.project import Project
from app.models.maritime_workspace import MaritimeWorkspace, MaritimeRun
from app.models.activity import Activity
from app.models.resource import Resource
from app.schemas.maritime_workspace import WorkspaceDefinition, WorkspaceSave, RunRequest, AttemptRequest
from app.services.clash_access import owned_project
from app.services.maritime_operations import compare, assess_attempt

router = APIRouter(prefix='/maritime/projects', tags=['maritime-projects'])


async def access(db, project_id, user, lock=False):
    project = await owned_project(db, project_id, user)
    if project.workspace != 'maritime':
        raise HTTPException(409, 'Open a Maritime project to use this workspace')
    if lock:
        await db.scalar(select(Project).where(Project.id == project_id).with_for_update())
    return await db.get(MaritimeWorkspace, project_id)


def state(row):
    return {'version': row.version if row else 0,
            'definition': row.definition if row else WorkspaceDefinition().model_dump(mode='json')}


def check_version(row, version):
    if (row.version if row else 0) != version:
        raise HTTPException(409, 'The project changed in another tab. Reload before saving or running.')


@router.get('/{project_id}/workspace')
async def get_workspace(project_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    return state(await access(db, project_id, user))


@router.put('/{project_id}/workspace')
async def save_workspace(project_id: UUID, data: WorkspaceSave, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await access(db, project_id, user, True)
    check_version(row, data.version)
    for asset in data.definition.assets:
        for model, id in ((Resource, asset.resource_id), (Activity, asset.activity_id)):
            if id:
                linked = await db.get(model, id)
                if not linked or linked.project_id != project_id:
                    raise HTTPException(422, 'Linked resources and activities must belong to this project')
    definition = data.definition.model_dump(mode='json')
    if len(json.dumps(definition).encode('utf-8')) > 2_000_000:
        raise HTTPException(413, 'Maritime working plan exceeds 2 MB. Reduce linked element selections.')
    if row:
        row.definition = definition
        row.version += 1
    else:
        row = MaritimeWorkspace(project_id=project_id, version=1, definition=definition)
        db.add(row)
    await db.commit()
    return state(row)


@router.get('/{project_id}/runs')
async def list_runs(project_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await access(db, project_id, user)
    rows = (await db.scalars(select(MaritimeRun).where(MaritimeRun.project_id == project_id)
                            .order_by(MaritimeRun.created_at.desc()).limit(100))).all()
    return [{'id': r.id, 'version': r.version, 'kind': r.kind, 'name': r.name, 'created_at': r.created_at} for r in rows]


@router.get('/{project_id}/runs/{run_id}')
async def get_run(project_id: UUID, run_id: UUID, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    await access(db, project_id, user)
    row = await db.get(MaritimeRun, run_id)
    if not row or row.project_id != project_id:
        raise HTTPException(404, 'Run not found')
    return row


@router.post('/{project_id}/runs', status_code=201)
async def run_scenario(project_id: UUID, data: RunRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await access(db, project_id, user, True)
    check_version(row, data.version)
    if not row:
        raise HTTPException(409, 'Save the working plan first')
    plan = WorkspaceDefinition.model_validate(row.definition)
    scenario = next((s for s in plan.scenarios if s.id == data.scenario_id), None)
    if data.scenario_id and not scenario:
        raise HTTPException(404, 'Scenario not found')
    try:
        results = await run_in_threadpool(compare, plan, scenario)
    except ValueError as e:
        raise HTTPException(422, str(e))
    run = MaritimeRun(project_id=project_id, version=row.version, kind='operations',
                      name=scenario.name if scenario else 'Working plan',
                      inputs={'plan': row.definition, 'scenario_id': str(data.scenario_id) if data.scenario_id else None}, results=results)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


@router.post('/{project_id}/attempts', status_code=201)
async def save_attempt(project_id: UUID, data: AttemptRequest, db: AsyncSession = Depends(get_db), user=Depends(get_db_user)):
    row = await access(db, project_id, user, True)
    check_version(row, data.version)
    if not row:
        raise HTTPException(409, 'Save the exercise first')
    plan = WorkspaceDefinition.model_validate(row.definition)
    exercise = next((e for e in plan.exercises if e.id == data.exercise_id), None)
    if not exercise:
        raise HTTPException(404, 'Exercise not found')
    try:
        results = assess_attempt(exercise, data.actions)
    except ValueError as e:
        raise HTTPException(422, str(e))
    run = MaritimeRun(project_id=project_id, version=row.version, kind='safety', name=exercise.name,
                      inputs={'exercise': exercise.model_dump(mode='json'), 'asset': next(a.model_dump(mode='json') for a in plan.assets if a.id == exercise.asset_id)}, results=results)
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run
