from copy import deepcopy
from app.main import app
from app.core.auth import get_db_user


def definition():
    return {
        'schema_version': 1,
        'controls': [{'id': 'lift', 'name': 'Boom lift', 'value': 0.5, 'rest': 0, 'keys': [
            {'date': '2026-10-09T12:00:00Z', 'value': 0, 'interpolation': 'linear'},
            {'date': '2026-10-09T12:00:10Z', 'value': 1, 'interpolation': 'smooth'}]}],
        'joints': [{'id': 'boom', 'name': 'Boom', 'node': '/0:Boom', 'parent': None, 'control': 'lift', 'kind': 'hinge',
                    'pivot': [1, 0, 0], 'axis': [0, 1, 0], 'minimum': -30, 'maximum': 70, 'response': [[0, 0], [1, 1]]}],
        'followers': []}


async def create(client, project, d=None):
    return await client.post('/api/v1/equipment-rigs/', json={
        'project_id': str(project.id), 'model_ref': 'backhoe.glb', 'name': 'Backhoe', 'definition': d or definition()})


async def test_equipment_roundtrip_concurrency_delete(client, project):
    response = await create(client, project)
    assert response.status_code == 201, response.text
    rig = response.json()
    rows = (await client.get('/api/v1/equipment-rigs/', params={'project_id': str(project.id)})).json()
    assert rows == [rig]
    assert rig['definition']['controls'][0]['keys'][1]['value'] == 1
    assert (await create(client, project)).status_code == 409
    update = {'version': rig['version'], 'name': 'Backhoe 2', 'definition': definition()}
    assert (await client.put(f"/api/v1/equipment-rigs/{rig['id']}", json=update)).status_code == 200
    assert (await client.put(f"/api/v1/equipment-rigs/{rig['id']}", json=update)).status_code == 409
    assert (await client.delete(f"/api/v1/equipment-rigs/{rig['id']}")).status_code == 204
    assert (await client.get('/api/v1/equipment-rigs/', params={'project_id': str(project.id)})).json() == []


async def test_equipment_rejects_invalid_definitions(client, project):
    samples = []
    d = definition(); d['joints'][0]['parent'] = 'boom'; samples.append(d)
    d = definition(); d['joints'][0]['parent'] = 'missing'; samples.append(d)
    d = definition(); d['joints'][0]['control'] = 'missing'; samples.append(d)
    d = definition(); d['joints'][0]['axis'] = [0, 0, 0]; samples.append(d)
    d = definition(); d['joints'][0]['response'] = [[0, 0], [0, 1]]; samples.append(d)
    d = definition(); d['controls'][0]['keys'][1]['date'] = d['controls'][0]['keys'][0]['date']; samples.append(d)
    d = definition(); d['controls'][0]['value'] = 2; samples.append(d)
    d = definition(); d['controls'][0]['keys'][0]['date'] = '2026-10-09T12:00:00'; samples.append(d)
    d = definition(); j = deepcopy(d['joints'][0]); j['id'] = 'other'; d['joints'].append(j); samples.append(d)
    d = definition(); d['followers'] = [{'id': 'f', 'name': 'f', 'barrel': '/1:Barrel', 'piston': '/2:Piston', 'base_node': '/1:Barrel', 'tip_node': '/0:Boom', 'base_point': [0, 0, 0], 'tip_point': [0, 1, 0]}]; samples.append(d)
    for sample in samples:
        response = await create(client, project, sample)
        assert response.status_code == 422, response.text
    assert (await client.get('/api/v1/equipment-rigs/', params={'project_id': str(project.id)})).json() == []


async def test_equipment_is_private_to_project_owner(client, project, other_user):
    rig = (await create(client, project)).json()
    old = app.dependency_overrides.get(get_db_user)
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        assert (await client.get('/api/v1/equipment-rigs/', params={'project_id': str(project.id)})).status_code == 404
        assert (await create(client, project)).status_code == 404
        assert (await client.put(f"/api/v1/equipment-rigs/{rig['id']}", json={'version': 1, 'name': 'x', 'definition': definition()})).status_code == 404
        assert (await client.delete(f"/api/v1/equipment-rigs/{rig['id']}")).status_code == 404
    finally:
        if old is None:
            app.dependency_overrides.pop(get_db_user, None)
        else:
            app.dependency_overrides[get_db_user] = old


async def test_equipment_migration(db):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import text
    # Run DDL in a private schema so the shared fixture schema remains intact.
    import importlib.util
    from pathlib import Path
    spec = importlib.util.spec_from_file_location('equipment_migration', Path(__file__).parents[1] / 'alembic/versions/e8c395fd0123_equipment_rigs.py')
    migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
    connection = await db.connection()
    await connection.execute(text('CREATE SCHEMA equipment_migration_test'))
    await connection.execute(text('SET LOCAL search_path TO equipment_migration_test'))
    await connection.execute(text('CREATE TABLE projects (id uuid PRIMARY KEY)'))
    def run(sync):
        migration.op = Operations(MigrationContext.configure(sync))
        migration.upgrade()
        assert sync.execute(text("SELECT to_regclass('equipment_rigs')")).scalar() is not None
        migration.downgrade()
        assert sync.execute(text("SELECT to_regclass('equipment_rigs')")).scalar() is None
    await connection.run_sync(run)
    await db.rollback()


async def test_moving_group_members_roundtrip_and_validation(client, project):
    d = definition()
    d['joints'][0]['members'] = ['/1:ArmRight', '/2:Crossbar']
    response = await create(client, project, d)
    assert response.status_code == 201, response.text
    rig = response.json()
    assert rig['definition']['joints'][0]['members'] == d['joints'][0]['members']
    for members in [['/0:Boom'], ['/0:Boom/0:Bolt'], ['']]:
        invalid = deepcopy(d)
        invalid['joints'][0]['members'] = members
        result = await client.put(f"/api/v1/equipment-rigs/{rig['id']}", json={
            'version': rig['version'], 'name': rig['name'], 'definition': invalid})
        assert result.status_code == 422, result.text
