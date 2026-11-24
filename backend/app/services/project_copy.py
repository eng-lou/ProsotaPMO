"""Duplicate saved projects and recover the 4D workspace of older schedule-only copies."""
import asyncio
from collections import Counter
import json
import logging
from pathlib import PurePosixPath
import uuid

from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.project import Project
from app.services import object_storage, simulation
from app.services.project_transfer import (
    TABLES, UUID_PATTERN, dumps, file_keys, insert_records, media_key, primary, read_records, rewrite,
)

log = logging.getLogger(__name__)
VISUAL_TABLES = """animation_profiles collections collection_members model_element_links
dock_layouts element_keyframes material_presets material_preset_textures model3d_files fourd_videos
section_boxes camera_views cameras element_transforms paths path_followers zones annotations
annotation_media clash_tests clash_results clash_runs clash_reports element_parents element_splits
measurements radial_charts timeline_strips environment_maps site_contexts
site_captures progress_variance_tests progress_variance_results equipment_rigs site_scenes site_assets
simulation_scenarios working_simulation_sequences""".split()

# Fields stable across the old duplicator's fresh UUIDs. Matching by parent scope
# prevents two variants or reporting periods with the same activity code crossing.
MATCH_FIELDS = {
    'schedule_variants': ('name',),
    'schedule_periods': ('schedule_variant_id', 'period_label'),
    'activities': ('schedule_variant_id', 'code'),
    'periods': ('period_label',),
    'icd_items': ('period_id', 'item_type', 'code'),
    'resources': ('resource_type', 'name'),
    'user_defined_field_definitions': ('entity_type', 'name'),
    'calendars': ('name',),
    'calendar_breaks': ('calendar_id', 'label', 'start_time', 'end_time'),
    'calendar_exceptions': ('calendar_id', 'label', 'start_date', 'end_date'),
    'activity_relationships': ('predecessor_id', 'successor_id', 'relationship_type'),
    'resource_assignments': ('activity_id', 'resource_id', 'role'),
    'activity_steps': ('activity_id', 'name', 'sort_order'),
}


async def source_snapshot(db, source_id, current_hashes=None):
    # Files and their assignments can be edited while the UI is open.
    # All tables must describe the same committed version of the project.
    async with AsyncSession(bind=db.bind) as snapshot_db:
        await snapshot_db.connection(execution_options={'isolation_level': 'REPEATABLE READ'})
        records = await read_records(snapshot_db, source_id)
        if current_hashes is not None:
            runs = records['simulation_scenarios'] + records['working_simulation_sequences']
            for period in {r['schedule_period_id'] for r in runs if r['source_hash']}:
                current_hashes[str(period)] = (await simulation.sources(snapshot_db, source_id, period))['hash']
    if not records['projects']:
        raise HTTPException(404, 'Project not found')
    return saved_records(records)


def saved_records(records):
    # Upload sessions and undo commands belong to the source workspace.
    records['site_assets'] = [r for r in records['site_assets'] if r['status'] in ('ready', 'archived')]
    records['annotation_media'] = [r for r in records['annotation_media'] if r['ready']]
    for scene in records['site_scenes']:
        scene.pop('history', None)
    for model in records['model3d_files']:
        if model.get('ifc_revisions'):
            model['ifc_revisions'] = [
                {k: v for k, v in rev.items() if k != 'upload_key'}
                for rev in model['ifc_revisions'] if rev.get('status') != 'uploading'
            ]
    return json.loads(dumps(records))


def new_ids(records):
    return {r[primary(TABLES[name])]: str(uuid.uuid4()) for name, rows in records.items() for r in rows}


def independent_files(records, ids, target_id):
    # Private keys make unloading or replacing a model safe in either project.
    files = {}
    for key in file_keys(records):
        suffix = ''.join(PurePosixPath(key).suffixes)[-20:]
        files[key] = f'project-copies/{target_id}/{uuid.uuid4()}{suffix}'
    for row in records['annotation_media']:
        files[media_key(row)] = media_key({**row, 'id': ids[row['id']]})
    return files


async def copy_files_and_commit(db, files, records):
    attempted = []
    pairs = list(files.items())
    try:
        for start in range(0, len(pairs), 4):
            batch = pairs[start:start + 4]
            attempted.extend(dst for _, dst in batch)
            outcomes = await asyncio.gather(*(run_in_threadpool(object_storage.copy_object, src, dst)
                                              for src, dst in batch), return_exceptions=True)
            for (src, _), outcome in zip(batch, outcomes):
                if isinstance(outcome, BaseException):
                    log.error('Project file copy failed for %s: %s', src, outcome)
                    label = next((r['name'] for rows in records.values() for r in rows
                                  if r.get('name') and src in (r.get('storage_filename'), r.get('storage_key'))), src)
                    raise HTTPException(502, f'Could not copy {label}. Check the file in the original project and retry.')
    except Exception:
        await db.rollback()
        for key in attempted:
            try:
                await run_in_threadpool(object_storage.delete_object, key)
            except Exception:
                log.exception('Could not remove incomplete project copy object %s', key)
        raise
    # Once COMMIT is sent its outcome can be ambiguous on a network failure.
    # Never delete bytes that a committed project may already own.
    await db.commit()


def check_links(records, ids):
    for name, rows in records.items():
        for col in TABLES[name].c:
            if any(fk.column.table.name in TABLES for fk in col.foreign_keys):
                for row in rows:
                    if row.get(col.name) is not None and row[col.name] not in ids:
                        raise HTTPException(409, f'A reference in {name}.{col.name} could not be matched in the destination.')


