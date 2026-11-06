import uuid
from app.services.geographic_context import reconstruct

async def test_map_source_and_saved_recipe_roundtrip(client,project,monkeypatch):
    data=reconstruct({'elements':[{'type':'way','id':1,'tags':{'building':'house'},'geometry':[{'lat':0,'lon':0},{'lat':0,'lon':.0001},{'lat':.0001,'lon':.0001},{'lat':0,'lon':0}]}]},0,0,100,100)
    calls=[]
    async def fetch(*args):calls.append(args);return data
    monkeypatch.setattr('app.services.geographic_context.fetch_context',fetch)
    result=await client.post('/api/v1/site-context/open-map',json={'project_id':str(project.id),'lat':0,'lon':0,'width':100,'depth':100,'provider':'community'})
    assert result.status_code==200,result.text
    assert calls[0][-1]=='community'
    item={'id':str(uuid.uuid4()),'name':'Context test','kind':'geographic','geographic':result.json(),'up_axis':'z','position':{'x':0,'y':0,'z':0}}
    item['geographic']['features'][0]['height']=12
    item['geographic']['features'][0]['height_basis']='user'
    item['geographic']['features'][0]['surfaces']={'roof':{'finish':'metal','color':'#ab1234'},'wall:0:1':{'finish':'brick'}}
    saved=await client.put(f'/api/v1/site-scenes/{project.id}',json={'command_id':str(uuid.uuid4()),'expected_revision':0,'items':[item]})
    assert saved.status_code==200,saved.text
    restored=(await client.get(f'/api/v1/site-scenes/{project.id}')).json()
    assert restored['items'][0]['geographic']['features'][0]['height']==12
    assert restored['items'][0]['geographic']['source']=='OpenStreetMap'
    assert restored['items'][0]['geographic']['features'][0]['surfaces']['roof']['color']=='#ab1234'
    # Undo uses the same revision-safe scene command, not deletion of source assets.
    undo=await client.put(f'/api/v1/site-scenes/{project.id}',json={'command_id':str(uuid.uuid4()),'expected_revision':1,'items':[]})
    assert undo.status_code==200 and undo.json()['items']==[]

async def test_isolation_persists_and_rejects_wrong_project(client,project):
    planes=[[1,0,0,10],[-1,0,0,10],[0,1,0,10],[0,-1,0,10],[0,0,1,10],[0,0,-1,10]]
    saved=await client.put('/api/v1/site-context/',json={'project_id':str(project.id),'view_isolation':planes,'cutout_mode':'isolate'})
    assert saved.status_code==200,saved.text
    restored=(await client.get('/api/v1/site-context/',params={'project_id':str(project.id)})).json()
    assert restored['view_isolation']==planes and restored['cutout_mode']=='isolate'
    for enabled in (False, True):
        fields={key:value for key,value in restored.items() if key not in ('id','created_at','updated_at')}
        fields['enabled']=enabled
        toggled=await client.put('/api/v1/site-context/',json=fields)
        assert toggled.status_code==200,toggled.text
        restored=(await client.get('/api/v1/site-context/',params={'project_id':str(project.id)})).json()
        assert restored['enabled'] is enabled and restored['view_isolation']==planes
    assert (await client.put('/api/v1/site-context/',json={'project_id':str(project.id),'view_isolation':planes[:2]})).status_code==422
    assert (await client.post('/api/v1/site-context/open-map',json={'project_id':str(uuid.uuid4()),'lat':0,'lon':0})).status_code==404

async def test_replacement_asset_ownership_and_reload(client,project,db):
    from app.models.site_asset import SiteAsset
    asset=SiteAsset(id=uuid.uuid4(),project_id=project.id,name='Replacement oak',category='Trees',status='ready',storage_key='test/oak.glb',upload_key='test/oak-upload.glb',size_bytes=100,dimensions={'width':4,'height':8,'depth':4})
    db.add(asset)
    await db.commit()
    geographic={'source_date':'2026-10-26','lat':0,'lon':0,'width':100,'depth':100,'features':[{'id':'node/1','kind':'tree','name':'Tree','points':[[0,0]],'replacement':{'asset_id':str(asset.id),'width':4,'height':8,'depth':4,'anchor':[0,0,.14]}}]}
    item={'id':str(uuid.uuid4()),'name':'Context','kind':'geographic','geographic':geographic,'up_axis':'z','position':{'x':0,'y':0,'z':0},'rig_disabled':True}
    result=await client.put(f'/api/v1/site-scenes/{project.id}',json={'command_id':str(uuid.uuid4()),'expected_revision':0,'items':[item]})
    assert result.status_code==200,result.text
    saved=(await client.get(f'/api/v1/site-scenes/{project.id}')).json()['items'][0]
    assert saved['geographic']['features'][0]['replacement']['asset_id']==str(asset.id)
    assert saved['rig_disabled'] is True
    item['geographic']['features'][0]['replacement']['asset_id']=str(uuid.uuid4())
    rejected=await client.post(f'/api/v1/site-scenes/{project.id}/preview',json=item)
    assert rejected.status_code==422
