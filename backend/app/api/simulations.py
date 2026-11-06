from uuid import UUID
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import get_db_user
from app.database import get_db
from app.models.simulation import SimulationScenario, WorkingSimulationSequence
from app.models.schedule_period import SchedulePeriod
from app.models.activity_step import ActivityStep
from app.models.activity import Activity
from app.schemas.simulation import ScenarioCreate, ScenarioUpdate, SimulationConfig, ApplySimulation
from app.services import simulation as svc
from app.services.clash_access import owned_project

router=APIRouter(prefix='/simulations',tags=['simulations'])

class Revision(BaseModel):
    revision:int

class Run(Revision):
    estimate:bool=False

class Selection(Revision):
    activity_ids:list[str]=Field(min_length=1,max_length=300)

class Promote(Revision):
    working_revision:int=Field(default=0,ge=0)

def working_response(row,current_hash):
    return dict(revision=row.revision,scenario=row.snapshot,status='current' if row.source_hash==current_hash else 'stale',updated_at=row.updated_at)


@router.get('/working')
async def working(project_id:UUID,schedule_period_id:UUID,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    await owned_project(db,project_id,user)
    src=await svc.sources(db,project_id,schedule_period_id)
    row=await db.get(WorkingSimulationSequence,schedule_period_id)
    return working_response(row,src['hash']) if row else None


@router.delete('/working')
async def remove_working(project_id:UUID,schedule_period_id:UUID,revision:int,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    await owned_project(db,project_id,user)
    await svc.sources(db,project_id,schedule_period_id)
    period=await db.scalar(select(SchedulePeriod).where(SchedulePeriod.id==schedule_period_id).with_for_update())
    if period.freeze_status!='live' or period.baseline_locked_flag:raise HTTPException(409,'Only a live working period can be changed')
    row=await db.get(WorkingSimulationSequence,schedule_period_id,populate_existing=True)
    if not row or row.revision!=revision:raise HTTPException(409,'Working sequence changed. Reload before removing it.')
    await db.delete(row);await db.commit()
    return {'removed':True}


@router.get('/context')
async def context(project_id:UUID,schedule_period_id:UUID,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    await owned_project(db,project_id,user)
    src=await svc.sources(db,project_id,schedule_period_id)
    return {k:src['snapshot'][k] for k in ('activities','relationships','calendars','resources','steps','paths')}


@router.get('/activity/{activity_id}')
async def activity_summary(activity_id:UUID,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    activity=await db.get(Activity,activity_id)
    if activity is None:raise HTTPException(404,'Activity not found')
    await owned_project(db,activity.project_id,user)
    src=await svc.sources(db,activity.project_id,activity.schedule_period_id)
    rows=(await db.scalars(select(SimulationScenario).where(SimulationScenario.project_id==activity.project_id,SimulationScenario.schedule_period_id==activity.schedule_period_id).order_by(SimulationScenario.updated_at.desc()))).all()
    row=next((s for s in rows if str(activity_id) in s.config['activity_ids']),None)
    proposal=next((p for p in (row.result or {}).get('activities',[]) if p['activity_id']==str(activity_id)),None) if row else None
    return dict(programme_hours=proposal['programme_hours'] if proposal else float(activity.duration_hours or 0),derived_hours=proposal['derived_hours'] if proposal else None,variance_hours=proposal['variance_hours'] if proposal else None,
                status=svc.response(row,src['hash'])['status'] if row else 'not_configured',scenario_id=str(row.id) if row else None,scenario_name=row.name if row else None,calculated_at=(row.result or {}).get('calculated_at') if row else None)


@router.get('/')
async def list_scenarios(project_id:UUID,schedule_period_id:UUID,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    await owned_project(db,project_id,user)
    src=await svc.sources(db,project_id,schedule_period_id)
    rows=(await db.scalars(select(SimulationScenario).where(SimulationScenario.project_id==project_id,SimulationScenario.schedule_period_id==schedule_period_id).order_by(SimulationScenario.updated_at.desc()))).all()
    return [dict(id=str(r.id),name=r.name,revision=r.revision,status=svc.response(r,src['hash'])['status'],updated_at=r.updated_at) for r in rows]


@router.post('/',status_code=201)
async def create(data:ScenarioCreate,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    try:pid=UUID(data.project_id);period=UUID(data.schedule_period_id)
    except ValueError:raise HTTPException(422,'Invalid project or schedule period')
    await owned_project(db,pid,user)
    src=await svc.sources(db,pid,period);svc.validate_scope(data.config,src)
    row=SimulationScenario(project_id=pid,schedule_period_id=period,name=data.name,config=data.config.model_dump(mode='json'))
    db.add(row);await db.commit();await db.refresh(row)
    return svc.response(row)


@router.get('/{id}')
async def get(id:UUID,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user);src=await svc.sources(db,row.project_id,row.schedule_period_id)
    return svc.response(row,src['hash'])


@router.put('/{id}')
async def update(id:UUID,data:ScenarioUpdate,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user,True);svc.revision(row,data.revision)
    src=await svc.sources(db,row.project_id,row.schedule_period_id);svc.validate_scope(data.config,src)
    row.name=data.name;row.config=data.config.model_dump(mode='json');row.result=None;row.source=None;row.source_hash=None;row.revision+=1
    await db.commit();await db.refresh(row);return svc.response(row)


@router.post('/{id}/duplicate',status_code=201)
async def duplicate(id:UUID,data:Revision,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    original=await svc.owned(db,id,user);svc.revision(original,data.revision)
    row=SimulationScenario(project_id=original.project_id,schedule_period_id=original.schedule_period_id,name=original.name+' - copy',config=original.config)
    db.add(row);await db.commit();await db.refresh(row);return svc.response(row)


@router.post('/{id}/run')
async def run(id:UUID,data:Run,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user,True);svc.revision(row,data.revision)
    return await svc.run_scenario(db,row,data.estimate)


@router.post('/{id}/promote')
async def promote(id:UUID,data:Promote,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user,True);svc.revision(row,data.revision)
    await db.execute(select(Activity.id).where(Activity.schedule_period_id==row.schedule_period_id).with_for_update())
    period=await db.scalar(select(SchedulePeriod).where(SchedulePeriod.id==row.schedule_period_id).with_for_update())
    if period.freeze_status!='live' or period.baseline_locked_flag:raise HTTPException(409,'Only a live working period can receive a sequence')
    src=await svc.sources(db,row.project_id,row.schedule_period_id)
    if not row.result or row.result.get('basis')!='event_simulation' or row.source_hash!=src['hash']:
        raise HTTPException(409,'Run the current scenario before promoting its sequence')
    if row.result.get('issues') or any(s['status']!='complete' for s in row.result.get('steps',[])):
        raise HTTPException(409,'Resolve incomplete steps before promoting the combined sequence')
    if not any(e.get('worker_action') or e.get('object_states') for e in row.result.get('events',[])):
        raise HTTPException(409,'Add worker methods or element handling before promoting a visual sequence')
    current=await db.get(WorkingSimulationSequence,row.schedule_period_id,populate_existing=True)
    if (current.revision if current else 0)!=data.working_revision:
        raise HTTPException(409,'The working sequence changed. Reload before replacing it.')
    if current is None:
        current=WorkingSimulationSequence(project_id=row.project_id,schedule_period_id=row.schedule_period_id,revision=0)
        db.add(current)
    # No Activity, duration, assignment or scene recipe is rewritten here.
    from app.services.simulation_sequence import fit_to_activities
    current.snapshot=fit_to_activities(svc.response(row,src['hash']),src['activities'])
    current.source_hash=src['hash'];current.revision+=1
    await db.commit();await db.refresh(current)
    return working_response(current,src['hash'])


async def reviewed(db,row,data):
    svc.revision(row,data.revision)
    if not row.result or row.result['basis']!='event_simulation':raise HTTPException(409,'Run event simulation before reviewing programme changes')
    src=await svc.sources(db,row.project_id,row.schedule_period_id)
    if row.source_hash!=src['hash']:raise HTTPException(409,'Source programme or scene changed. Recalculate before accepting changes.')
    if not set(data.activity_ids).issubset(row.config['activity_ids']):raise HTTPException(422,'Choose activities in this simulation scope')
    proposals={p['activity_id']:p for p in row.result['activities']}
    if any(a not in proposals or proposals[a]['reason'] for a in data.activity_ids):raise HTTPException(422,'Selected activities have incomplete or protected results')
    return src,svc.impact(src,row.result['activities'],data.activity_ids)


@router.post('/{id}/review')
async def review(id:UUID,data:Selection,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user);_,changes=await reviewed(db,row,data)
    return dict(changes=changes,revision=row.revision)


@router.post('/{id}/accept')
async def accept(id:UUID,data:ApplySimulation,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user,True)
    # Lock programme rows before the final freshness check and mutation.
    await db.execute(select(Activity.id).where(Activity.schedule_period_id==row.schedule_period_id).with_for_update())
    src,changes=await reviewed(db,row,data)
    if src['period'].freeze_status!='live' or src['period'].baseline_locked_flag:raise HTTPException(409,'This schedule period is protected. Accept changes into a live working period.')
    byid={str(a.id):a for a in src['activities']}
    before=[]
    for change in changes:
        if not change['selected']:continue
        a=byid[change['activity_id']];before.append(svc.encoded(a))
        if svc.has_started(a):
            a.remaining_duration_hours=Decimal(str(change['remaining_duration_hours']))
            a.duration_hours=Decimal(str(change['duration_hours']))
        else:
            a.duration_hours=Decimal(str(change['duration_hours']))
            a.constraint_type=change['constraint_type'];a.constraint_date=datetime.fromisoformat(change['constraint_date']) if change['constraint_date'] else None
    row.decisions=[*row.decisions,dict(at=datetime.now(timezone.utc).isoformat(),user_id=str(user.id),rationale=data.rationale,source_hash=row.source_hash,selected=data.activity_ids,before=before,review=changes)]
    row.revision+=1
    await db.flush()
    await svc.recompute_schedule(db,row.schedule_period_id)
    await db.commit();await db.refresh(row)
    return svc.response(row,(await svc.sources(db,row.project_id,row.schedule_period_id))['hash'])


@router.post('/{id}/save-steps')
async def save_steps(id:UUID,data:Revision,db:AsyncSession=Depends(get_db),user=Depends(get_db_user)):
    row=await svc.owned(db,id,user,True);svc.revision(row,data.revision)
    cfg=SimulationConfig.model_validate(row.config);src=await svc.sources(db,row.project_id,row.schedule_period_id);svc.validate_scope(cfg,src)
    if src['period'].freeze_status!='live':raise HTTPException(409,'Steps in this period are protected')
    existing={str(s.id):s for s in src['steps']}
    for step in cfg.steps:
        target=existing.get(step.source_step_id)
        if not target:
            target=ActivityStep(activity_id=UUID(step.activity_id),name=step.name,is_complete=False,sort_order=sum(1 for s in existing.values() if str(s.activity_id)==step.activity_id))
            db.add(target);await db.flush();existing[str(target.id)]=target;step.source_step_id=str(target.id)
        target.operation={**step.model_dump(mode='json'),'_resources':[r.model_dump(mode='json') for r in cfg.resources]}
    row.config=cfg.model_dump(mode='json');row.revision+=1;row.result=None
    await db.commit();await db.refresh(row);return svc.response(row)
