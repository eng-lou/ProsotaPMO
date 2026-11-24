from uuid import UUID

from sqlalchemy import select
from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.model_element_link import ModelElementLink


async def test_repeat_floor_rebinds_hosts_and_deduplicates(client, db, project, live_schedule_period, user, monkeypatch):
    scope=dict(project_id=str(project.id),schedule_period_id=str(live_schedule_period.id))
    endpoint='/api/v1/schedule-bulk-generate/'
    seed=await client.post(endpoint,json={**scope,'activities':[
        dict(temp_id='src',task_name='Level 1'),
        dict(temp_id='fix',task_name='Level 1 columns',parent_temp_id='src',duration_hours=4),
        dict(temp_id='pour',task_name='Level 1 pour',parent_temp_id='src',duration_hours=6)]})
    assert seed.status_code==201,seed.text
    ids=seed.json()['activity_ids_by_temp_id']
    db.add(ActivityRelationship(predecessor_id=UUID(ids['fix']),successor_id=UUID(ids['pour']),relationship_type='FS',lag_hours=2))
    db.add(ModelElementLink(project_id=project.id,activity_id=UUID(ids['pour']),source_kind='ifc',element_ref='source-guid',element_label='Slab L1'))
    await db.commit()
    request={**scope,'source_wbs_id':ids['src'],'source_level':'Level 1','floors':[
        dict(name='Level 2',hosts={'source-guid':dict(ref='next-guid',label='Slab L2')})]}
    for expected in [(3,1),(0,0)]:
        result=await client.post(endpoint+'repeat-floor',json=request)
        assert result.status_code==200,result.text
        assert (result.json()['created'],result.json()['links'])==expected
    new=(await db.scalars(select(Activity).where(Activity.task_name=='Level 2 pour'))).one()
    links=(await db.scalars(select(ModelElementLink).where(ModelElementLink.activity_id==new.id))).all()
    assert [l.element_ref for l in links]==['next-guid']
    assert len((await db.scalars(select(ActivityRelationship))).all())==3
    result=await client.post(endpoint+'repeat-floor',json={**request,'floors':[dict(name='Level 3'),dict(name='Level 1')]})
    assert result.status_code==422
    assert not (await db.scalars(select(Activity).where(Activity.task_name=='Level 3'))).all()
    # This fixture shares its authenticated user across requests, including rollbacks.
    await db.refresh(user)
    from app.services import repeat_floor_cycle
    from fastapi import HTTPException
    async def rejected(*args):
        raise HTTPException(422, 'test interrupted CPM')
    monkeypatch.setattr(repeat_floor_cycle,'recompute_schedule',rejected)
    result=await client.post(endpoint+'repeat-floor',json={**request,'floors':[dict(name='Level 4')]})
    assert result.status_code==422
    assert not (await db.scalars(select(Activity).where(Activity.task_name=='Level 4'))).all()
