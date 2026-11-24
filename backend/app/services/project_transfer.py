"""Portable project records. No account, credential, or application-setting tables.

Binary files travel separately, directly to storage; IFC geometry is never converted.
Imports create a new project and remap identifiers, including references inside JSON.
"""
from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
import json
import re
import uuid

from sqlalchemy import Date, DateTime, Time, Numeric, Uuid, and_, bindparam, insert, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

import app.models  # register the complete project schema
from app.models.base import Base

FORMAT = 'prosota-project'
VERSION = 1
MAX_MANIFEST_BYTES = 128 * 1024 * 1024
# Explicit format-v1 allowlist. New modules require a format review, not accidental export.
TABLE_NAMES = '''projects periods schedule_variants schedule_periods activities
activity_code_history activity_relationships activity_steps calendars calendar_breaks
calendar_exceptions risks risk_mitigation_actions risk_probability_criteria risk_impact_criteria
cost_elements cost_variance_criteria cost_rate_lines cost_commitments icd_items icd_criteria
icd_action_items icd_comments reassessments record_links resources resource_assignments
resource_assignment_spreads schedule_baselines schedule_baseline_activities
schedule_baseline_relationships baseline_sets risk_baselines risk_baseline_items
cost_baselines cost_baseline_items icd_baselines icd_baseline_items project_letterheads
gantt_layouts scheduling_quality_criteria scheduling_quality_runs scheduling_filters
scheduling_highlights schedule_subprojects user_defined_field_definitions user_defined_field_values
animation_profiles collections collection_members model_element_links dock_layouts element_keyframes
material_presets material_preset_textures model3d_files fourd_videos section_boxes camera_views
cameras element_transforms paths path_followers zones annotations annotation_media clash_tests
clash_results clash_runs clash_reports element_parents element_splits measurements dashboard_layouts
radial_charts timeline_strips environment_maps site_contexts site_captures progress_variance_tests
progress_variance_results poe_conversations equipment_rigs site_scenes site_assets
simulation_scenarios working_simulation_sequences'''.split()
TABLES = {name: Base.metadata.tables[name] for name in TABLE_NAMES}
FILE_COLUMNS = {'storage_filename', 'storage_key', 'icon_storage_filename'}
UUID_PATTERN = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')
POLY_TYPES = {'activity': 'activities', 'resource': 'resources', 'risk': 'risks',
              'cost_element': 'cost_elements', 'icd_item': 'icd_items',
              'issue': 'icd_items', 'change': 'icd_items', 'decision': 'icd_items'}


def encode(value):
    if isinstance(value, (uuid.UUID, Decimal)):
        return str(value)
    if isinstance(value, (date, datetime, time)):
        return value.isoformat()
    raise TypeError(type(value).__name__)


