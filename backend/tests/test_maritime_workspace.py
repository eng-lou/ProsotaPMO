import copy
import uuid
import pytest
from pydantic import ValidationError
from app.schemas.maritime_workspace import WorkspaceDefinition, Exercise, AttemptAction
from app.services.maritime_operations import compare, simulate, assess_attempt


def terminal():
    ids = {k: str(uuid.uuid4()) for k in ['berth','vessel','crane1','crane2','truck','yard','gate']}
    assets = [{'id': id, 'name': key, 'kind': 'crane' if key.startswith('crane') else key,
               'rate': 30 if key.startswith('crane') else 90, 'capacity':1500, 'hourly_cost':0}
              for key,id in ids.items()]
    data = {'assets': assets, 'horizon_hours':72, 'source':'synthetic',
            'calls':[{'id':str(uuid.uuid4()),'name':'Horizon','vessel_id':ids['vessel'],'berth_id':ids['berth'],
                      'crane_ids':[ids['crane1'],ids['crane2']],'arrival_hour':2,'cargo_moves':1200}],
            'scenarios':[{'id':str(uuid.uuid4()),'name':'Outage','downtime':[{'asset_id':ids['crane2'],'start_hour':8,'duration_hours':6}]}]}
    return WorkspaceDefinition.model_validate(data),ids


def test_crane_outage_and_conservation():
    plan,_ = terminal()
    result=compare(plan,plan.scenarios[0])
    assert result['baseline']['vessel_completion_hour']==22
    assert result['scenario']['vessel_completion_hour']==25
    assert result['completion_delay_hours']==3
    for value in (result['baseline'],result['scenario']):
        assert value['handled_moves']==1200
        assert value['gate_cleared']+value['yard_moves']==pytest.approx(value['handled_moves']+value['initial_yard_moves'])
        assert all(a['utilisation_elapsed_percent'] <=100 for a in value['equipment'])


def test_transport_bottleneck_absorbs_crane_outage():
    plan,_=terminal()
    next(a for a in plan.assets if a.kind=='truck').rate=20
    r=compare(plan,plan.scenarios[0])
    assert r['baseline']['vessel_completion_hour']==62
    assert r['completion_delay_hours']==0


def test_finite_yard_and_closed_gate_do_not_fabricate_finish():
    plan,_=terminal()
    next(a for a in plan.assets if a.kind=='yard').capacity=100
    next(a for a in plan.assets if a.kind=='gate').rate=0
    r=simulate(plan)
    assert r['handled_moves']==100
    assert r['status']=='horizon_reached'
    assert r['vessel_completion_hour'] is None
    assert r['yard_moves']==100


def test_shared_berth_calls_are_serial():
    plan,_=terminal()
    call=plan.calls[0].model_copy(deep=True);call.id=uuid.uuid4();call.arrival_hour=3
    plan.calls.append(call)
    r=simulate(plan)
    assert r['calls'][1]['start_hour'] >= r['calls'][0]['finish_hour']
    assert r['handled_moves']==2400


def test_shared_crane_is_not_double_allocated():
    plan,_=terminal()
    second_berth=next(a for a in plan.assets if a.kind=='berth').model_copy(deep=True);second_berth.id=uuid.uuid4();plan.assets.append(second_berth)
    vessel=next(a for a in plan.assets if a.kind=='vessel').model_copy(deep=True);vessel.id=uuid.uuid4();plan.assets.append(vessel)
    call=plan.calls[0].model_copy(deep=True);call.id=uuid.uuid4();call.berth_id=second_berth.id;call.vessel_id=vessel.id;plan.calls.append(call)
    r=simulate(plan)
    assert r['vessel_completion_hour']==42
    assert all(e['utilisation_elapsed_percent']<=100 for e in r['equipment'])


def test_same_vessel_cannot_work_two_berths_simultaneously():
    plan,_=terminal()
    berth=next(a for a in plan.assets if a.kind=='berth').model_copy(deep=True);berth.id=uuid.uuid4();plan.assets.append(berth)
    crane=next(a for a in plan.assets if a.kind=='crane').model_copy(deep=True);crane.id=uuid.uuid4();crane.rate=60;plan.assets.append(crane)
    call=plan.calls[0].model_copy(deep=True);call.id=uuid.uuid4();call.arrival_hour=3;call.berth_id=berth.id;call.crane_ids=[crane.id];plan.calls.append(call)
    result=simulate(plan)
    assert result['calls'][1]['start_hour']>=result['calls'][0]['finish_hour']
    assert result['vessel_completion_hour']==42


def test_maintenance_status_and_cost_once():
    plan,ids=terminal()
    from app.schemas.maritime_workspace import WorkOrder
    order=WorkOrder(id=uuid.uuid4(),name='Inspection',asset_id=ids['crane2'],start_hour=8,duration_hours=6,cost=500)
    plan.work_orders.append(order)
    assert simulate(plan)['vessel_completion_hour']==22
    order.status='scheduled'
    r=simulate(plan)
    assert r['vessel_completion_hour']==25
    assert r['maintenance_cost']==500
    order.status='complete'
    assert simulate(plan)['vessel_completion_hour']==22


