"""Opt-in local browser fixture. Run manually; never imported by the application.

Uses only a database ending in _test and replaces object storage with memory.
Stop it before running pytest against the same test database.
"""
import asyncio
import os
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

from fastapi import Request, Response, HTTPException
from sqlalchemy import create_engine, select, delete
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.models.base import Base
from app.models.organisation import Organisation
from app.models.user import User
from app.models.project import Project
from app.models.maritime_workspace import MaritimeWorkspace, MaritimeRun
from app.models.model3d_file import Model3DFile
from app.core.auth import get_db_user, get_current_user, TokenPayload
from app.database import get_db
from app.services import object_storage
import uvicorn

URL = os.environ.get('TEST_DATABASE_URL', 'postgresql+psycopg://postgres:password@localhost:5432/prosotapmo_test')
if not (make_url(URL).database or '').endswith('_test'):
    raise RuntimeError('Browser fixture requires a database ending in _test')
sync = create_engine(URL)
Base.metadata.create_all(sync)
sync.dispose()
engine = create_async_engine(URL)
Session = async_sessionmaker(engine, expire_on_commit=False)
PROJECT_ID = uuid.UUID('00000000-0000-4000-8000-000000000017')
USER = None

async def seed():
    global USER
    async with Session() as db:
        USER = await db.scalar(select(User).where(User.auth0_sub == 'maritime-browser-qa'))
        if USER is None:
            org = Organisation(name='Maritime browser QA'); db.add(org); await db.flush()
            USER = User(org_id=org.id, email='maritime-qa@example.test', auth0_sub='maritime-browser-qa',
                        display_name='Browser QA', role='admin', status='approved', is_super_user=True)
            db.add(USER); await db.flush()
        project = await db.get(Project, PROJECT_ID)
        if project is None:
            db.add(Project(id=PROJECT_ID, org_id=USER.org_id, created_by=USER.id,
                           name='Harbour East QA', workspace='maritime'))
        # Reset this fixture only, without deleting any other test projects.
        for model in (MaritimeRun, MaritimeWorkspace, Model3DFile):
            await db.execute(delete(model).where(model.project_id == PROJECT_ID))
        await db.commit()

asyncio.run(seed())

async def database():
    async with Session() as db:
        yield db
async def user(): return USER
async def token(): return TokenPayload(sub=USER.auth0_sub, email=USER.email)
app.dependency_overrides[get_db] = database
app.dependency_overrides[get_db_user] = user
app.dependency_overrides[get_current_user] = token

blobs = {}
object_storage.presigned_put_url = lambda key, *_args, **_kw: f'http://127.0.0.1:4184/__qa/storage/{key}'
object_storage.presigned_get_url = lambda key, *_args, **_kw: f'http://127.0.0.1:8184/__qa/storage/{key}'
object_storage.head_object_size = lambda key: len(blobs[key])
object_storage.delete_object = lambda key: blobs.pop(key, None)

@app.put('/__qa/storage/{key:path}')
async def put_blob(key: str, request: Request):
    blobs[key] = await request.body()
    return Response(status_code=204)

@app.get('/__qa/storage/{key:path}')
async def get_blob(key: str):
    if key not in blobs:
        raise HTTPException(404)
    return Response(blobs[key], media_type='application/octet-stream')

uvicorn.run(app, host='127.0.0.1', port=8184)
