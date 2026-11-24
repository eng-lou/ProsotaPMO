import copy
import gzip
from pathlib import Path
import json
from datetime import datetime, time
from decimal import Decimal
import uuid

import pytest
from sqlalchemy import insert, select
from app.models.project import Project
from app.services import project_transfer as svc


def test_format_covers_all_persisted_project_modules():
    from app.models.base import Base
    scoped = {'projects'}
    while True:
        expanded = scoped | {t.name for t in Base.metadata.tables.values()
                             if any(fk.column.table.name in scoped for c in t.c for fk in c.foreign_keys)}
        if expanded == scoped: break
        scoped = expanded
    assert scoped - set(svc.TABLE_NAMES) == {'site_scene_commands'}  # retry tokens, not authored content


async def row(db, table, **values):
    return dict((await db.execute(insert(svc.TABLES[table]).values(**values).returning(svc.TABLES[table]))).mappings().one())


@pytest.fixture
async def populated(db, project):
    pid = project.id
    variant = await row(db, 'schedule_variants', project_id=pid, name='Master', is_master=True)
    period = await row(db, 'schedule_periods', schedule_variant_id=variant['id'], period_label='Live', start_time=time(8, 30))
    calendar = await row(db, 'calendars', project_id=pid, name='Site', is_project_default=True)
    await row(db, 'calendar_breaks', calendar_id=calendar['id'], label='Lunch', start_time=time(12), end_time=time(13))
    profile = await row(db, 'animation_profiles', project_id=pid, name='Remove', config={'opacity': [1, 0]})
    root = await row(db, 'activities', project_id=pid, schedule_variant_id=variant['id'], schedule_period_id=period['id'], code='W-1', task_name='Site', activity_type='wbs')
    activity = await row(db, 'activities', project_id=pid, schedule_variant_id=variant['id'], schedule_period_id=period['id'],
                         code='T-4', task_name='Clear vegetation', parent_id=root['id'], calendar_id=calendar['id'],
                         animation_profile_id=profile['id'], duration_hours=Decimal('16.5'))
    await row(db, 'activity_relationships', predecessor_id=root['id'], successor_id=activity['id'], relationship_type='SS', lag_hours=Decimal('1.25'))
    resource = await row(db, 'resources', project_id=pid, name='Crew', resource_type='labour', unit='day', rate=Decimal('175.25'))
    await row(db, 'resource_assignments', activity_id=activity['id'], resource_id=resource['id'], quantity=Decimal('2'), utilisation_pct=Decimal('73.125'))
    asset = await row(db, 'site_assets', project_id=pid, name='Trees', category='Other', storage_key='site-assets/trees.glb', upload_key='uploads/old.glb', status='ready', size_bytes=7)
    await row(db, 'site_scenes', project_id=pid, revision=8, items=[{'id': 'tree-scatter', 'asset_id': str(asset['id']), 'kind': 'scatter', 'positions': [[1, 2, 3]]}])
    model = await row(db, 'model3d_files', project_id=pid, name='Fort.ifc', kind='ifc', source_up_axis='z', storage_filename='model3d/fort.ifc.gz', size_bytes=8)
    await row(db, 'model_element_links', project_id=pid, activity_id=activity['id'], source_kind='site', element_ref='site:tree-scatter', element_label='Trees', animation_profile_id=profile['id'])
    await row(db, 'model_element_links', project_id=pid, activity_id=activity['id'], source_kind='ifc', element_ref='IFC_GLOBAL_ID', element_label='Wall')
    await row(db, 'dock_layouts', project_id=pid, name='My view', config={'model': str(model['id']), 'selected': [str(activity['id'])]})
    media = await row(db, 'annotation_media', project_id=pid, name='Photo', content_type='image/png', ready=True)
    await db.commit()
    return {'activity': activity, 'model': model, 'asset': asset, 'media': media}


