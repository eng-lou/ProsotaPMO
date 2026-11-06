from datetime import date, time, datetime
from uuid import uuid4
from app.models.calendar import Calendar
from app.models.activity import Activity
from app.models.simulation import SimulationScenario


async def seed(client,db,project,period):
    period.start_date=date(2026,10,28)
    db.add(Calendar(project_id=project.id,name='Working day',is_project_default=True,day_start_time=time(8),day_end_time=time(16),whole_day_scheduling=False))
    await db.commit()
    response=await client.post('/api/v1/activities/',json={'project_id':str(project.id),'schedule_period_id':str(period.id),'task_name':'Lift beams','duration_hours':8})
    assert response.status_code==201,response.text
    aid=response.json()['id']
    cfg=dict(activity_ids=[aid],start='2026-10-28T08:00:00',horizon_days=3,steps=[dict(id='lift',name='Lift beams',activity_id=aid,hours=4)],resources=[])
    response=await client.post('/api/v1/simulations/',json=dict(project_id=str(project.id),schedule_period_id=str(period.id),name='Method A',config=cfg))
    assert response.status_code==201,response.text
    return aid,response.json()


async def test_scenario_run_isolated_review_accept_and_audit(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    original=(await client.get('/api/v1/activities/'+aid)).json()
    response=await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})
    assert response.status_code==200,response.text
    row=response.json();assert row['status']=='current';assert row['result']['activities'][0]['derived_hours']==4
    summary=await client.get('/api/v1/simulations/activity/'+aid)
    assert summary.status_code==200,summary.text
    assert summary.json()['derived_hours']==4 and summary.json()['status']=='current'
    assert (await client.get('/api/v1/activities/'+aid)).json()['duration_hours']==original['duration_hours']
    review=await client.post('/api/v1/simulations/'+row['id']+'/review',json={'revision':row['revision'],'activity_ids':[aid]})
    assert review.status_code==200,review.text
    accepted=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Reviewed crane cycle capacity'})
    assert accepted.status_code==200,accepted.text
    assert accepted.json()['decisions'][0]['rationale']=='Reviewed crane cycle capacity'
    assert float((await client.get('/api/v1/activities/'+aid)).json()['duration_hours'])==4
    assert accepted.json()['status']=='stale'


async def test_stale_source_blocks_accept_and_duplicate_is_independent(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})).json()
    copy=await client.post('/api/v1/simulations/'+row['id']+'/duplicate',json={'revision':row['revision']})
    assert copy.status_code==201,copy.text
    assert copy.json()['result'] is None
    await client.patch('/api/v1/activities/'+aid,json={'task_name':'Revised beams'})
    got=await client.get('/api/v1/simulations/'+row['id']);assert got.json()['status']=='stale'
    rejected=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Old result'})
    assert rejected.status_code==409


async def test_review_propagates_to_successor_without_changing_it_before_acceptance(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    successor=await client.post('/api/v1/activities/',json={'project_id':str(project.id),'schedule_period_id':str(live_schedule_period.id),'task_name':'Follow-on work','duration_hours':8})
    sid=successor.json()['id']
    linked=await client.post('/api/v1/activity-relationships/',json={'predecessor_id':aid,'successor_id':sid,'relationship_type':'FS'})
    assert linked.status_code==201,linked.text
    original=(await client.get('/api/v1/activities/'+sid)).json()
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})).json()
    review=await client.post('/api/v1/simulations/'+row['id']+'/review',json={'revision':row['revision'],'activity_ids':[aid]})
    assert review.status_code==200,review.text
    change=next(c for c in review.json()['changes'] if c['activity_id']==sid)
    assert not change['selected'] and change['finish']!=original['finish']
    assert (await client.get('/api/v1/activities/'+sid)).json()['finish']==original['finish']
    accepted=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Reviewed successor impact'})
    assert accepted.status_code==200,accepted.text
    updated=(await client.get('/api/v1/activities/'+sid)).json()
    assert updated['finish']==change['finish'] and updated['duration_hours']==original['duration_hours']


