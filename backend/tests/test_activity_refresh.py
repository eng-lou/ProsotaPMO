import time
from sqlalchemy import event, inspect
from app.models.activity import Activity
from app.services.activity_refresh import refresh_changed_activities

async def test_bulk_refresh_preserves_identity_and_loads_expired_fields(db, project, live_schedule_period):
    rows = [Activity(project_id=project.id, schedule_variant_id=live_schedule_period.schedule_variant_id,
        schedule_period_id=live_schedule_period.id, code=f'T-{i:04}', task_name=f'Activity {i}') for i in range(600)]
    db.add_all(rows)
    await db.commit()
    ids = {row.id for row in rows}
    old_start=time.perf_counter()
    for row in rows:
        await db.refresh(row)
    old_seconds=time.perf_counter()-old_start
    for row in rows:
        db.expire(row, ['updated_at', 'task_name'])
    statements=[]
    engine=db.bind.sync_engine
    def count(conn,cursor,statement,parameters,context,executemany):
        statements.append(statement)
    event.listen(engine,'before_cursor_execute',count)
    start=time.perf_counter()
    try:
        await refresh_changed_activities(db,ids)
    finally:
        event.remove(engine,'before_cursor_execute',count)
    print(f'600-row refresh: previous={old_seconds:.3f}s / 600 queries; batched={time.perf_counter()-start:.3f}s / {len(statements)} queries')
    assert len(statements)==2
    for i,row in enumerate(rows):
        assert not inspect(row).expired_attributes
        assert row.task_name==f'Activity {i}'
        assert row.updated_at is not None
        assert await db.get(Activity,row.id) is row
