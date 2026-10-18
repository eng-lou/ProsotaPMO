"""Retirement is scoped to Maritime; uploads and Construction are checked separately."""
import importlib.util
import os
from pathlib import Path
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def revision(filename):
    path = Path(__file__).resolve().parents[1] / 'alembic/versions' / filename
    spec = importlib.util.spec_from_file_location(filename, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('mode', ['purge', 'empty', 'storage_failure', 'cross_project'])
def test_retirement_scope_and_failure_safety(monkeypatch, mode):
    url = os.environ.get('TEST_DATABASE_URL', 'postgresql+psycopg://postgres:password@localhost:5432/prosotapmo_test')
    assert (make_url(url).database or '').endswith('_test')
    old = revision('f9017ab12c34_maritime_projects.py')
    retired = revision('fa028bc23d45_retire_maritime.py')
    engine = create_engine(url)
    try:
        with engine.connect() as conn, conn.begin() as transaction:
            schema = 'retirement_' + uuid.uuid4().hex
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(text('CREATE TABLE projects (id uuid PRIMARY KEY, name text NOT NULL)'))
            with Operations.context(MigrationContext.configure(conn)):
                old.upgrade()
            for table in ('activities', 'resources', 'risks', 'cost_elements', 'icd_items', 'material_presets'):
                conn.execute(text(f'CREATE TABLE {table} (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id) ON DELETE CASCADE)'))
            for table, column in retired.UPLOADS:
                conn.execute(text(f'CREATE TABLE {table} (id uuid PRIMARY KEY, project_id uuid REFERENCES projects(id) ON DELETE CASCADE, {column} text)'))
            conn.execute(text('CREATE TABLE material_preset_textures (id uuid PRIMARY KEY, preset_id uuid REFERENCES material_presets(id) ON DELETE CASCADE, storage_filename text)'))
            conn.execute(text('CREATE TABLE resource_assignments (id uuid PRIMARY KEY, activity_id uuid REFERENCES activities(id) ON DELETE CASCADE, resource_id uuid REFERENCES resources(id) ON DELETE RESTRICT)'))
            conn.execute(text('CREATE TABLE record_links (id uuid PRIMARY KEY, source_id uuid, target_id uuid)'))
            conn.execute(text('CREATE TABLE reassessments (id uuid PRIMARY KEY, record_id uuid)'))
            keep, remove, activity, resource, model = (uuid.uuid4() for _ in range(5))
            conn.execute(text("INSERT INTO projects (id,name) VALUES (:id,'Construction')"), {'id': keep})
            conn.execute(text("INSERT INTO model3d_files VALUES (:id,:p,'model3d/construction.ifc')"), {'id': keep, 'p': keep})
            conn.execute(text("INSERT INTO environment_maps VALUES (:id,:p,'environment-maps/shared.hdr')"), {'id': keep, 'p': keep})
            conn.execute(text('INSERT INTO activities VALUES (:id,:id)'), {'id': keep})
            conn.execute(text('INSERT INTO resources VALUES (:id,:id)'), {'id': keep})
            conn.execute(text('INSERT INTO resource_assignments VALUES (:id,:id,:id)'), {'id': keep})
            conn.execute(text('INSERT INTO record_links VALUES (:id,:id,:id)'), {'id': keep})
            conn.execute(text('INSERT INTO reassessments VALUES (:id,:id)'), {'id': keep})
            if mode != 'empty':
                conn.execute(text("INSERT INTO projects VALUES (:id,'Terminal','maritime')"), {'id': remove})
                conn.execute(text('INSERT INTO activities VALUES (:id,:p)'), {'id': activity, 'p': remove})
                conn.execute(text('INSERT INTO resources VALUES (:id,:p)'), {'id': resource, 'p': remove})
                conn.execute(text('INSERT INTO resource_assignments VALUES (:id,:a,:r)'), {'id': remove, 'a': keep if mode == 'cross_project' else activity, 'r': resource})
                conn.execute(text("INSERT INTO model3d_files VALUES (:id,:p,'model3d/retired.ifc')"), {'id': model, 'p': remove})
                conn.execute(text("INSERT INTO environment_maps VALUES (:id,:id,'environment-maps/shared.hdr')"), {'id': remove})
                conn.execute(text('INSERT INTO material_presets VALUES (:id,:id)'), {'id': remove})
                conn.execute(text("INSERT INTO material_preset_textures VALUES (:id,:id,'textures/retired.png')"), {'id': remove})
                conn.execute(text('INSERT INTO record_links VALUES (:id,:a,:a)'), {'id': remove, 'a': activity})
                conn.execute(text('INSERT INTO reassessments VALUES (:id,:a)'), {'id': remove, 'a': activity})
                conn.execute(text("INSERT INTO maritime_workspaces (project_id,version,definition) VALUES (:id,1,'{}')"), {'id': remove})
                conn.execute(text("INSERT INTO maritime_runs (id,project_id,version,kind,name,inputs,results) VALUES (:id,:id,1,'operations','Run','{}','{}')"), {'id': remove})
            deleted = []
            def delete(keys):
                if mode == 'storage_failure':
                    raise RuntimeError('Storage unavailable')
                deleted.extend(keys)
            monkeypatch.setattr(retired, '_delete_uploads', delete)
            with Operations.context(MigrationContext.configure(conn)):
                if mode in ('storage_failure', 'cross_project'):
                    with pytest.raises(RuntimeError):
                        with conn.begin_nested():
                            retired.upgrade()
                    assert conn.scalar(text('SELECT count(*) FROM projects')) == 2
                    assert conn.scalar(text('SELECT count(*) FROM maritime_runs')) == 1
                    assert deleted == []
                else:
                    retired.upgrade()
                    assert conn.execute(text('SELECT id,name FROM projects')).all() == [(keep, 'Construction')]
                    for table in ('activities', 'resources', 'resource_assignments', 'record_links', 'reassessments', 'model3d_files', 'environment_maps'):
                        assert conn.execute(text(f'SELECT id FROM {table}')).scalars().all() == [keep]
                    assert conn.scalar(text("SELECT to_regclass('maritime_runs')")) is None
                    assert conn.scalar(text("SELECT count(*) FROM information_schema.columns WHERE table_schema=:s AND table_name='projects' AND column_name='workspace'"), {'s': schema}) == 0
                    assert set(deleted) == (set() if mode == 'empty' else {
                        'model3d/retired.ifc', 'textures/retired.png', f'ifc4-export/v1/{model}.ifc.gz',
                    })
            transaction.rollback()
    finally:
        engine.dispose()


async def test_retired_api_and_workspace_creation_are_unavailable(client):
    assert (await client.get('/api/v1/maritime/projects/' + str(uuid.uuid4()) + '/workspace')).status_code == 404
    assert (await client.post('/api/v1/maritime/delivery', json={})).status_code == 404
    assert (await client.post('/api/v1/projects/', json={'name': 'Retired', 'workspace': 'maritime'})).status_code == 422
    response = await client.post('/api/v1/projects/', json={'name': 'Construction'})
    assert response.status_code == 201


def test_storage_errors_are_not_silently_ignored(monkeypatch):
    from app.core.config import settings
    from app.services import object_storage
    from unittest.mock import Mock
    retired = revision('fa028bc23d45_retire_maritime.py')
    for field in ('r2_account_id', 'r2_access_key_id', 'r2_secret_access_key'):
        monkeypatch.setattr(settings, field, 'test-only')
    client = Mock()
    client.delete_objects.return_value = {'Errors': [{'Code': 'AccessDenied'}]}
    monkeypatch.setattr(object_storage, '_client', lambda: client)
    with pytest.raises(RuntimeError, match='deletion failed'):
        retired._delete_uploads(['model3d/retired.ifc'])