async def duplicate_project(db, source_id, target_id, name, user):
    current_hashes = {}
    records = await source_snapshot(db, source_id, current_hashes)
    ids = new_ids(records)
    ids[str(source_id)] = str(target_id)
    source = records['projects'][0]
    source['created_by'] = str(user.id)
    source.pop('created_at')
    source.pop('updated_at')
    check_links(records, ids)
    files = independent_files(records, ids, target_id)
    # Simulation freshness includes row IDs, storage keys and timestamps.
    # Rebind only runs that were current at the exact snapshot we copied.
    runs = {n: records.pop(n) for n in ('simulation_scenarios', 'working_simulation_sequences')}
    await insert_records(db, records, ids, files, name)
    for old_period, old_hash in current_hashes.items():
        current = [(n, r) for n, rows in runs.items() for r in rows
                   if r['schedule_period_id'] == old_period and r['source_hash'] == old_hash]
        if current:
            basis = await simulation.sources(db, target_id, uuid.UUID(ids[old_period]))
            for table, run in current:
                run['source_hash'] = basis['hash']
                if table == 'simulation_scenarios':
                    run['source'] = basis['snapshot']
                    if run['result']:
                        run['result']['source_hash'] = basis['hash']
                else:
                    run['snapshot'] = rewrite(run['snapshot'], {}, {old_hash: basis['hash']})
    await insert_records(db, runs, ids, files)
    await copy_files_and_commit(db, files, records)
    return await db.get(Project, target_id)


def match_schedule(source, target):
    ids = {}
    for name, fields in MATCH_FIELDS.items():
        def key(row, mapping):
            return tuple(mapping.get(row[f], row[f]) if f.endswith('_id') else row[f] for f in fields)
        index = {key(r, {}): str(r['id']) for r in target[name]}
        target_counts = Counter(key(r, {}) for r in target[name])
        source_counts = Counter(key(r, ids) for r in source[name])
        for row in source[name]:
            identity = key(row, ids)
            if source_counts[identity] == target_counts[identity] == 1:
                ids[row['id']] = index[identity]
    return ids


async def restore_visuals(db, source_id, target_id, user):
    if target_id == source_id:
        raise HTTPException(422, 'Choose a different source project.')
    target = await db.scalar(select(Project).where(Project.id == target_id, Project.created_by == user.id,
                             Project.org_id == user.org_id).with_for_update())
    if target is None:
        raise HTTPException(404, 'Project not found')
    existing = await read_records(db, target_id, [*VISUAL_TABLES, *MATCH_FIELDS])
    for table in VISUAL_TABLES:
        rows = existing[table]
        if table == 'site_scenes':
            rows = [r for r in rows if r['items'] or r['history'] or r['revision']]
        if rows:
            raise HTTPException(409, 'This project already has saved 4D data. Restore is available for blank copies only.')

    source = await source_snapshot(db, source_id)
    visual = {n: source[n] for n in VISUAL_TABLES}
    if not (visual['model3d_files'] or visual['site_assets'] or visual['site_captures']
            or any(s['items'] for s in visual['site_scenes'])):
        raise HTTPException(409, 'The source project has no saved model or site geometry to restore.')

    # Compare only stable schedule keys. Ambiguous, missing or renamed targets
    # block recovery only when referenced by the visuals being restored.
    target_schedule = json.loads(dumps({n: existing[n] for n in MATCH_FIELDS}))
    schedule_ids = match_schedule(source, target_schedule)
    ids = new_ids(visual)
    # A working sequence uses its period as its PK. It must match an existing period.
    for sequence in visual['working_simulation_sequences']:
        ids.pop(sequence['schedule_period_id'], None)
    ids.update(schedule_ids)
    ids[str(source_id)] = str(target_id)
    references = {m[0].lower() for m in UUID_PATTERN.finditer(dumps(visual).decode())}
    for name, rows in source.items():
        if name in VISUAL_TABLES:
            continue
        for row in rows:
            old = row[primary(TABLES[name])]
            if old in references and old not in ids:
                label = row.get('code') or row.get('name') or row.get('period_label') or old
                raise HTTPException(409, f'Could not uniquely match {name} ({label}) in this copy. Check the source and destination schedule.')
    check_links(visual, ids)
    files = independent_files(visual, ids, target_id)
    if existing['site_scenes'] and visual['site_scenes']:
        scenes = TABLES['site_scenes']
        await db.execute(delete(scenes).where(scenes.c.project_id == target_id, scenes.c.revision == 0))
    await insert_records(db, visual, ids, files)
    # Old duplicates retain the source profile FK. Preserve subsequent user
    # edits and repoint only an assignment still referring to a source profile.
    for profile in visual['animation_profiles']:
        old = uuid.UUID(profile['id'])
        await db.execute(update(Activity).where(Activity.project_id == target_id, Activity.animation_profile_id == old)
                         .values(animation_profile_id=uuid.UUID(ids[str(old)])))
    mapping = target.material_mapping if target.material_mapping is not None else source['projects'][0]['material_mapping']
    if mapping is not None:
        target.material_mapping = rewrite(mapping, ids, files)
    await copy_files_and_commit(db, files, visual)
    return {'models': len(visual['model3d_files']), 'site_objects': sum(len(s['items']) for s in visual['site_scenes']),
            'links': len(visual['model_element_links'])}
