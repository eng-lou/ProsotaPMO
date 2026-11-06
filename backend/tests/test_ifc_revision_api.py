import gzip
import uuid
import ifcopenshell
from sqlalchemy import select
from app.models.model3d_file import Model3DFile
from app.models.model_element_link import ModelElementLink
from app.models.cost_rate_line import CostRateLine
from app.models.activity import Activity
from tests.test_ifc_revision import fixture

async def setup_review(client, db, project, storage, change):
    old = fixture()
    new = ifcopenshell.file.from_string(old.to_string())
    change(new)
    storage.objects['baseline.ifc'] = old.to_string().encode()
    row = Model3DFile(project_id=project.id, name='Baseline.ifc', kind='ifc', source_up_axis='z', storage_filename='baseline.ifc', size_bytes=len(storage.objects['baseline.ifc']))
    db.add(row); await db.commit()
    base = f'/api/v1/model3d-files/{row.id}'
    response = await client.post(base+'/revisions', json={'name':'Revised.ifc'})
    assert response.status_code == 200, response.text
    start = response.json()
    key = start['upload_url'].removeprefix(storage.PUT_PREFIX)
    storage.objects[key] = gzip.compress(new.to_string().encode())
    return row, old, new, base, start['id'], key

async def test_review_is_non_destructive_then_apply_preserves_assignment(client, db, project, live_schedule_period, live_period, fake_object_storage):
    row, old, new, base, revision, candidate = await setup_review(client, db, project, fake_object_storage, lambda f: setattr(f.by_type('IfcWall')[0], 'Name', 'Revised wall'))
    guid = new.by_type('IfcWall')[0].GlobalId
    activity = (await client.post('/api/v1/activities/', json={'project_id':str(project.id), 'schedule_period_id':str(live_schedule_period.id), 'task_name':'Build wall'})).json()
    link = (await client.post('/api/v1/model-element-links/', json={'activity_id':activity['id'], 'source_kind':'ifc', 'element_ref':guid, 'element_label':'Wall'})).json()
    cost = (await client.post('/api/v1/cost-elements/', json={'project_id':str(project.id), 'period_id':str(live_period.id), 'element_type':'fixed', 'element_group':'BOQ', 'description':'Bill of Quantities'})).json()
    line_response = await client.post('/api/v1/cost-rate-lines/', json={'cost_element_id':cost['id'], 'description':'Wall','qty':'2','rate':'10','area_m2':'6'})
    assert line_response.status_code == 201, line_response.text
    version = (await client.get(base+'/content-version')).json()
    report = await client.post(base+f'/revisions/{revision}/compare')
    assert report.status_code == 200, report.text
    assert len(report.json()['report']['changes'][0]['assignments']) == 1
    assert row.storage_filename == 'baseline.ifc'
    # Overwriting the original signed PUT cannot change the reviewed snapshot.
    fake_object_storage.objects[candidate] = b'not IFC'
    geometry = await client.get(base+f'/revisions/{revision}/geometry/{guid}')
    assert geometry.status_code == 200, geometry.text
    assert geometry.json()['before']['faces']
    invalid = await client.post(base+f'/revisions/{revision}/apply', json={'decisions':{guid:{'action':'reject'}}})
    assert invalid.status_code == 422
    draft = {'decisions':{guid:{'action':'accept','assignments':'keep','rationale':''}}}
    assert (await client.put(base+f'/revisions/{revision}/draft', json=draft)).status_code == 200
    response = await client.post(base+f'/revisions/{revision}/apply', json=draft)
    assert response.status_code == 200, response.text
    assert (await client.get(base+'/content-version')).json() != version
    assert await db.get(ModelElementLink, uuid.UUID(link['id']))
    assert await db.get(Activity, uuid.UUID(activity['id']))
    line = await db.get(CostRateLine, uuid.UUID(line_response.json()['id']))
    await db.refresh(line)
    assert line.quantity_review_required and float(line.area_m2) == 6
    assert (await client.post(base+f'/revisions/{revision}/apply', json=draft)).status_code == 200
    approved = ifcopenshell.file.from_string(gzip.decompress(fake_object_storage.objects[row.storage_filename]).decode())
    assert approved.by_guid(guid).Name == 'Revised wall'

async def test_removed_element_unlinks_but_shared_activity_survives(client, db, project, live_schedule_period, fake_object_storage):
    def remove(f): f.remove(f.by_type('IfcWall')[0])
    row, old, new, base, revision, _ = await setup_review(client, db, project, fake_object_storage, remove)
    guid = old.by_type('IfcWall')[0].GlobalId
    activity = (await client.post('/api/v1/activities/', json={'project_id':str(project.id),'schedule_period_id':str(live_schedule_period.id),'task_name':'Shared activity'})).json()
    for ref in (guid, guid+'::split:0', new.by_type('IfcWall')[0].GlobalId):
        response = await client.post('/api/v1/model-element-links/', json={'activity_id':activity['id'],'source_kind':'ifc','element_ref':ref,'element_label':'Wall'})
        assert response.status_code == 201, response.text
    assert (await client.post(base+f'/revisions/{revision}/compare')).status_code == 200
    response = await client.post(base+f'/revisions/{revision}/apply', json={'decisions':{guid:{'action':'accept'}}})
    assert response.status_code == 200, response.text
    remaining = (await db.execute(select(ModelElementLink))).scalars().all()
    assert len(remaining) == 1 and remaining[0].element_ref == new.by_type('IfcWall')[0].GlobalId
    assert await db.get(Activity, uuid.UUID(activity['id']))

async def test_ownership_and_stale_review(client, db, project, other_user, fake_object_storage):
    row, old, new, base, revision, _ = await setup_review(client, db, project, fake_object_storage, lambda f: setattr(f.by_type('IfcWall')[0], 'Name', 'Changed'))
    assert (await client.post(base+f'/revisions/{revision}/compare')).status_code == 200
    row.storage_filename = 'another-revision.ifc'; await db.commit()
    response = await client.post(base+f'/revisions/{revision}/apply', json={'decisions':{new.by_type('IfcWall')[0].GlobalId:{'action':'accept'}}})
    assert response.status_code == 409
    project.created_by = other_user.id; await db.commit()
    assert (await client.get(base+'/revisions')).status_code == 404
