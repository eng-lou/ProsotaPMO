"""Authenticated, direct-to-storage project portability for web and desktop."""
import asyncio
import json
import mimetypes
from pathlib import Path
import tempfile
import uuid

from botocore.exceptions import ClientError
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, DataError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_db_user
from app.database import get_db
from app.models.project import Project
from app.models.user import User
from app.services.project import check_project_capacity
from app.services import object_storage as storage, project_transfer as transfer

router = APIRouter(prefix='/project-transfers', tags=['project-transfers'])


def manifest_key(user_id, transfer_id, *, export=False):
    prefix = 'project-exports' if export else 'project-transfers'
    return f'{prefix}/{user_id}/{transfer_id}/project.prosota.json'


def read_manifest(user_id, transfer_id, *, export=False):
    key = manifest_key(user_id, transfer_id, export=export)
    try:
        if storage.head_object_size(key) > transfer.MAX_MANIFEST_BYTES:
            raise ValueError('Project metadata exceeds the 128 MB transfer limit.')
        with tempfile.TemporaryDirectory(prefix='prosota-project-') as folder:
            path = Path(folder) / 'manifest.json'
            storage.download_to_path(key, path)
            if path.stat().st_size > transfer.MAX_MANIFEST_BYTES:
                raise ValueError('Project metadata is too large.')
            snapshot = json.loads(path.read_bytes())
        transfer.validate(snapshot)
        keys = transfer.file_keys(snapshot['records'])
        files = snapshot.get('files')
        if not isinstance(files, list) or len(files) != len(keys):
            raise ValueError('The project file inventory is incomplete.')
        for i, (entry, key) in enumerate(zip(files, keys)):
            if entry.get('key') != key or entry.get('path') != f'files/{i:05d}' or type(entry.get('size')) is not int or not 0 <= entry['size'] <= 5 * 1024**3:
                raise ValueError('Invalid project file inventory.')
        return snapshot
    except (ValueError, KeyError, TypeError, ClientError) as exc:
        raise HTTPException(422, 'The project package is missing, invalid, or unsupported. Export it again from the source workspace.') from exc


@router.post('/export/{project_id}')
async def export_project(project_id: uuid.UUID, db=Depends(get_db), user=Depends(get_db_user)):
    project = await db.get(Project, project_id)
    if not project or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, 'Project not found')
    async with AsyncSession(bind=db.bind) as snapshot_db:
        await snapshot_db.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
        snapshot = await transfer.capture(snapshot_db, project_id)
    snapshot['files'] = []
    # The manifest is only published once every referenced file has been found.
    for i, key in enumerate(transfer.file_keys(snapshot['records'])):
        try:
            size = await run_in_threadpool(storage.head_object_size, key)
        except ClientError as exc:
            raise HTTPException(409, 'A saved project file is missing. Restore it before exporting the project.') from exc
        if size > 5 * 1024**3:
            raise HTTPException(413, 'A project file exceeds the 5 GB direct-upload limit.')
        snapshot['files'].append({'key': key, 'path': f'files/{i:05d}', 'size': size})
    data = transfer.dumps(snapshot)
    if len(data) > transfer.MAX_MANIFEST_BYTES:
        raise HTTPException(413, 'Project metadata exceeds the 128 MB transfer limit.')
    export_id = uuid.uuid4()
    key = manifest_key(user.id, export_id, export=True)
    await run_in_threadpool(storage.upload_bytes, key, data, 'application/json')
    return {'id': export_id, 'manifest_url': storage.presigned_get_url(key), 'name': project.name}


@router.get('/exports/{export_id}/files')
async def export_files(export_id: uuid.UUID, offset: int = Query(0, ge=0), db=Depends(get_db), user=Depends(get_db_user)):
    snapshot = await run_in_threadpool(read_manifest, user.id, export_id, export=True)
    source = snapshot['records']['projects'][0]
    project = await db.get(Project, uuid.UUID(source['id']))
    if not project or project.org_id != user.org_id or project.created_by != user.id:
        raise HTTPException(404, 'Project not found')
    return {'files': [{'path': f['path'], 'download_url': storage.presigned_get_url(f['key'])}
                      for f in snapshot['files'][offset:offset + 50]]}


