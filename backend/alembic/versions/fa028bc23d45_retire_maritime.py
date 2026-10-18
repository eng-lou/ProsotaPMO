"""Retire Maritime and permanently remove its projects and stored uploads.

Revision ID: fa028bc23d45
Revises: f9017ab12c34

Explicitly requested by the product owner. Construction records and shared
storage keys are retained. Upload deletion is idempotent; storage failures abort
the migration so a retry still has the database references needed for cleanup.
"""
from alembic import op
import sqlalchemy as sa

revision = 'fa028bc23d45'
down_revision = 'f9017ab12c34'
branch_labels = None
depends_on = None

UPLOADS = (
    ('model3d_files', 'storage_filename'),
    ('site_captures', 'storage_filename'),
    ('fourd_videos', 'storage_filename'),
    ('environment_maps', 'storage_filename'),
    ('radial_charts', 'icon_storage_filename'),
)


def _upload_keys(connection):
    retired, retained = set(), set()
    for table, column in UPLOADS:
        for key, workspace in connection.execute(sa.text(
            f'SELECT f.{column}, p.workspace FROM {table} f '
            f'JOIN projects p ON p.id=f.project_id WHERE f.{column} IS NOT NULL'
        )):
            (retired if workspace == 'maritime' else retained).add(key)
    for key, workspace in connection.execute(sa.text(
        'SELECT t.storage_filename, p.workspace FROM material_preset_textures t '
        'JOIN material_presets m ON m.id=t.preset_id JOIN projects p ON p.id=m.project_id'
    )):
        (retired if workspace == 'maritime' else retained).add(key)
    for file_id, workspace in connection.execute(sa.text(
        'SELECT f.id, p.workspace FROM model3d_files f JOIN projects p ON p.id=f.project_id'
    )):
        (retired if workspace == 'maritime' else retained).add(f'ifc4-export/v1/{file_id}.ifc.gz')
    return sorted(retired - retained)


def _delete_uploads(keys):
    if not keys:
        return
    from app.core.config import settings
    from app.services.object_storage import _client
    if not all((settings.r2_account_id, settings.r2_access_key_id, settings.r2_secret_access_key)):
        raise RuntimeError('Object-storage credentials are required to purge retired project uploads.')
    client = _client()
    for start in range(0, len(keys), 1000):
        response = client.delete_objects(Bucket=settings.r2_bucket_name, Delete={
            'Objects': [{'Key': key} for key in keys[start:start + 1000]], 'Quiet': True,
        })
        if response.get('Errors'):
            raise RuntimeError('Retired project upload deletion failed; database cleanup was not committed.')


def upgrade():
    connection = op.get_bind()
    # Keep the file inventory stable while deleting it, including concurrent
    # requests served by the previous deployment during this build.
    tables = ['projects', 'material_presets', 'material_preset_textures', *(t for t, _ in UPLOADS)]
    connection.execute(sa.text('LOCK TABLE ' + ', '.join(tables) + ' IN SHARE ROW EXCLUSIVE MODE'))
    project_ids = "SELECT id FROM projects WHERE workspace='maritime'"
    count = connection.scalar(sa.text(f'SELECT count(*) FROM projects WHERE id IN ({project_ids})'))
    if count:
        # A malformed cross-project allocation must not cascade into Construction.
        if connection.scalar(sa.text(
            'SELECT count(*) FROM resource_assignments ra '
            'JOIN resources r ON r.id=ra.resource_id JOIN activities a ON a.id=ra.activity_id '
            f'WHERE r.project_id IN ({project_ids}) AND a.project_id NOT IN ({project_ids})'
        )):
            raise RuntimeError('A retained project references a retired resource; relink it before purging.')
        keys = _upload_keys(connection)
        _delete_uploads(keys)
        records = ' UNION ALL '.join(
            f'SELECT id FROM {table} WHERE project_id IN ({project_ids})'
            for table in ('activities', 'risks', 'cost_elements', 'icd_items')
        )
        connection.execute(sa.text(f'DELETE FROM record_links WHERE source_id IN ({records}) OR target_id IN ({records})'))
        connection.execute(sa.text(f'DELETE FROM reassessments WHERE record_id IN ({records})'))
        # Match full-project deletion: remove RESTRICT allocations before the
        # project cascade removes the activities and resources they connect.
        connection.execute(sa.text(
            f'DELETE FROM resource_assignments WHERE activity_id IN '
            f'(SELECT id FROM activities WHERE project_id IN ({project_ids}))'
        ))
        connection.execute(sa.text(f'DELETE FROM projects WHERE id IN ({project_ids})'))
        print(f'Removed {count} Maritime projects and {len(keys)} exclusive upload/cache keys.')
    op.drop_table('maritime_runs')
    op.drop_table('maritime_workspaces')
    op.drop_constraint('ck_project_workspace', 'projects', type_='check')
    op.drop_column('projects', 'workspace')


def downgrade():
    raise RuntimeError('This retirement permanently deletes project data and cannot be reversed.')
