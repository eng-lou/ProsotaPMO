"""Scenario persistence, source provenance, and reviewed CPM impact."""
from __future__ import annotations
import hashlib
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from math import ceil, dist
from types import SimpleNamespace
from uuid import UUID
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from app.models.activity import Activity
from app.models.activity_step import ActivityStep
from app.models.activity_relationship import ActivityRelationship
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.path import Path
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.site_scene import SiteScene
from app.models.equipment_rig import EquipmentRig
from app.models.simulation import SimulationScenario
from app.models.model3d_file import Model3DFile
from app.models.element_transform import ElementTransform
from app.models.element_keyframe import ElementKeyframe
from app.schemas.simulation import SimulationConfig
from app.services.clash_access import owned_project
from app.services.scheduling_cpm import _CalendarLookup, _cpm_participants, calculate_schedule, recompute_schedule
from app.services.operation_simulation import calculate, stamp, iso


def columns(row):
    return {c.key:getattr(row,c.key) for c in row.__table__.columns}


def encoded(row):
    return jsonable_encoder(columns(row))


def signature(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()


async def sources(db, project_id, period_id):
    period=await db.get(SchedulePeriod,period_id,populate_existing=True)
    variant=await db.get(ScheduleVariant,period.schedule_variant_id) if period else None
    if not variant or variant.project_id!=project_id:raise HTTPException(404,'Schedule period not found')
    async def rows(model, predicate):
        return list((await db.scalars(select(model).where(predicate).order_by(model.id).execution_options(populate_existing=True))).all())
    activities=await rows(Activity,Activity.schedule_period_id==period_id)
    aids=[a.id for a in activities]
    relationships=await rows(ActivityRelationship,ActivityRelationship.predecessor_id.in_(aids))
    relationships=[r for r in relationships if r.successor_id in aids]
    calendars=await rows(Calendar,Calendar.project_id==project_id); cids=[c.id for c in calendars]
    data=dict(activities=activities,relationships=relationships,calendars=calendars,
        exceptions=await rows(CalendarException,CalendarException.calendar_id.in_(cids)),
        breaks=await rows(CalendarBreak,CalendarBreak.calendar_id.in_(cids)),
        resources=await rows(Resource,Resource.project_id==project_id),
        assignments=await rows(ResourceAssignment,ResourceAssignment.activity_id.in_(aids)),
        steps=await rows(ActivityStep,ActivityStep.activity_id.in_(aids)),
        paths=await rows(Path,Path.project_id==project_id),rigs=await rows(EquipmentRig,EquipmentRig.project_id==project_id))
    data['files']=await rows(Model3DFile,Model3DFile.project_id==project_id)
    data['transforms']=await rows(ElementTransform,ElementTransform.model3d_file_id.in_([f.id for f in data['files']]))
    data['keys']=await rows(ElementKeyframe,ElementKeyframe.project_id==project_id)
    data['period']=period
    snapshot={k:[encoded(v) for v in values] for k,values in data.items() if k!='period'}
    scene=await db.get(SiteScene,project_id,populate_existing=True)
    snapshot['site_scene']=encoded(scene) if scene else None
    snapshot['period']=encoded(period)
    data['snapshot']=snapshot;data['hash']=signature(snapshot)
    data['lookup']=_CalendarLookup(calendars,data['exceptions'],data['breaks'])
    return data


async def owned(db, id, user, lock=False):
    q=select(SimulationScenario).where(SimulationScenario.id==id)
    if lock:q=q.with_for_update()
    row=(await db.scalars(q)).one_or_none()
    if row is None:raise HTTPException(404,'Simulation not found')
    await owned_project(db,row.project_id,user)
    return row


def revision(row, expected):
    if row.revision!=expected:raise HTTPException(409,'This scenario changed. Reload before saving.')


def response(row, current_hash=None):
    result=encoded(row)
    result['status']=('stale' if row.result and current_hash and row.source_hash!=current_hash else (row.result or {}).get('status','incomplete'))
    return result


def validate_scope(config, source):
    activities={str(a.id):a for a in source['activities'] if not a.is_archived and a.activity_type!='wbs_summary'}
    if any(a not in activities for a in config.activity_ids):raise HTTPException(422,'Choose current activities in this schedule period')
    resources={str(r.id):r for r in source['resources']}; calendars={str(c.id) for c in source['calendars']}
    steps={str(s.id):s for s in source['steps']}
    for r in config.resources:
        if r.source_resource_id and r.source_resource_id not in resources:raise HTTPException(422,'Resource is outside this project')
        if r.calendar_id and r.calendar_id not in calendars:raise HTTPException(422,'Calendar is outside this project')
    for s in config.steps:
        if s.source_step_id and (s.source_step_id not in steps or str(steps[s.source_step_id].activity_id)!=s.activity_id):raise HTTPException(422,'Source step no longer belongs to this activity')
        if s.worker_method:
            m=s.worker_method
            items={i['id']:i for i in (source.get('snapshot',{}).get('site_scene') or {}).get('items',[])}
            for role in ('worker','tool'):
                item=items.get(getattr(m,role+'_id'))
                if not item or item.get('kind')!='asset' or item.get('asset_id')!=getattr(m,role+'_asset_id'):
                    raise HTTPException(422,f'{s.name}: {role} was removed or replaced. Bind it again in the visual method.')
            path=next((p for p in source['paths'] if str(p.id)==m.route_id),None)
            if not path:raise HTTPException(422,f'{s.name}: choose an existing route')
            if m.route:
                geometry=dict(points=path.points,closed=path.closed,curve_mode=path.curve_mode or 'curved')
                # Ignore absent optional null fields emitted by older route versions.
                def tidy(v):
                    if isinstance(v,dict):return {k:tidy(x) for k,x in v.items() if x is not None}
                    if isinstance(v,list):return [tidy(x) for x in v]
                    return v
                if tidy(m.route.geometry)!=tidy(geometry):raise HTTPException(422,f'{s.name}: route changed. Reopen the simulator and run again to refresh it.')
    return activities


def context(config, source):
    activities=validate_scope(config,source);lookup=source['lookup']; windows={}
    resource_rows={str(r.id):r for r in source['resources']}
    def availability(calendar):
        out=[]
        for day in range(config.horizon_days+1):
            date=config.start.date()+timedelta(days=day)
            out += [[datetime.combine(date,a).isoformat(),datetime.combine(date,b).isoformat()] for a,b in lookup._windows(calendar,date)]
        return out
    for aid in config.activity_ids:windows['activity:'+aid]=availability(lookup.resolve(activities[aid]))
    for r in config.resources:
        original=resource_rows.get(r.source_resource_id)
        calendar_id=UUID(r.calendar_id) if r.calendar_id else getattr(original,'calendar_id',None)
        windows['resource:'+r.id]=availability(lookup.resolve_calendar_id(calendar_id))
    boundaries=[]
    for a in source['assignments']:
        if str(a.activity_id) in config.activity_ids:continue
        activity=activities.get(str(a.activity_id))
        if not activity or not activity.start or not activity.finish or activity.actual_finish:continue
        for r in config.resources:
            if r.source_resource_id==str(a.resource_id):
                boundaries.append(dict(resource_id=r.id,start=activity.start.isoformat(),end=activity.finish.isoformat(),units=max(1,ceil(float(a.utilisation_pct or 100)/100))))
    routes={}
    for p in source['paths']:
        if p.curve_mode!='straight':continue  # Curved route length must come from its sampled curve; never pretend a chord is the route.
        points=[(q['x'],q['y'],q['z']) for q in p.points]
        if p.closed and points:points.append(points[0])
        routes[str(p.id)]=sum(dist(a,b) for a,b in zip(points,points[1:]))
    return dict(activities=[encoded(activities[id]) for id in config.activity_ids],windows=windows,boundaries=boundaries,routes=routes)


def programme_links(config,source):
    """Retain programme logic unless a step link explicitly refines that edge."""
    cfg=config.model_copy(deep=True); by_activity={a:[s for s in cfg.steps if s.activity_id==a] for a in cfg.activity_ids}
    rels={str(r.id):r for r in source['relationships']}; activities={str(a.id):a for a in source['activities']}
    refined=set()
    for s in cfg.steps:
        for d in s.dependencies:
            if d.treatment!='refines':continue
            r=rels.get(d.programme_relationship_id); pred=next(p for p in cfg.steps if p.id==d.step_id)
            if not r or str(r.predecessor_id)!=pred.activity_id or str(r.successor_id)!=s.activity_id:raise HTTPException(422,'A refinement must identify the matching programme relationship')
            refined.add(str(r.id))
    from app.schemas.simulation import Gate, StepLink
    for r in source['relationships']:
        aid=str(r.successor_id);pid=str(r.predecessor_id)
        if aid not in by_activity or str(r.id) in refined:continue
        for s in by_activity[aid]:
            if r.relationship_type not in ('FS','SS') or r.lag_hours<0:
                s.conditions.append(Gate(name='Review '+r.relationship_type+' programme link '+str(r.id),status='pending',kind='approval'))
            elif pid in by_activity:
                for pred in by_activity[pid]:
                    if pred.id==s.id:continue
                    s.dependencies.append(StepLink(step_id=pred.id,relation='finish' if r.relationship_type=='FS' else 'start',lag_hours=float(r.lag_hours),lag_basis='working',any_group='programme:'+str(r.id) if r.relationship_type=='SS' else None))
            else:
                pred=activities[pid]; date=(pred.actual_finish or pred.finish) if r.relationship_type=='FS' else (pred.actual_start or pred.start)
                if date is not None:date=source['lookup'].offset_hours(source['lookup'].resolve(activities[aid]),date,r.lag_hours)
                s.conditions.append(Gate(name='Outside-scope predecessor: '+pred.task_name,status='ready' if date else 'pending',available_from=date))
    # Validate the combined graph, including cycles introduced by programme logic.
    try:return SimulationConfig.model_validate(cfg.model_dump())
    except ValueError as e:raise HTTPException(422,'Step and programme links conflict: '+str(e)) from e


def has_started(activity):
    return activity.actual_start is not None or float(activity.pct_complete or 0)>0


def proposals(config,source,result):
    activities={str(a.id):a for a in source['activities']}; derived=[]
    for aid in config.activity_ids:
        a=activities[aid]; own=[s for s in result['steps'] if s['activity_id']==aid]
        ready=own and all(s['status']=='complete' and not s['illustrative'] for s in own)
        start=min((s['start'] for s in own if s['start']),default=None); finish=max((s['finish'] for s in own if s['finish']),default=None) if ready else None
        duration_start=max(config.start,a.start or config.start) if has_started(a) else (datetime.fromisoformat(start) if start else None)
        duration=float(source['lookup'].working_hours_between(source['lookup'].resolve(a),duration_start,datetime.fromisoformat(finish))) if duration_start and finish else None
        reason=None
        if a.actual_finish or a.status=='completed':reason='Completed activity: actual dates are protected'
        elif has_started(a) and (not a.start or config.start<a.start):reason='Start the remaining-work simulation on or after the recorded activity start'
        elif a.constraint_type not in (None,'','snet'):reason='Existing constraint requires separate review'
        elif result['status']!='current':reason='Resolve the simulation issues before applying programme changes'
        elif not ready:reason='Resolve all steps and use calculated timing before acceptance'
        derived.append(dict(activity_id=aid,name=a.task_name,programme_hours=float(a.remaining_duration_hours if has_started(a) and a.remaining_duration_hours is not None else a.duration_hours or 0),derived_hours=duration,
                            variance_hours=duration-float(a.remaining_duration_hours if has_started(a) and a.remaining_duration_hours is not None else a.duration_hours or 0) if duration is not None else None,
                            start=start,finish=finish,reason=reason,remaining=has_started(a)))
    return derived


def impact(source, proposed, selected):
    """Use the real CPM engine on detached copies, with the exact drivers offered for acceptance."""
    clones=[SimpleNamespace(**columns(a)) for a in source['activities']]; byid={str(a.id):a for a in clones}
    for p in proposed:
        if p['activity_id'] not in selected:continue
        if p['reason']:raise HTTPException(422,p['reason'])
        a=byid[p['activity_id']]; duration=Decimal(str(p['derived_hours']))
        if has_started(a):
            a.remaining_duration_hours=duration
            # CPM deliberately uses total duration for started work. Translate the
            # reviewed remaining-work finish to that existing driver, preserving
            # recorded start/actuals/progress rather than silently writing a no-op.
            calendar=source['lookup'].resolve(a);finish=datetime.fromisoformat(p['finish'])
            total=source['lookup'].working_hours_between(calendar,a.start,finish)
            if a.suspend_date and a.resume_date:
                left=max(a.start,a.suspend_date);right=min(finish,a.resume_date)
                if right>left:total-=source['lookup'].working_hours_between(calendar,left,right)
            a.duration_hours=max(Decimal(0),total)
        else:a.duration_hours=duration
        release=datetime.fromisoformat(p['start'])
        # A release floor records operational waiting; existing stricter start floors remain.
        if not has_started(a):
            a.constraint_type='snet';a.constraint_date=max(a.constraint_date or release,release)
    participants=_cpm_participants(clones); ids={a.id for a in participants}
    calculate_schedule(participants,[r for r in source['relationships'] if r.predecessor_id in ids and r.successor_id in ids],source['lookup'],source['period'])
    before={a.id:a for a in source['activities']}; changes=[]
    for a in participants:
        old=before[a.id]
        if a.start!=old.start or a.finish!=old.finish or str(a.id) in selected:
            changes.append(dict(activity_id=str(a.id),name=a.task_name,selected=str(a.id) in selected,milestone=a.activity_type.endswith('milestone'),
                before_start=old.start,before_finish=old.finish,start=a.start,finish=a.finish,float_hours=a.total_float_hours,critical=a.is_critical,
                finish_shift_hours=(a.finish-old.finish).total_seconds()/3600 if a.finish and old.finish else None,
                duration_hours=a.duration_hours,remaining_duration_hours=a.remaining_duration_hours,constraint_type=a.constraint_type,constraint_date=a.constraint_date))
    return jsonable_encoder(changes)


async def run_scenario(db,row,estimate=False):
    cfg=SimulationConfig.model_validate(row.config);src=await sources(db,row.project_id,row.schedule_period_id)
    adjusted=programme_links(cfg,src);ctx=context(adjusted,src)
    from starlette.concurrency import run_in_threadpool
    result=await run_in_threadpool(calculate,adjusted,ctx,estimate=estimate)
    result['activities']=proposals(cfg,src,result); result['engine_version']=1;result['calculated_at']=datetime.now(timezone.utc).isoformat()
    result['source_hash']=src['hash'];result['assumptions']=cfg.assumptions
    eligible=[p['activity_id'] for p in result['activities'] if not p['reason']]
    result['impact']=impact(src,result['activities'],eligible) if eligible else []
    if any(s.basis=='illustrative' for s in cfg.steps):result['warnings'].append('Illustrative steps can animate, but cannot establish a programme duration.')
    row.source=src['snapshot'];row.source_hash=src['hash'];row.result=result;row.revision+=1
    await db.commit();await db.refresh(row)
    return response(row,src['hash'])
