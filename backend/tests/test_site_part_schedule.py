import uuid
import copy
from sqlalchemy import event
from sqlalchemy import select, func
from app.models.site_asset import SiteAsset
from app.models.site_scene import SiteScene
from app.models.activity import Activity
from app.models.model_element_link import ModelElementLink
from app.models.animation_profile import AnimationProfile

async def setup_scene(client,db,project):
    asset=SiteAsset(id=uuid.uuid4(),project_id=project.id,name='Kit',category='Other',status='ready',storage_key='test-parts.glb',upload_key='test-parts-upload.glb',dimensions={'width':20,'height':20,'depth':20},size_bytes=100)
    db.add(asset);await db.commit()
    parts=[dict(id=str(uuid.uuid4()),name=f'Part {i}',kind='asset',asset_id=str(asset.id),asset_part=dict(path=[0,i],transform=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),assembly_id=str(asset.id),assembly_name='Kit',rig_disabled=True,up_axis='z',position=dict(x=i,y=0,z=0)) for i in range(3)]
    response=await client.put(f'/api/v1/site-scenes/{project.id}',json=dict(command_id=str(uuid.uuid4()),expected_revision=0,items=parts))
    assert response.status_code==200,response.text
    return parts

def payload(project,period,parts):
    return dict(project_id=str(project.id),schedule_period_id=str(period.id),site_animation_profile=dict(transform_kind='fall',axis='z',direction=-1,color_from=None),activities=[dict(temp_id=p['id'],task_name=p['name'],duration_hours=8,source_kind='site',element_refs=[p['id']],element_labels=[p['name']]) for p in parts],relationships=[dict(predecessor_temp_id=parts[0]['id'],successor_temp_id=parts[1]['id'],relationship_type='FS')])

async def test_parts_persist_and_generate_real_site_links(client,db,project,live_schedule_period):
    parts=await setup_scene(client,db,project)
    saved=(await client.get(f'/api/v1/site-scenes/{project.id}')).json()['items']
    assert saved[1]['asset_part']['path']==[0,1] and saved[1]['rig_disabled']
    response=await client.post('/api/v1/schedule-bulk-generate/',json=payload(project,live_schedule_period,parts))
    assert response.status_code==201,response.text
    assert response.json()['model_element_link_count']==3
    links=(await db.scalars(select(ModelElementLink).where(ModelElementLink.project_id==project.id))).all()
    assert {l.element_ref for l in links}=={p['id'] for p in parts}
    assert all(l.source_kind=='site' and l.animation_profile_id for l in links)
    assert len({l.animation_profile_id for l in links})==1
    assert (await db.get(AnimationProfile,links[0].animation_profile_id)).config['transform_kind']=='fall'
    for aid in response.json()['activity_ids_by_temp_id'].values():
        activity=await db.get(Activity,uuid.UUID(aid));assert activity.start and activity.finish

async def test_missing_parts_and_foreign_profiles_rejected_without_creating_schedule(client,db,project,live_schedule_period):
    parts=await setup_scene(client,db,project);data=payload(project,live_schedule_period,parts)
    data['activities'][0]['element_refs']=[str(uuid.uuid4())]
    response=await client.post('/api/v1/schedule-bulk-generate/',json=data)
    assert response.status_code==422,response.text
    data=payload(project,live_schedule_period,parts);data['activities'][0]['animation_profile_id']=str(uuid.uuid4())
    response=await client.post('/api/v1/schedule-bulk-generate/',json=data)
    assert response.status_code==422,response.text
    assert await db.scalar(select(func.count()).select_from(Activity))==0
    assert await db.scalar(select(func.count()).select_from(AnimationProfile))==0

async def test_large_assembly_save_reload_edit_and_schedule(client,db,project,live_schedule_period):
    asset=SiteAsset(id=uuid.uuid4(),project_id=project.id,name='Data centre',category='Other',status='ready',storage_key='large-parts.glb',upload_key='large-upload.glb',dimensions={'width':242,'height':13.5,'depth':162},size_bytes=100)
    db.add(asset);await db.commit()
    asset_id=str(asset.id);db.expunge(asset)
    parts=[dict(id=str(uuid.uuid4()),name=f'Part {i}',kind='asset',asset_id=asset_id,asset_part=dict(path=[0,i],transform=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),assembly_id=asset_id,assembly_name='Data centre',rig_disabled=True,up_axis='z',position=dict(x=i%60,y=i//60,z=0)) for i in range(3447)]
    url=f'/api/v1/site-scenes/{project.id}'
    command=dict(command_id=str(uuid.uuid4()),expected_revision=0,items=parts)
    asset_queries=[]
    def track(connection,cursor,statement,parameters,context,executemany):
        if 'FROM site_assets' in statement:asset_queries.append(statement)
    event.listen(db.bind.sync_engine,'before_cursor_execute',track)
    try:
        response=await client.put(url,json=command)
    finally:
        event.remove(db.bind.sync_engine,'before_cursor_execute',track)
    assert response.status_code==200,response.text[:1000]
    assert len(asset_queries)==1,'Shared assets must be fetched once per save request'
    saved=(await client.get(url)).json()
    assert saved['revision']==1 and len(saved['items'])==3447
    assert saved['items'][-1]['asset_part']['path']==[0,3446]
    assert len({p['id'] for p in saved['items']})==3447
    assert (await client.put(url,json=command)).json()['revision']==1
    parts[-1]['position']['z']=12;parts[0]['locked']=True
    changed=await client.put(url,json=dict(command_id=str(uuid.uuid4()),expected_revision=1,items=parts))
    assert changed.status_code==200,changed.text[:1000]
    assert changed.json()['items'][-1]['position']['z']==12
    # Existing conflict, lock and asset-ownership checks still apply to large saves.
    assert (await client.put(url,json=dict(command_id=str(uuid.uuid4()),expected_revision=1,items=parts))).status_code==409
    assert (await client.put(url,json=dict(command_id=str(uuid.uuid4()),expected_revision=2,items=parts[1:]))).status_code==409
    invalid=copy.deepcopy(parts);invalid[-1]['asset_id']=str(uuid.uuid4())
    rejected=await client.put(url,json=dict(command_id=str(uuid.uuid4()),expected_revision=2,items=invalid))
    assert rejected.status_code==422,rejected.text[:1000]
    assert (await client.get(url)).json()['revision']==2
    chosen=[parts[i] for i in [1,1723,3446]]
    generated=await client.post('/api/v1/schedule-bulk-generate/',json=payload(project,live_schedule_period,chosen))
    assert generated.status_code==201,generated.text[:1000]
    assert generated.json()['model_element_link_count']==3
    links=(await db.scalars(select(ModelElementLink).where(ModelElementLink.project_id==project.id))).all()
    assert {link.element_ref for link in links}=={part['id'] for part in chosen}
