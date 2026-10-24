"""Run bounded release checks in a fresh, disposable PostgreSQL database."""
import os
import subprocess
import sys
import uuid
import psycopg
from psycopg import sql

name = 'prosota_release_test_' + uuid.uuid4().hex
with psycopg.connect('postgresql://postgres:password@localhost:5432/postgres', autocommit=True) as admin:
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    try:
        env = {**os.environ, 'TEST_DATABASE_URL': 'postgresql+psycopg://postgres:password@localhost:5432/' + name}
        result = subprocess.run([sys.executable, '-m', 'pytest', 'tests/test_deploy_migrations.py',
                                 'tests/test_site_scene_engine.py', 'tests/test_paths.py',
                                 '-q', '--tb=short', '--disable-warnings'], env=env)
    finally:
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
sys.exit(result.returncode)