def dumps(snapshot):
    return json.dumps(snapshot, default=encode, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode('utf-8')


def primary(table):
    return next(iter(table.primary_key.columns)).name


def media_key(row):
    extension = {'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
                 'video/mp4': 'mp4', 'video/webm': 'webm'}[row['content_type']]
    return f"annotation-media/{row['id']}.{extension}"


def file_keys(records):
    keys = set()
    for name, rows in records.items():
        for row in rows:
            for column in FILE_COLUMNS:
                if row.get(column):
                    keys.add(row[column])
            if name == 'annotation_media' and row.get('ready'):
                keys.add(media_key(row))
            if name == 'model3d_files':
                for revision in row.get('ifc_revisions') or []:
                    for field in ('baseline_key', 'candidate_key', 'result_key'):
                        if revision.get(field): keys.add(revision[field])
    return sorted(keys)


async def read_records(db: AsyncSession, project_id: uuid.UUID, names=TABLE_NAMES):
    """Read a project within the caller's transaction; never traverse to another project."""
    scopes = {'projects': TABLES['projects'].c.id == project_id}

    def scope(name, trail=frozenset()):
        if name in scopes:
            return scopes[name]
        if name in trail or name not in TABLES:
            return None
        table = TABLES[name]
        if 'project_id' in table.c:
            result = table.c.project_id == project_id
        else:
            result = None
            for column in table.c:
                for fk in column.foreign_keys:
                    parent = fk.column.table
                    condition = scope(parent.name, trail | {name})
                    if condition is not None:
                        result = column.in_(select(fk.column).where(condition))
                        break
                if result is not None:
                    break
        if result is not None:
            scopes[name] = result
        return result

    records = {}
    for name in names:
        table = TABLES[name]
        if name in ('reassessments', 'record_links'):
            continue
        condition = scope(name)
        if condition is None:
            raise ValueError(f'No project scope for {name}')
        records[name] = [dict(row) for row in (await db.execute(select(table).where(condition))).mappings()]
    # These two tables deliberately have polymorphic references, rather than SQL FKs.
    ids = {n: [r[primary(TABLES[n])] for r in rows] for n, rows in records.items()}
    for name, fields in [('reassessments', [('record_type', 'record_id')]),
                         ('record_links', [('source_type', 'source_id'), ('target_type', 'target_id')])]:
        if name not in names:
            continue
        table = TABLES[name]
        conditions = [or_(*(and_(table.c[kind] == kind_value, table.c[ref].in_(ids[target]))
                            for kind_value, target in POLY_TYPES.items())) for kind, ref in fields]
        records[name] = [dict(r) for r in (await db.execute(select(table).where(and_(*conditions)))).mappings()]
    return records


async def capture(db: AsyncSession, project_id: uuid.UUID):
    records = await read_records(db, project_id)
    # User/org identity belongs to the destination. Never put source account IDs in a package.
    for name, rows in records.items():
        for row in rows:
            for column in TABLES[name].c:
                if any(fk.column.table.name in ('users', 'organisations') for fk in column.foreign_keys):
                    row[column.name] = bool(row.get(column.name))
            if name == 'site_scenes':
                row.pop('history', None)
            if name == 'model3d_files' and row.get('ifc_revisions'):
                row['ifc_revisions'] = [{k: v for k, v in revision.items() if k not in ('reviewer', 'upload_key')}
                                        for revision in row['ifc_revisions']]
    snapshot = json.loads(dumps({'format': FORMAT, 'version': VERSION, 'records': records}))
    validate(snapshot)
    return snapshot


def validate(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get('format') != FORMAT or snapshot.get('version') != VERSION:
        raise ValueError('Select a supported Prosota project folder, not an IFC or desktop workspace backup.')
    if 'appearance' in snapshot and (not isinstance(snapshot['appearance'], dict) or len(dumps(snapshot['appearance'])) > 2 * 1024 * 1024):
        raise ValueError('Invalid or oversized project appearance settings.')
    records = snapshot.get('records')
    if not isinstance(records, dict) or set(records) - TABLES.keys() or len(records.get('projects', [])) != 1:
        raise ValueError('The package must contain exactly one project and supported project records.')
    ids = {}
    total = 0
    for name, rows in records.items():
        if not isinstance(rows, list):
            raise ValueError('Invalid record collection')
        total += len(rows)
        if total > 1_000_000:
            raise ValueError('The project contains too many records for this transfer format.')
        table = TABLES[name]
        pk = primary(table)
        ids[name] = set()
        for row in rows:
            if not isinstance(row, dict) or set(row) - set(table.c.keys()):
                raise ValueError(f'Unsupported fields in {name}; update the receiving app.')
            if name == 'site_scenes' and 'history' in row:
                raise ValueError('Edit history cannot be imported into another project.')
            if not isinstance(row.get(pk), str):
                raise ValueError(f'Invalid identifier in {name}')
            record_id = str(uuid.UUID(row[pk]))
            if record_id != row[pk] or record_id in ids[name]:
                raise ValueError(f'Duplicate or invalid identifier in {name}')
            ids[name].add(record_id)
            for column in table.c:
                if not column.nullable and column.default is None and column.server_default is None and row.get(column.name) is None:
                    raise ValueError(f'Missing {name}.{column.name}')
            if name == 'model3d_files' and row.get('ifc_revisions') is not None:
                if not isinstance(row['ifc_revisions'], list) or not all(isinstance(r, dict) for r in row['ifc_revisions']):
                    raise ValueError('Invalid IFC revision history')
    project_id = records['projects'][0]['id']
    for name, rows in records.items():
        for row in rows:
            if 'project_id' in TABLES[name].c and row.get('project_id') != project_id:
                raise ValueError('The package contains records from another project.')
            for column in TABLES[name].c:
                for fk in column.foreign_keys:
                    parent = fk.column.table.name
                    value = row.get(column.name)
                    if parent in ('users', 'organisations'):
                        if value not in (True, False, None):
                            raise ValueError('Account identities cannot be imported.')
                    elif value is not None and value not in ids.get(parent, set()):
                        raise ValueError(f'Unresolved reference: {name}.{column.name}')
    for name, fields in [('reassessments', [('record_type', 'record_id')]),
                         ('record_links', [('source_type', 'source_id'), ('target_type', 'target_id')])]:
        for row in records.get(name, []):
            for kind, ref in fields:
                if row[ref] not in ids.get(POLY_TYPES.get(row[kind]), set()):
                    raise ValueError(f'Unresolved {name} reference')
    # Reject paths/URLs: a package may only name relative storage objects.
    keys = file_keys(records)
    if len(keys) > 10000:
        raise ValueError('Too many project files')
    for key in keys:
        if not isinstance(key, str) or not key or len(key) > 500 or '\\' in key or ':' in key or key.startswith('/') or any(p in ('', '.', '..') for p in key.split('/')):
            raise ValueError('Invalid project file key')
    return records


def mappings(snapshot, transfer_id: uuid.UUID, user_id: uuid.UUID):
    records = validate(snapshot)
    identifiers = {r[primary(TABLES[name])]: str(uuid.uuid5(user_id, f'{transfer_id}/{r[primary(TABLES[name])]}'))
                   for name, rows in records.items() for r in rows}
    identifiers[records['projects'][0]['id']] = str(transfer_id)
    files = {key: f'project-transfers/{user_id}/{transfer_id}/files/{i:05d}'
             for i, key in enumerate(file_keys(records))}
    # Annotation storage is derived from its record ID rather than a storage column.
    for row in records.get('annotation_media', []):
        if row.get('ready'):
            files[media_key(row)] = media_key({**row, 'id': identifiers[row['id']]})
    return identifiers, files


def rewrite(value, identifiers, files):
    if isinstance(value, dict):
        return {rewrite(k, identifiers, files): rewrite(v, identifiers, files) for k, v in value.items()}
    if isinstance(value, list):
        return [rewrite(v, identifiers, files) for v in value]
    if isinstance(value, str):
        if value in files:
            return files[value]
        return UUID_PATTERN.sub(lambda m: identifiers.get(m[0].lower(), m[0]), value)
    return value


async def restore(db, snapshot, transfer_id, user, name):
    records = validate(snapshot)
    identifiers, files = mappings(snapshot, transfer_id, user.id)
    await insert_records(db, records, identifiers, files, name, import_user=user)
    return transfer_id


async def insert_records(db, records, identifiers, files, name=None, *, import_user=None):
    """Insert JSON-compatible project rows. External FKs are supplied by trusted callers."""
    pending = []
    for table_name, rows in records.items():
        table = TABLES[table_name]
        for source in rows:
            row = rewrite(source, identifiers, files)
            for column in table.c:
                value = row.get(column.name)
                for fk in column.foreign_keys:
                    if import_user is not None and fk.column.table.name in ('users', 'organisations'):
                        value = (import_user.id if fk.column.table.name == 'users' else import_user.org_id) if value or not column.nullable else None
                if value is not None:
                    if isinstance(column.type, Uuid): value = uuid.UUID(str(value))
                    elif isinstance(column.type, DateTime): value = datetime.fromisoformat(value)
                    elif isinstance(column.type, Date): value = date.fromisoformat(value)
                    elif isinstance(column.type, Time): value = time.fromisoformat(value)
                    elif isinstance(column.type, Numeric): value = Decimal(str(value))
                if column.name in row:
                    row[column.name] = value
            if table_name == 'projects': row['name'] = name.strip() or source['name']
            if table_name == 'site_assets':
                row['upload_key'] = f"site-asset-uploads/{row['id']}.glb"
            pending.append((table, row))
    # All nullable FKs are deferred, which breaks self-links and cross-module cycles.
    # Required FKs determine insertion order. No constraint disabling or schedule recalculation.
    deferred = []
    for table, row in pending:
        patch = {}
        for column in table.c:
            if column.foreign_keys and column.nullable and row.get(column.name) is not None:
                patch[column.name] = row[column.name]
                row[column.name] = None
        if patch: deferred.append((table, row[primary(table)], patch))
    inserted = set()
    while pending:
        ready, waiting = [], []
        for table, row in pending:
            dependencies = [(fk.column.table.name, row.get(c.name)) for c in table.c if not c.nullable
                            for fk in c.foreign_keys if fk.column.table.name in records and row.get(c.name) is not None]
            (ready if all(d in inserted for d in dependencies) else waiting).append((table, row))
        if not ready:
            raise ValueError('Project records contain a required-reference cycle.')
        # Group batches to keep cloud imports fast, without row-by-row round trips.
        groups = {}
        for table, row in ready:
            groups.setdefault((table.name, tuple(sorted(row))), []).append(row)
        for (table_name, _), batch in groups.items():
            table = TABLES[table_name]
            for start in range(0, len(batch), 100):
                await db.execute(insert(table), batch[start:start + 100])
            inserted.update((table_name, r[primary(table)]) for r in batch)
        pending = waiting
    updates = {}
    for table, record_id, patch in deferred:
        updates.setdefault((table.name, tuple(sorted(patch))), []).append({'record_pk': record_id, **{'v_' + k: v for k, v in patch.items()}})
    for (table_name, columns), batch in updates.items():
        table = TABLES[table_name]
        statement = update(table).where(table.c[primary(table)] == bindparam('record_pk')).values({k: bindparam('v_' + k) for k in columns})
        for start in range(0, len(batch), 100):
            await db.execute(statement, batch[start:start + 100])
