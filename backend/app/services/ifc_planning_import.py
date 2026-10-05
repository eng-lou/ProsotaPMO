from __future__ import annotations
import gzip
import json
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from datetime import date, datetime, time
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from app.services import object_storage
from app.services.ifc_conversion import MAX_SOURCE_BYTES
from app.models.activity import Activity
from app.models.activity_relationship import ActivityRelationship
from app.models.calendar import Calendar, CalendarBreak, CalendarException
from app.models.resource import Resource
from app.models.resource_assignment import ResourceAssignment
from app.models.cost_element import CostElement
from app.models.model_element_link import ModelElementLink
from app.models.schedule_period import SchedulePeriod
from app.models.schedule_variant import ScheduleVariant
from app.models.period import Period
from app.services.scheduling_cpm import _find_cycle


def read_snapshot(storage_key):
    if object_storage.head_object_size(storage_key) > MAX_SOURCE_BYTES:
        raise HTTPException(413, 'IFC exceeds the planning import size limit.')
    with tempfile.TemporaryDirectory(prefix='prosota-plan-') as folder:
        root = Path(folder); stored = root/'stored'; source = root/'source.ifc'; result = root/'snapshot.json'
        object_storage.download_to_path(storage_key, stored)
        with stored.open('rb') as stream:
            zipped = stream.read(2) == b'\x1f\x8b'
        with (gzip.open(stored, 'rb') if zipped else stored.open('rb')) as incoming, source.open('wb') as outgoing:
            size = 0
            while chunk := incoming.read(1024*1024):
                size += len(chunk)
                if size > MAX_SOURCE_BYTES:
                    raise HTTPException(413, 'Uncompressed IFC exceeds the planning import size limit.')
                outgoing.write(chunk)
        try:
            subprocess.run([sys.executable, '-m', 'app.services.ifc_planning_snapshot', str(source), str(result)],
                           cwd=Path(__file__).resolve().parents[2], timeout=120, check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise HTTPException(422, 'Could not read a single supported Prosota planning snapshot. Use an integrated IFC exported by Prosota.') from exc
        return json.loads(result.read_text(encoding='utf-8'))


def scalar_fields(model, record):
    """Convert persisted scalar columns only; never accept foreign IDs or locks."""
    values = {}
    for column in model.__table__.columns:
        key = column.name
        if column.primary_key or column.foreign_keys or key in {'created_at','updated_at','qs_signoff_name','qs_signoff_date'} or key not in record:
            continue
        value = record[key]
        if value is None:
            if column.nullable: values[key] = None
            continue
        kind = column.type.python_type
        if kind is bool:
            if str(value).lower() not in {'true','false'}: raise ValueError(f'Invalid boolean: {key}')
            value = str(value).lower() == 'true'
        elif kind in (date, datetime, time): value = kind.fromisoformat(str(value))
        elif kind is Decimal:
            value = Decimal(str(value))
            if not value.is_finite(): raise ValueError(f'Invalid number: {key}')
        else: value = kind(value)
        if isinstance(value, str) and getattr(column.type, 'length', None) and len(value) > column.type.length:
            raise ValueError(f'Value too long: {key}')
        values[key] = value
    return values


def build_rows(snapshot, project_id, period, cost_period_id):
    names = ('activities','resources','calendars')
    maps = {}
    for name in names:
        records = snapshot[name]
        if len(records) > 20000: raise ValueError('Snapshot is too large')
        maps[name] = {r['id']: uuid.uuid4() for r in records}
        if len(maps[name]) != len(records): raise ValueError(f'Duplicate {name} identifiers')
    def ref(name, old, optional=False):
        if old is None and optional: return None
        if old not in maps[name]: raise ValueError(f'Unresolved {name} reference')
        return maps[name][old]
    rows = []
    default = next((r['id'] for r in snapshot['calendars'] if str(r.get('is_project_default')).lower() == 'true'), None)
    for c in snapshot['calendars']:
        values = scalar_fields(Calendar, c); values['is_project_default'] = False
        rows.append(Calendar(id=ref('calendars', c['id']), project_id=project_id, **values))
    for name, model in (('breaks', CalendarBreak), ('exceptions', CalendarException)):
        for r in snapshot[name]: rows.append(model(id=uuid.uuid4(), calendar_id=ref('calendars', r['calendar_id']), **scalar_fields(model, r)))
    codes = set(); parents = {a['id']: a.get('parent_id') for a in snapshot['activities']}
    for a in snapshot['activities']:
        if not a.get('task_name') or not a.get('code') or a['code'] in codes: raise ValueError('Missing or duplicate activity code/name')
        codes.add(a['code'])
        seen = set(); parent = a['id']
        while parent is not None:
            if parent in seen or parent not in parents: raise ValueError('Invalid activity hierarchy')
            seen.add(parent); parent = parents[parent]
        rows.append(Activity(id=ref('activities', a['id']), project_id=project_id, schedule_variant_id=period.schedule_variant_id,
            schedule_period_id=period.id, parent_id=ref('activities', a.get('parent_id'), True),
            calendar_id=ref('calendars', a.get('calendar_id') or default, True), **scalar_fields(Activity, a)))
    for r in snapshot['resources']:
        if r.get('resource_type') not in ('labour','equipment','material','subcontractor','cost','crew'):
            raise ValueError('Unsupported resource type')
        if Decimal(str(r.get('rate', 0))) < 0: raise ValueError('Negative resource rate')
        rows.append(Resource(id=ref('resources', r['id']), project_id=project_id, calendar_id=ref('calendars', r.get('calendar_id'), True), **scalar_fields(Resource, r)))
    for r in snapshot['relationships']:
        if r['relationship_type'] not in ('FS','SS','FF','SF'): raise ValueError('Unsupported relationship')
        rows.append(ActivityRelationship(id=uuid.uuid4(), predecessor_id=ref('activities',r['predecessor_id']), successor_id=ref('activities',r['successor_id']), **scalar_fields(ActivityRelationship,r)))
    edges = [(r.predecessor_id, r.successor_id) for r in rows if isinstance(r, ActivityRelationship)]
    if _find_cycle(edges, set(maps['activities'].values())): raise ValueError('Cyclic activity dependencies')
    for r in snapshot['assignments']:
        rows.append(ResourceAssignment(id=uuid.uuid4(), activity_id=ref('activities',r['activity_id']), resource_id=ref('resources',r['resource_id']), **scalar_fields(ResourceAssignment,r)))
    for r in snapshot['costs']:
        values = scalar_fields(CostElement,r); values['source'] = 'manual'
        rows.append(CostElement(id=uuid.uuid4(), project_id=project_id, period_id=cost_period_id,
            linked_activity_id=ref('activities',r.get('linked_activity_id'),True), **values))
    for r in snapshot['links']:
        if r['source_kind'] != 'ifc': continue
        rows.append(ModelElementLink(id=uuid.uuid4(), project_id=project_id, activity_id=ref('activities',r['activity_id']), **scalar_fields(ModelElementLink,r)))
    return rows


async def restore(db, project_id, schedule_period_id, cost_period_id, snapshot):
    # Lock both destination periods: concurrent/repeated imports cannot duplicate.
    period = (await db.execute(select(SchedulePeriod).where(SchedulePeriod.id == schedule_period_id).with_for_update())).scalar_one_or_none()
    costs = (await db.execute(select(Period).where(Period.id == cost_period_id).with_for_update())).scalar_one_or_none()
    variant = await db.get(ScheduleVariant, period.schedule_variant_id) if period else None
    if not variant or variant.project_id != project_id or not costs or costs.project_id != project_id:
        raise HTTPException(404, 'Destination periods not found')
    if period.freeze_status != 'live' or costs.freeze_status != 'live' or period.baseline_locked_flag or costs.baseline_locked_flag:
        raise HTTPException(409, 'Import requires unlocked live periods.')
    existing = (await db.execute(select(Activity.id).where(Activity.schedule_variant_id == variant.id).limit(1))).first()
    existing_costs = (await db.execute(select(CostElement.id).where(CostElement.period_id == costs.id).limit(1))).first()
    if existing or existing_costs:
        raise HTTPException(409, 'Choose an empty schedule variant and cost period, or use a new project. Existing planning data is never overwritten.')
    try:
        rows = build_rows(snapshot, project_id, period, costs.id)
        # Flush by model in dependency order, including self-referencing WBS.
        for model in (Calendar, CalendarBreak, CalendarException):
            db.add_all([r for r in rows if isinstance(r, model)]); await db.flush()
        pending = [r for r in rows if isinstance(r, Activity)]; inserted = set()
        while pending:
            ready = [r for r in pending if r.parent_id is None or r.parent_id in inserted]
            if not ready: raise ValueError('Invalid activity hierarchy')
            db.add_all(ready); await db.flush()
            inserted.update(r.id for r in ready); pending = [r for r in pending if r.id not in inserted]
        for model in (Resource, ActivityRelationship, ResourceAssignment, CostElement, ModelElementLink):
            db.add_all([r for r in rows if isinstance(r, model)]); await db.flush()
        starts = [r.start for r in rows if isinstance(r, Activity) and r.start]
        if starts:
            anchor = min(starts); period.start_date = anchor.date(); period.start_time = anchor.time()
        await db.commit()
    except Exception:
        await db.rollback()
        raise
    return {k: len(snapshot[k]) for k in ('activities','relationships','resources','assignments','costs')}
