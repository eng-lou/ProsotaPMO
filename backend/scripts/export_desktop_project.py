"""Bridge older Desktop Preview backups to the native project-folder format.

Run with --backup <trusted .prosota-backup> --project <exact name> --output <new folder>.
Requires local development PostgreSQL and pg_restore (the bundled desktop copy works).
Restores ONLY into a newly created disposable database under a restricted database role.
Never opens, modifies, or requests credentials for the live desktop database.
"""
import argparse
import asyncio
import hashlib
import json
import os
import secrets
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile

import psycopg
from psycopg import sql
from sqlalchemy import select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.models.project import Project
from app.services import project_transfer as transfer


def checked_entry(archive, manifest, name, destination):
    expected = manifest['files'].get(name)
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError(f'Missing backup entry: {name}')
    digest = hashlib.sha256()
    with archive.open(name) as src, destination.open('xb') as dst:
        while chunk := src.read(1024 * 1024):
            digest.update(chunk); dst.write(chunk)
    if digest.hexdigest() != expected:
        raise ValueError(f'Backup checksum failed: {name}')


async def capture_project(url, project_name):
    engine = create_async_engine(url)
    try:
        async with AsyncSession(engine) as db:
            projects = (await db.execute(select(Project))).scalars().all()
            matches = [p for p in projects if p.name.casefold() == project_name.casefold()]
            if len(matches) != 1:
                raise ValueError('Specify one exact project name. Available projects: ' + ', '.join(p.name for p in projects))
            return await transfer.capture(db, matches[0].id)
    finally:
        await engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--project', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pg-restore', type=Path, default=Path(__file__).resolve().parents[2] / 'desktop/runtime/postgres/bin/pg_restore.exe')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Choose a new output folder; existing files are never overwritten.')
    admin_url = make_url(os.environ.get('PROSOTA_TRANSFER_ADMIN_URL', 'postgresql+psycopg://postgres:password@127.0.0.1:5432/postgres'))
    if admin_url.host not in ('127.0.0.1', 'localhost', '::1') or admin_url.database != 'postgres':
        raise ValueError('Use a local development PostgreSQL administrator connection, never a project/cloud database.')
    connection = dict(host=admin_url.host, port=admin_url.port or 5432, user=admin_url.username, password=admin_url.password, dbname='postgres', connect_timeout=5)
    if not args.pg_restore.is_file():
        raise ValueError('Supply --pg-restore with the bundled PostgreSQL pg_restore.exe path.')
    with zipfile.ZipFile(args.backup) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or archive.getinfo('manifest.json').file_size > 16 * 1024**2:
            raise ValueError('Invalid workspace backup')
        manifest = json.loads(archive.read('manifest.json'))
        if manifest.get('format') != 'prosota-desktop-backup' or manifest.get('version') != 1:
            raise ValueError('Select a trusted Prosota desktop workspace backup.')
        if archive.getinfo('database.dump').file_size > 512 * 1024**2:
            raise ValueError('This backup database exceeds the bridge limit.')
        db_name = 'prosota_transfer_' + uuid.uuid4().hex
        role_name = db_name + '_owner'
        role_password = secrets.token_urlsafe(32)
        with tempfile.TemporaryDirectory(prefix='prosota-transfer-') as temp:
            dump = Path(temp) / 'database.dump'
            checked_entry(archive, manifest, 'database.dump', dump)
            with psycopg.connect(**connection, autocommit=True) as admin:
                admin.execute(sql.SQL('CREATE ROLE {} LOGIN PASSWORD {}').format(sql.Identifier(role_name), sql.Literal(role_password)))
                try:
                    admin.execute(sql.SQL('CREATE DATABASE {} OWNER {}').format(sql.Identifier(db_name), sql.Identifier(role_name)))
                    try:
                        env = {**os.environ, 'PGPASSWORD': role_password}
                        result = subprocess.run([str(args.pg_restore), '-h', admin_url.host, '-p', str(connection['port']), '-U', role_name,
                            '-d', db_name, '--no-owner', '--no-acl', '--exit-on-error', str(dump)],
                            env=env, capture_output=True, timeout=300, creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
                        if result.returncode:
                            raise ValueError('The backup could not be read in the disposable database. The source workspace is unchanged.')
                        snapshot = asyncio.run(capture_project(admin_url.set(database=db_name, username=role_name, password=role_password), args.project))
                    finally:
                        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(db_name)))
                finally:
                    admin.execute(sql.SQL('DROP ROLE {}').format(sql.Identifier(role_name)))
            keys = transfer.file_keys(snapshot['records'])
            total = sum(archive.getinfo('files/' + key).file_size for key in keys)
            ancestor = output.parent
            while not ancestor.exists(): ancestor = ancestor.parent
            if shutil.disk_usage(ancestor).free < total + 512 * 1024**2:
                raise ValueError('Not enough space for the project folder. Choose a folder on D:.')
            (output / 'files').mkdir(parents=True, exist_ok=False)
            snapshot['files'] = []
            for i, key in enumerate(keys):
                size = archive.getinfo('files/' + key).file_size
                if size > 5 * 1024**3: raise ValueError('A project file exceeds the 5 GB upload limit.')
                relative = f'files/{i:05d}'
                print(f'Exporting file {i + 1}/{len(keys)}', flush=True)
                checked_entry(archive, manifest, 'files/' + key, output / relative)
                snapshot['files'].append({'key': key, 'path': relative, 'size': size})
            package = transfer.dumps(snapshot)
            if len(package) > transfer.MAX_MANIFEST_BYTES: raise ValueError('Project metadata exceeds the transfer limit.')
            (output / 'project.prosota.json').write_bytes(package)
            print(f"Ready: {output}\n{len(snapshot['records']['activities'])} activities; {len(keys)} files. Import this folder into Stable Web.")


if __name__ == '__main__':
    if sys.platform == 'win32': asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    main()