async def test_revision_scope_and_step_persistence(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    response=await client.put('/api/v1/simulations/'+row['id'],json={'revision':999,'name':'Overwrite','config':row['config']})
    assert response.status_code==409
    response=await client.post('/api/v1/simulations/'+row['id']+'/save-steps',json={'revision':row['revision']})
    assert response.status_code==200,response.text
    steps=(await client.get('/api/v1/activity-steps/',params={'activity_id':aid})).json()
    assert len(steps)==1 and steps[0]['operation']['hours']==4
    row=response.json();row['config']['activity_ids']=[str(uuid4())]
    row['config']['steps'][0]['activity_id']=row['config']['activity_ids'][0]
    response=await client.put('/api/v1/simulations/'+row['id'],json={'revision':row['revision'],'name':row['name'],'config':row['config']})
    assert response.status_code==422


async def test_estimate_not_acceptable_and_completed_actuals_protected(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision'],'estimate':True})).json()
    response=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Estimate'})
    assert response.status_code==409
    activity=await db.get(Activity,aid)
    activity.actual_start=datetime(2026,10,26,8);activity.actual_finish=datetime(2026,10,27,16)
    await db.commit()
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})).json()
    assert row['result']['activities'][0]['reason']
    response=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Do not alter actuals'})
    assert response.status_code==422
    await db.refresh(activity)
    assert activity.actual_finish==datetime(2026,10,27,16)


async def test_reusable_steps_keep_resources_and_frozen_period_is_protected(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    cfg=row['config'];cfg['resources']=[dict(id='crane',name='Crane',capacity=1)]
    cfg['steps'][0]['resources']=[dict(resource_id='crane',units=1)]
    row=(await client.put('/api/v1/simulations/'+row['id'],json=dict(revision=row['revision'],name=row['name'],config=cfg))).json()
    saved=await client.post('/api/v1/simulations/'+row['id']+'/save-steps',json={'revision':row['revision']})
    assert saved.status_code==200,saved.text
    operation=(await client.get('/api/v1/activity-steps/',params={'activity_id':aid})).json()[0]['operation']
    assert operation['_resources'][0]['id']=='crane'
    assert operation['resources'][0]['resource_id']=='crane'
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':saved.json()['revision']})).json()
    live_schedule_period.baseline_locked_flag=True;await db.commit()
    # Snapshot change first makes this stale; either condition must prevent programme writes.
    response=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Protected baseline'})
    assert response.status_code==409


async def test_started_work_applies_reviewed_forecast_without_moving_actual_start(client,db,project,live_schedule_period):
    aid,row=await seed(client,db,project,live_schedule_period)
    activity=await db.get(Activity,aid)
    activity.start=datetime(2026,10,27,8);activity.actual_start=activity.start
    activity.pct_complete=25;activity.duration_hours=40;activity.remaining_duration_hours=30
    await db.commit();await db.refresh(activity)
    cfg=row['config'];cfg['steps'][0]['earliest_start']='2026-10-28T10:00:00'
    row=(await client.put('/api/v1/simulations/'+row['id'],json=dict(revision=row['revision'],name=row['name'],config=cfg))).json()
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})).json()
    proposal=row['result']['activities'][0]
    assert proposal['remaining'] and proposal['derived_hours']==6  # 2 hours waiting + 4 hours work
    review=(await client.post('/api/v1/simulations/'+row['id']+'/review',json={'revision':row['revision'],'activity_ids':[aid]})).json()
    change=next(c for c in review['changes'] if c['activity_id']==aid)
    assert change['finish'].startswith('2026-10-28T14:00:00'),change
    response=await client.post('/api/v1/simulations/'+row['id']+'/accept',json={'revision':row['revision'],'activity_ids':[aid],'rationale':'Reviewed remaining work'})
    assert response.status_code==200,response.text
    await db.refresh(activity)
    assert activity.start==activity.actual_start==datetime(2026,10,27,8)
    assert activity.finish==datetime(2026,10,28,14)
    assert activity.pct_complete==25 and float(activity.remaining_duration_hours)==6