def test_bad_references_and_nonfinite_rejected():
    plan,_=terminal()
    data=plan.model_dump(mode='json');data['assets'][0]['rate']=float('nan')
    with pytest.raises(ValidationError):WorkspaceDefinition.model_validate(data)
    data=plan.model_dump(mode='json');data['calls'][0]['berth_id']=str(uuid.uuid4())
    with pytest.raises(ValidationError):WorkspaceDefinition.model_validate(data)
    data=plan.model_dump(mode='json');data['assets'].append(data['assets'][0])
    with pytest.raises(ValidationError):WorkspaceDefinition.model_validate(data)


def test_attempt_order_timing_and_duplicate_actions():
    e=Exercise(id=uuid.uuid4(),name='Lift',asset_id=uuid.uuid4(),required_actions=['Identify','Stop','Secure'],response_limit_seconds=30)
    actions=[AttemptAction(action='Stop',seconds=10),AttemptAction(action='Stop',seconds=11),AttemptAction(action='Identify',seconds=35)]
    r=assess_attempt(e,actions)
    assert r['completed']==2
    assert r['in_order'] is False
    assert r['missed']==['Secure']
    assert not r['criteria'][0]['within_limit']
    with pytest.raises(ValueError):assess_attempt(e,[AttemptAction(action='Unknown',seconds=0)])


@pytest.mark.asyncio
async def test_workspace_create_save_conflict_and_run_snapshot(client):
    p=(await client.post('/api/v1/projects/',json={'name':'Terminal','workspace':'maritime'})).json()
    url=f"/api/v1/maritime/projects/{p['id']}"
    initial=await client.get(url+'/workspace');assert initial.status_code==200;assert initial.json()['version']==0
    plan,_=terminal();payload={'version':0,'definition':plan.model_dump(mode='json')}
    saved=await client.put(url+'/workspace',json=payload);assert saved.status_code==200,saved.text
    assert saved.json()['version']==1
    assert (await client.put(url+'/workspace',json=payload)).status_code==409
    ran=await client.post(url+'/runs',json={'version':1,'scenario_id':str(plan.scenarios[0].id)})
    assert ran.status_code==201,ran.text
    old=ran.json();assert old['results']['completion_delay_hours']==3
    payload['version']=1;payload['definition']['calls'][0]['cargo_moves']=600
    assert (await client.put(url+'/workspace',json=payload)).status_code==200
    loaded=(await client.get(url+'/runs/'+old['id'])).json()
    assert loaded['inputs']['plan']['calls'][0]['cargo_moves']==1200
    assert loaded['version']==1
    assert (await client.post(url+'/runs',json={'version':1})).status_code==409


@pytest.mark.asyncio
async def test_construction_project_remains_separate(client,project):
    assert (await client.get(f'/api/v1/maritime/projects/{project.id}/workspace')).status_code==409
    p=(await client.get(f'/api/v1/projects/{project.id}')).json()
    assert p['workspace']=='construction'


@pytest.mark.asyncio
async def test_other_owner_is_denied(client,db,other_user,org):
    from app.models.project import Project
    p=Project(name='Private',org_id=org.id,created_by=other_user.id,workspace='maritime');db.add(p);await db.commit()
    url=f'/api/v1/maritime/projects/{p.id}'
    assert (await client.get(url+'/workspace')).status_code==404
    assert (await client.get(url+'/runs')).status_code==404
    assert (await client.put(url+'/workspace',json={'version':0,'definition':{}})).status_code==404


@pytest.mark.asyncio
async def test_attempt_snapshot_and_cross_project_run_rejected(client):
    p=(await client.post('/api/v1/projects/',json={'name':'Terminal','workspace':'maritime'})).json()
    plan,ids=terminal();data=plan.model_dump(mode='json')
    eid=str(uuid.uuid4());data['exercises']=[{'id':eid,'name':'Lift','asset_id':ids['crane1'],'required_actions':['Identify','Stop']}]
    url=f"/api/v1/maritime/projects/{p['id']}"
    await client.put(url+'/workspace',json={'version':0,'definition':data})
    r=await client.post(url+'/attempts',json={'version':1,'exercise_id':eid,'actions':[{'action':'Identify','seconds':3}]})
    assert r.status_code==201,r.text
    assert r.json()['results']['missed']==['Stop']
    p2=(await client.post('/api/v1/projects/',json={'name':'Second','workspace':'maritime'})).json()
    assert (await client.get(f"/api/v1/maritime/projects/{p2['id']}/runs/{r.json()['id']}")).status_code==404