@pytest.mark.asyncio
async def test_complete_round_trip_preserves_dates_links_files_and_source(db, project, user, populated):
    original = await svc.capture(db, project.id)
    snapshot = json.loads(svc.dumps(original))
    target = uuid.uuid4()
    await svc.restore(db, snapshot, target, user, 'Tower Web')
    await db.commit()
    restored = await svc.capture(db, target)
    ids, files = svc.mappings(snapshot, target, user.id)
    assert {k: len(v) for k, v in original['records'].items()} == {k: len(v) for k, v in restored['records'].items()}
    assert restored['records']['projects'][0]['name'] == 'Tower Web'
    activities = restored['records']['activities']
    child = next(a for a in activities if a['code'] == 'T-4')
    assert child['duration_hours'] == '16.50'
    assert child['parent_id'] in {a['id'] for a in activities}
    assert restored['records']['schedule_periods'][0]['start_time'] == '08:30:00'
    assert restored['records']['resource_assignments'][0]['utilisation_pct'] == '73.125000'
    assert {a['activity_id'] for a in restored['records']['model_element_links']} == {child['id']}
    assert restored['records']['site_scenes'][0]['items'][0]['asset_id'] == ids[str(populated['asset']['id'])]
    assert restored['records']['model3d_files'][0]['storage_filename'] == files['model3d/fort.ifc.gz']
    assert restored['records']['dock_layouts'][0]['config']['model'] == ids[str(populated['model']['id'])]
    assert svc.media_key(restored['records']['annotation_media'][0]) == files[svc.media_key(original['records']['annotation_media'][0])]
    assert await svc.capture(db, project.id) == original


@pytest.mark.asyncio
async def test_export_cannot_include_other_projects_or_accounts(db, project, user, other_user, populated):
    foreign = Project(org_id=user.org_id, created_by=other_user.id, name='Private')
    db.add(foreign); await db.commit()
    await row(db, 'site_scenes', project_id=foreign.id, revision=1, items=[{'private': True}])
    data = await svc.capture(db, project.id)
    assert len(data['records']['site_scenes']) == 1
    assert str(foreign.id) not in svc.dumps(data).decode()
    assert str(user.id) not in svc.dumps(data).decode()
    assert not ({'users', 'organisations', 'app_settings', 'desktop_sessions'} & data['records'].keys())


@pytest.mark.asyncio
@pytest.mark.parametrize('attack', ['table', 'project', 'foreign-key', 'path', 'version', 'duplicate'])
async def test_invalid_package_rejected(db, project, populated, attack):
    data = await svc.capture(db, project.id)
    if attack == 'table': data['records']['users'] = []
    if attack == 'project': data['records']['site_scenes'][0]['project_id'] = str(uuid.uuid4())
    if attack == 'foreign-key': data['records']['model_element_links'][0]['activity_id'] = str(uuid.uuid4())
    if attack == 'path': data['records']['model3d_files'][0]['storage_filename'] = '../private'
    if attack == 'version': data['version'] = 999
    if attack == 'duplicate': data['records']['activities'].append(copy.deepcopy(data['records']['activities'][0]))
    with pytest.raises(ValueError): svc.validate(data)


