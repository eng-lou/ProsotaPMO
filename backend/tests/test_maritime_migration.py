"""Exercise the new migration in an isolated schema and roll back all DDL."""
import importlib.util
import os
from pathlib import Path
import uuid

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url


def test_maritime_migration_preserves_existing_projects_and_cascades():
    url=os.environ.get('TEST_DATABASE_URL','postgresql+psycopg://postgres:password@localhost:5432/prosotapmo_test')
    assert (make_url(url).database or '').endswith('_test')
    spec=importlib.util.spec_from_file_location('maritime_revision',Path(__file__).resolve().parents[1]/'alembic/versions/f9017ab12c34_maritime_projects.py')
    revision=importlib.util.module_from_spec(spec);spec.loader.exec_module(revision)
    engine=create_engine(url)
    with engine.connect() as conn:
        transaction=conn.begin()
        try:
            schema='maritime_migration_'+uuid.uuid4().hex
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(text('CREATE TABLE projects (id uuid PRIMARY KEY, name text NOT NULL)'))
            id=uuid.uuid4()
            conn.execute(text('INSERT INTO projects VALUES (:id, :name)'),{'id':id,'name':'Existing construction project'})
            with Operations.context(MigrationContext.configure(conn)):
                revision.upgrade()
            assert conn.execute(text('SELECT workspace FROM projects')).scalar_one()=='construction'
            conn.execute(text("INSERT INTO maritime_workspaces (project_id,version,definition) VALUES (:id,1,'{}')"),{'id':id})
            conn.execute(text("INSERT INTO maritime_runs (id,project_id,version,kind,name,inputs,results) VALUES (:run,:id,1,'operations','Run','{}','{}')"),{'run':uuid.uuid4(),'id':id})
            conn.execute(text('DELETE FROM projects WHERE id=:id'),{'id':id})
            assert conn.execute(text('SELECT count(*) FROM maritime_workspaces')).scalar_one()==0
            assert conn.execute(text('SELECT count(*) FROM maritime_runs')).scalar_one()==0
            with Operations.context(MigrationContext.configure(conn)):
                revision.downgrade()
            assert conn.execute(text("SELECT count(*) FROM information_schema.columns WHERE table_schema=:schema AND table_name='projects' AND column_name='workspace'"),{'schema':schema}).scalar_one()==0
        finally:
            transaction.rollback()
    engine.dispose()