@pytest.mark.asyncio
async def test_cross_project_resource_link_denied(client,db,project):
    from app.models.resource import Resource
    r=Resource(project_id=project.id,name='Other project crew',resource_type='labour',unit='day',rate=100);db.add(r);await db.commit()
    p=(await client.post('/api/v1/projects/',json={'name':'Terminal','workspace':'maritime'})).json()
    plan,_=terminal();data=plan.model_dump(mode='json');data['assets'][0]['resource_id']=str(r.id)
    res=await client.put(f"/api/v1/maritime/projects/{p['id']}/workspace",json={'version':0,'definition':data})
    assert res.status_code==422,res.text


@pytest.mark.asyncio
async def test_poe_reads_saved_evidence_without_cross_project_leak(client, db):
    from app.ai.maritime_context import get_context
    p=(await client.post('/api/v1/projects/',json={'name':'Terminal','workspace':'maritime'})).json()
    project_id=uuid.UUID(p['id'])
    assert (await get_context(db,project_id))['status']=='no_saved_maritime_plan'
    url=f"/api/v1/maritime/projects/{project_id}"
    plan,_=terminal();data=plan.model_dump(mode='json')
    data['assets'][0]['elements']=[{'source_kind':'mesh','element_ref':'mesh:example','element_label':'Berth'}]
    await client.put(url+'/workspace',json={'version':0,'definition':data})
    result=(await client.post(url+'/runs',json={'version':1,'scenario_id':str(plan.scenarios[0].id)})).json()
    summary=await get_context(db,project_id)
    assert summary['working_plan']['assets'][0]['linked_elements']==1
    assert 'elements' not in summary['working_plan']['assets'][0]
    evidence=await get_context(db,project_id,result['id'])
    assert evidence['results']['completion_delay_hours']==3
    assert evidence['results']['scenario']['assumptions']
    assert 'samples' not in evidence['results']['scenario']
    assert evidence['stale'] is False
    await client.put(url+'/workspace',json={'version':1,'definition':data})
    assert (await get_context(db,project_id,result['id']))['stale'] is True
    second=(await client.post('/api/v1/projects/',json={'name':'Other','workspace':'maritime'})).json()
    await client.put(f"/api/v1/maritime/projects/{second['id']}/workspace",json={'version':0,'definition':{}})
    assert (await get_context(db,uuid.UUID(second['id']),result['id']))['error']=='Run not found in this project'
    assert (await get_context(db,project_id,'not-a-uuid'))['error']=='Invalid run identifier'


@pytest.mark.asyncio
async def test_maritime_project_copy_remaps_planning_links_not_run_history(client, db, project, live_schedule_period):
    from app.models.maritime_workspace import MaritimeWorkspace, MaritimeRun
    from app.models.resource import Resource
    from app.models.activity import Activity
    from sqlalchemy import select
    project.workspace='maritime';await db.commit()
    await client.get('/api/v1/calendars/',params={'project_id':str(project.id)})
    activity=(await client.post('/api/v1/activities/',json={'project_id':str(project.id),'schedule_period_id':str(live_schedule_period.id),'task_name':'Berth works','duration_hours':8})).json()
    resource=(await client.post('/api/v1/resources/',json={'project_id':str(project.id),'name':'Shared crane','resource_type':'equipment','unit':'hour','rate':120})).json()
    plan,_=terminal();data=plan.model_dump(mode='json')
    data['assets'][0].update(resource_id=resource['id'],activity_id=activity['id'],elements=[{'source_kind':'mesh','element_ref':'mesh:source','element_label':'Berth'}])
    url=f'/api/v1/maritime/projects/{project.id}'
    saved=await client.put(url+'/workspace',json={'version':0,'definition':data});assert saved.status_code==200,saved.text
    assert (await client.post(url+'/runs',json={'version':1})).status_code==201
    copied=await client.post(f'/api/v1/projects/{project.id}/duplicate',json={'name':'Terminal copy'})
    assert copied.status_code==201,copied.text
    assert copied.json()['workspace']=='maritime'
    new_id=uuid.UUID(copied.json()['id']);row=await db.get(MaritimeWorkspace,new_id)
    assert row.version==1
    asset=row.definition['assets'][0]
    assert asset['id']==data['assets'][0]['id']
    assert asset['elements']==[]
    assert asset['activity_id']!=activity['id'] and asset['resource_id']!=resource['id']
    assert (await db.get(Activity,uuid.UUID(asset['activity_id']))).project_id==new_id
    assert (await db.get(Resource,uuid.UUID(asset['resource_id']))).project_id==new_id
    assert (await db.scalars(select(MaritimeRun).where(MaritimeRun.project_id==new_id))).all()==[]
    assert (await db.get(MaritimeWorkspace,project.id)).definition['assets'][0]['elements']


@pytest.mark.asyncio
async def test_maritime_endpoints_require_authentication(raw_client):
    response=await raw_client.get(f'/api/v1/maritime/projects/{uuid.uuid4()}/workspace')
    assert response.status_code==401