@pytest.mark.asyncio
async def test_transfer_api_ownership_upload_validation_and_idempotency(client, db, project, user, other_user, populated, monkeypatch):
    from app.api import project_transfers as api
    from botocore.exceptions import ClientError
    storage = {}
    for key in svc.file_keys((await svc.capture(db, project.id))['records']): storage[key] = b'bytes'
    def head(key):
        if key not in storage: raise ClientError({'Error': {'Code': 'NoSuchKey'}}, 'HeadObject')
        return len(storage[key])
    monkeypatch.setattr(api.storage, 'head_object_size', head)
    monkeypatch.setattr(api.storage, 'upload_bytes', lambda k, b, *args: storage.__setitem__(k, b))
    monkeypatch.setattr(api.storage, 'download_to_path', lambda k, p: p.write_bytes(storage[k]))
    monkeypatch.setattr(api.storage, 'presigned_get_url', lambda k: 'https://storage.example/' + k)
    monkeypatch.setattr(api.storage, 'presigned_put_url', lambda k, *args: 'https://storage.example/' + k)
    monkeypatch.setattr(api.storage, 'delete_object', lambda k: storage.pop(k, None))
    foreign = Project(org_id=user.org_id, created_by=other_user.id, name='Private')
    db.add(foreign); await db.commit()
    assert (await client.post(f'/api/v1/project-transfers/export/{foreign.id}')).status_code == 404
    exported = await client.post(f'/api/v1/project-transfers/export/{project.id}')
    assert exported.status_code == 200, exported.text
    data = json.loads(storage[api.manifest_key(user.id, exported.json()['id'], export=True)])
    started = await client.post('/api/v1/project-transfers/imports')
    target = uuid.UUID(started.json()['id'])
    storage[api.manifest_key(user.id, target)] = svc.dumps(data)
    # Imported manifests cannot be used to request signed downloads of arbitrary objects.
    forged = await client.get(f'/api/v1/project-transfers/exports/{target}/files')
    assert forged.status_code == 422
    assert (await client.post(f'/api/v1/project-transfers/imports/{target}/commit', json={'name': 'Imported'})).status_code == 409
    assert await db.get(Project, target) is None
    uploads = await client.get(f'/api/v1/project-transfers/imports/{target}/files')
    assert uploads.status_code == 200
    _, files = svc.mappings(data, target, user.id)
    for entry in data['files']: storage[files[entry['key']]] = b'bytes'
    complete = await client.post(f'/api/v1/project-transfers/imports/{target}/commit', json={'name': 'Imported'})
    assert complete.status_code == 200, complete.text
    repeat = await client.post(f'/api/v1/project-transfers/imports/{target}/commit', json={'name': 'Should not overwrite'})
    assert repeat.status_code == 200 and repeat.json()['name'] == 'Imported'
    assert (await client.delete(f'/api/v1/project-transfers/imports/{target}')).json() == {'discarded': False}
    assert all(files[f['key']] in storage for f in data['files'])
    abandoned = uuid.uuid4()
    storage[api.manifest_key(user.id, abandoned)] = svc.dumps(data)
    _, abandoned_keys = svc.mappings(data, abandoned, user.id)
    for key in abandoned_keys.values(): storage[key] = b'partial'
    assert (await client.delete(f'/api/v1/project-transfers/imports/{abandoned}')).json() == {'discarded': True}
    assert not any(k in storage for k in abandoned_keys.values())


@pytest.mark.asyncio
async def test_atomic_restore_rollback_on_invalid_values(client, db, project, user, populated, monkeypatch):
    from app.api import project_transfers as api
    data = await svc.capture(db, project.id)
    # A valid reference graph but invalid SQL value must not leave a partial project.
    data['records']['activities'][0]['code'] = 'x' * 100
    data['files'] = []
    monkeypatch.setattr(api, 'read_manifest', lambda *args: data)
    target = uuid.uuid4()
    source_id = project.id
    response = await client.post(f'/api/v1/project-transfers/imports/{target}/commit', json={})
    assert response.status_code == 422
    assert await db.get(Project, target) is None
    assert await db.get(Project, source_id) is not None


@pytest.mark.asyncio
async def test_older_desktop_backup_bridge(db, project, populated, tmp_path):
    """Exercise a real pg_dump/restore and checksum-checked file extraction."""
    import hashlib
    import os
    from pathlib import Path
    import subprocess
    import sys
    import zipfile
    from sqlalchemy.engine import make_url
    url = make_url(os.environ['TEST_DATABASE_URL'])
    repo = Path(__file__).resolve().parents[2]
    # A worktree may share an existing development installation's bundled tools.
    pg = Path(os.environ.get('TEST_PG_BIN', str(repo / 'desktop/runtime/postgres/bin')))
    assert (pg / 'pg_dump.exe').is_file(), 'Set TEST_PG_BIN to the bundled PostgreSQL bin directory'
    dump = tmp_path / 'database.dump'
    env = {**os.environ, 'PGPASSWORD': url.password or ''}
    result = subprocess.run([str(pg / 'pg_dump.exe'), '-h', url.host, '-p', str(url.port or 5432), '-U', url.username,
        '-d', url.database, '--format=custom', '--no-owner', '--no-acl', '--file', str(dump)], env=env, capture_output=True, timeout=60)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    data = await svc.capture(db, project.id)
    content = {'database.dump': dump.read_bytes(), **{'files/' + key: b'bytes' for key in svc.file_keys(data['records'])}}
    backup = tmp_path / 'desktop.prosota-backup'
    with zipfile.ZipFile(backup, 'w') as archive:
        for key, value in content.items(): archive.writestr(key, value)
        archive.writestr('manifest.json', json.dumps({'format': 'prosota-desktop-backup', 'version': 1,
            'files': {key: hashlib.sha256(value).hexdigest() for key, value in content.items()}}))
    output = tmp_path / 'exported'
    env['PROSOTA_TRANSFER_ADMIN_URL'] = url.set(database='postgres').render_as_string(hide_password=False)
    result = subprocess.run([sys.executable, str(repo / 'backend/scripts/export_desktop_project.py'), '--backup', str(backup),
        '--project', project.name, '--output', str(output), '--pg-restore', str(pg / 'pg_restore.exe')], env=env, capture_output=True, timeout=90)
    assert result.returncode == 0, result.stderr.decode(errors='replace')
    package = json.loads((output / 'project.prosota.json').read_bytes())
    svc.validate(package)
    assert len(package['records']['activities']) == 2
    assert all((output / f['path']).read_bytes() == b'bytes' for f in package['files'])