@router.post('/imports')
async def start_import(db=Depends(get_db), user=Depends(get_db_user)):
    await check_project_capacity(db, user)
    import_id = uuid.uuid4()
    return {'id': import_id, 'upload_url': storage.presigned_put_url(manifest_key(user.id, import_id), 'application/json')}


@router.get('/imports/{import_id}/files')
async def import_files(import_id: uuid.UUID, offset: int = Query(0, ge=0), db=Depends(get_db), user=Depends(get_db_user)):
    if await db.get(Project, import_id):
        raise HTTPException(409, 'This import is already complete. Open the imported project.')
    snapshot = await run_in_threadpool(read_manifest, user.id, import_id)
    _, keys = transfer.mappings(snapshot, import_id, user.id)
    return {'files': [{'path': f['path'], 'size': f['size'],
                       'content_type': mimetypes.guess_type(f['key'])[0] or 'application/octet-stream',
                       'upload_url': storage.presigned_put_url(keys[f['key']], mimetypes.guess_type(f['key'])[0] or 'application/octet-stream')}
                      for f in snapshot['files'][offset:offset + 50]], 'total': len(snapshot['files'])}


class CommitImport(BaseModel):
    name: str = Field(default='', max_length=255)


@router.delete('/imports/{import_id}')
async def discard_import(import_id: uuid.UUID, db=Depends(get_db), user=Depends(get_db_user)):
    # Share the commit lock, so closing a failed transfer can never delete committed files.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    if await db.get(Project, import_id):
        return {'discarded': False}
    snapshot = await run_in_threadpool(read_manifest, user.id, import_id)
    _, keys = transfer.mappings(snapshot, import_id, user.id)
    for key in keys.values():
        await run_in_threadpool(storage.delete_object, key)
    await run_in_threadpool(storage.delete_object, manifest_key(user.id, import_id))
    return {'discarded': True}


@router.post('/imports/{import_id}/commit')
async def commit_import(import_id: uuid.UUID, payload: CommitImport, db=Depends(get_db), user=Depends(get_db_user)):
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())
    existing = await db.get(Project, import_id)
    if existing:
        if existing.org_id != user.org_id or existing.created_by != user.id:
            raise HTTPException(404, 'Import not found')
        snapshot = await run_in_threadpool(read_manifest, user.id, import_id)
        identifiers, files = transfer.mappings(snapshot, import_id, user.id)
        return {'id': existing.id, 'name': existing.name, 'appearance': transfer.rewrite(snapshot.get('appearance'), identifiers, files)}
    await check_project_capacity(db, user)
    snapshot = await run_in_threadpool(read_manifest, user.id, import_id)
    _, keys = transfer.mappings(snapshot, import_id, user.id)
    semaphore = asyncio.Semaphore(8)

    async def verify(entry):
        async with semaphore:
            try:
                size = await run_in_threadpool(storage.head_object_size, keys[entry['key']])
                if size != entry['size']:
                    raise ValueError('File size mismatch')
            except (ClientError, ValueError) as exc:
                raise HTTPException(409, 'Some project files have not finished uploading. Retry the import.') from exc

    await asyncio.gather(*(verify(entry) for entry in snapshot['files']))
    try:
        await transfer.restore(db, snapshot, import_id, user, payload.name)
        await db.commit()
    except (ValueError, KeyError, TypeError, IntegrityError, DataError) as exc:
        await db.rollback()
        raise HTTPException(422, 'Project records could not be restored. No project was created; the source is unchanged.') from exc
    identifiers, files = transfer.mappings(snapshot, import_id, user.id)
    return {'id': import_id, 'name': payload.name.strip() or snapshot['records']['projects'][0]['name'],
            'appearance': transfer.rewrite(snapshot.get('appearance'), identifiers, files)}