async def test_visual_worker_method_persistence_scope_and_route_freshness(client,db,project,live_schedule_period):
    from app.models.site_scene import SiteScene
    from app.models.path import Path
    aid,row=await seed(client,db,project,live_schedule_period)
    points=[dict(x=0,y=0,z=0),dict(x=12,y=0,z=0)]
    route=Path(project_id=project.id,name='Work route',points=points,closed=False,curve_mode='straight')
    scene=SiteScene(project_id=project.id,items=[dict(id='worker',kind='asset',asset_id='actor-asset'),dict(id='tool',kind='asset',asset_id='tool-asset')])
    db.add_all([route,scene]);await db.commit();await db.refresh(route)
    m=dict(version=1,kind='walk_work_continue',worker_id='worker',worker_asset_id='actor-asset',
           tool_id='tool',tool_asset_id='tool-asset',route_id=str(route.id),
           route=dict(id=str(route.id),geometry={},samples=[[0,0,0],[12,0,0]],length_m=12),
           idle_clip='Idle',walk_clip='Walk',work_clip='Drill',hand='CC_Base_R_Hand',
           work_seconds=10,speed_mps=1.2,work_position=50)
    m['route']['geometry']=dict(points=points,closed=False,curve_mode='straight')
    m['grip']=dict(position=[.1,.2,.3],rotation=[0,90,0])
    cfg=row['config'];cfg['steps']=[dict(id='method',name='Break concrete',activity_id=aid,worker_method=m)]
    response=await client.put('/api/v1/simulations/'+row['id'],json=dict(revision=row['revision'],name=row['name'],config=cfg))
    assert response.status_code==200,response.text
    row=response.json()
    result=await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})
    assert result.status_code==200,result.text
    row=result.json();assert row['status']=='current'
    assert [e['worker_action']['stage'] for e in row['result']['events']]==['approach','work','continue']
    reloaded=(await client.get('/api/v1/simulations/'+row['id'])).json()
    assert reloaded['config']['steps'][0]['worker_method']['grip']==m['grip']
    assert float((await client.get('/api/v1/activities/'+aid)).json()['duration_hours'])==8
    saved=await client.post('/api/v1/simulations/'+row['id']+'/save-steps',json={'revision':row['revision']})
    assert saved.status_code==200,saved.text
    operation=(await client.get('/api/v1/activity-steps/',params={'activity_id':aid})).json()[0]['operation']
    assert operation['worker_method']['grip']==m['grip']
    row=saved.json()
    # Saving definitions invalidates the previous result; calculate against the new source revision.
    row=(await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})).json()
    assert row['status']=='current'
    # Promotion persists a fitted snapshot, with no programme or scene mutation.
    params={'project_id':str(project.id),'schedule_period_id':str(live_schedule_period.id)}
    original_activity=(await client.get('/api/v1/activities/'+aid)).json()
    assert (await client.get('/api/v1/simulations/working',params=params)).json() is None
    response=await client.post('/api/v1/simulations/'+row['id']+'/promote',json={'revision':row['revision'],'working_revision':0})
    assert response.status_code==200,response.text
    promoted=response.json();assert promoted['revision']==1 and promoted['status']=='current'
    assert promoted['scenario']['timing']['mode']=='parent_activity'
    from app.services.operation_simulation import stamp
    assert stamp(promoted['scenario']['result']['start'])==stamp(original_activity['start'])
    assert stamp(promoted['scenario']['result']['finish'])==stamp(original_activity['finish'])
    assert (await client.get('/api/v1/activities/'+aid)).json()==original_activity
    assert (await client.get('/api/v1/simulations/'+row['id'])).json()['result']==row['result']
    assert (await client.get('/api/v1/simulations/working',params=params)).json()==promoted
    assert (await client.get('/api/v1/simulations/working',params={**params,'project_id':str(uuid4())})).status_code==404
    assert (await client.post('/api/v1/simulations/'+row['id']+'/promote',json={'revision':row['revision'],'working_revision':0})).status_code==409
    assert (await client.delete('/api/v1/simulations/working',params={**params,'revision':0})).status_code==409
    live_schedule_period.baseline_locked_flag=True;await db.commit()
    assert (await client.post('/api/v1/simulations/'+row['id']+'/promote',json={'revision':row['revision'],'working_revision':1})).status_code==409
    assert (await client.delete('/api/v1/simulations/working',params={**params,'revision':1})).status_code==409
    live_schedule_period.baseline_locked_flag=False;await db.commit()
    route.points=[dict(x=0,y=0,z=0),dict(x=15,y=0,z=0)];await db.commit()
    assert (await client.get('/api/v1/simulations/working',params=params)).json()['status']=='stale'
    assert (await client.post('/api/v1/simulations/'+row['id']+'/promote',json={'revision':row['revision'],'working_revision':1})).status_code==409
    assert (await client.delete('/api/v1/simulations/working',params={**params,'revision':1})).status_code==200
    assert (await client.get('/api/v1/simulations/working',params=params)).json() is None
    assert (await client.get('/api/v1/simulations/'+row['id'])).json()['status']=='stale'
    rejected=await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})
    assert rejected.status_code==422 and 'route changed' in rejected.text
    route.points=points;scene.items=[dict(id='worker',kind='asset',asset_id='replacement'),dict(id='tool',kind='asset',asset_id='tool-asset')];await db.commit()
    rejected=await client.post('/api/v1/simulations/'+row['id']+'/run',json={'revision':row['revision']})
    assert rejected.status_code==422 and 'removed or replaced' in rejected.text