@pytest.fixture
def copy_storage(monkeypatch, tmp_path):
    # Exercise actual file copying and the same download-key contract as desktop.
    import importlib.util
    from app.services import object_storage

    module = Path(__file__).resolve().parents[2] / 'desktop/backend/local_storage.py'
    spec = importlib.util.spec_from_file_location('desktop_copy_storage', module)
    local = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local)
    local.configure(tmp_path, 'test', 'http://test')
    for method in ('copy_object', 'delete_object', 'presigned_get_url'):
        monkeypatch.setattr(object_storage, method, getattr(local, method))
    return local


@pytest.fixture
async def copy_fixture(db, project, populated, copy_storage):
    model, activity = populated['model'], populated['activity']
    # An archived library asset can still be pinned by a placed scene instance.
    await db.execute(svc.TABLES['site_assets'].update().where(
        svc.TABLES['site_assets'].c.id == populated['asset']['id']).values(status='archived'))
    await row(db, 'element_transforms', project_id=project.id, model3d_file_id=model['id'], position_x=42)
    await row(db, 'equipment_rigs', project_id=project.id, name='Core', model_ref='site:tree-scatter',
              definition={'lift_activity': str(activity['id'])})
    await row(db, 'site_assets', project_id=project.id, name='Unfinished', category='Other',
              storage_key='site-assets/waiting.glb', upload_key='uploads/waiting.glb', status='pending')
    links = svc.TABLES['model_element_links']
    await db.execute(links.update().where(links.c.project_id == project.id, links.c.source_kind == 'ifc')
                     .values(element_ref='0000000000000000000001'))
    await db.commit()
    fixtures = Path(__file__).resolve().parents[2] / 'desktop/tests/fixtures'
    source = {model['storage_filename']: gzip.compress((fixtures / 'wall.ifc').read_bytes()),
              populated['asset']['storage_key']: (fixtures / 'site-cabin.glb').read_bytes(),
              svc.media_key(populated['media']): b'annotation'}
    for key, payload in source.items():
        copy_storage.upload_bytes(key, payload)
    return source


async def test_duplicate_project_files_links_and_rig(client, db, project, populated, copy_fixture, copy_storage):
    from app.services.simulation import sources
    period_id = populated['activity']['schedule_period_id']
    current = await sources(db, project.id, period_id)
    await row(db, 'working_simulation_sequences', project_id=project.id, schedule_period_id=period_id,
              snapshot={'source_hash': current['hash']}, source_hash=current['hash'])
    await row(db, 'simulation_scenarios', project_id=project.id, schedule_period_id=period_id,
              name='Old review', source_hash='old', config={})
    await db.commit()
    payload = {'request_id': str(uuid.uuid4())}
    url = f'/api/v1/projects/{project.id}/duplicate'
    response = await client.post(url, json=payload)
    assert response.status_code == 201, response.text
    dest = uuid.UUID(response.json()['id'])
    retry = await client.post(url, json=payload)
    assert retry.status_code == 201 and retry.json()['id'] == str(dest)
    copied = (await svc.capture(db, dest))['records']
    model = copied['model3d_files'][0]
    asset, = copied['site_assets']
    assert asset['status'] == 'archived'
    child = next(a for a in copied['activities'] if a['code'] == 'T-4')
    assert {link['activity_id'] for link in copied['model_element_links']} == {child['id']}
    assert child['animation_profile_id'] == copied['animation_profiles'][0]['id']
    assert copied['equipment_rigs'][0]['definition']['lift_activity'] == child['id']
    assert copied['site_scenes'][0]['items'][0]['asset_id'] == asset['id']
    assert copied['element_transforms'][0]['model3d_file_id'] == model['id']
    assert copied['element_transforms'][0]['position_x'] == 42
    dest_hash = (await sources(db, dest, uuid.UUID(child['schedule_period_id'])))['hash']
    working = copied['working_simulation_sequences'][0]
    assert working['source_hash'] == working['snapshot']['source_hash'] == dest_hash != current['hash']
    assert copied['simulation_scenarios'][0]['source_hash'] == 'old'
    for key, original in [(model['storage_filename'], 'model3d/fort.ifc.gz'), (asset['storage_key'], 'site-assets/trees.glb')]:
        assert key != original and copy_storage.path_for(key).read_bytes() == copy_fixture[original]
    assert copy_storage.path_for(svc.media_key(copied['annotation_media'][0])).read_bytes() == b'annotation'
    linked_guid = next(link['element_ref'] for link in copied['model_element_links'] if link['source_kind'] == 'ifc')
    assert linked_guid.encode() in gzip.decompress(copy_storage.path_for(model['storage_filename']).read_bytes())
    result = await client.get(f"/api/v1/model3d-files/{model['id']}/download", follow_redirects=False)
    assert result.status_code == 307 and model['storage_filename'] in result.headers['location']
    assert (await client.delete(f"/api/v1/model3d-files/{model['id']}")).status_code == 204
    assert all(copy_storage.path_for(k).read_bytes() == v for k, v in copy_fixture.items())


async def test_restore_old_duplicate_preserves_activity_edits_and_can_retry(client, db, project, user, populated, copy_fixture, copy_storage):
    dest = await row(db, 'projects', name='Edited Fort Tower copy', org_id=user.org_id, created_by=user.id)
    pid = dest['id']
    variant = await row(db, 'schedule_variants', project_id=pid, name='Master', is_master=True)
    period = await row(db, 'schedule_periods', schedule_variant_id=variant['id'], period_label='Live')
    child = await row(db, 'activities', project_id=pid, schedule_variant_id=variant['id'], schedule_period_id=period['id'],
                      task_name='Updated on copy', code='T-4', duration_hours=Decimal('30'),
                      animation_profile_id=populated['activity']['animation_profile_id'])
    await db.commit()
    url, body = f'/api/v1/projects/{pid}/restore-3d', {'source_project_id': str(project.id)}
    # A missing blob rolls back metadata and discards independently staged bytes.
    key = 'model3d/fort.ifc.gz'
    copy_storage.delete_object(key)
    assert (await client.post(url, json=body)).status_code == 502
    assert not (await svc.read_records(db, pid, ['site_assets']))['site_assets']
    assert not [p for p in copy_storage.root.rglob('*') if p.is_file() and p.relative_to(copy_storage.root).as_posix() not in copy_fixture]
    copy_storage.upload_bytes(key, copy_fixture[key])
    # The test client shares one ORM session across requests. Production auth
    # loads a fresh user after the previous request rolls back.
    await db.refresh(user)
    restored = await client.post(url, json=body)
    assert restored.status_code == 200, restored.text
    assert restored.json() == {'models': 1, 'site_objects': 1, 'links': 2}
    result = (await svc.capture(db, pid))['records']
    a, = result['activities']
    assert a['id'] == str(child['id']) and a['task_name'] == 'Updated on copy' and Decimal(a['duration_hours']) == 30
    assert a['animation_profile_id'] == result['animation_profiles'][0]['id']
    assert result['equipment_rigs'][0]['definition']['lift_activity'] == a['id']
    assert {link['activity_id'] for link in result['model_element_links']} == {a['id']}
    assert (await client.post(url, json=body)).status_code == 409


async def test_restore_rejects_foreign_projects_and_unmatched_activities(client, db, project, user, other_user, copy_fixture):
    other = await row(db, 'projects', name='Private', org_id=user.org_id, created_by=other_user.id)
    blank = await row(db, 'projects', name='Blank', org_id=user.org_id, created_by=user.id)
    await db.commit()
    for src, dst, status in [(project.id, blank['id'], 409), (other['id'], blank['id'], 404),
                             (project.id, other['id'], 404), (project.id, project.id, 422)]:
        res = await client.post(f'/api/v1/projects/{dst}/restore-3d', json={'source_project_id': str(src)})
        assert res.status_code == status
    assert not (await svc.read_records(db, blank['id'], ['model3d_files']))['model3d_files']
