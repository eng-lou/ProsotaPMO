"""Revision storage and isolated processing. Source blobs remain immutable."""
from __future__ import annotations
import gzip
import json
import tempfile
from pathlib import Path
from fastapi import HTTPException
from app.services import object_storage, ifc_revision_worker
from app.services.ifc_worker_runtime import run_worker

MAX_BYTES = 128 * 1024 * 1024

def unpack(key, destination):
    if object_storage.head_object_size(key) > MAX_BYTES:
        raise HTTPException(413, 'IFC revision exceeds the 128 MB processing limit.')
    stored = destination.with_suffix('.stored')
    object_storage.download_to_path(key, stored)
    with stored.open('rb') as stream: compressed = stream.read(2) == b'\x1f\x8b'
    with (gzip.open if compressed else open)(stored, 'rb') as source, destination.open('wb') as target:
        total = 0
        while chunk := source.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_BYTES: raise HTTPException(413, 'Expanded IFC exceeds the 128 MB processing limit.')
            target.write(chunk)

def process(review, mode, **options):
    with tempfile.TemporaryDirectory(prefix='prosota-revision-') as folder:
        root = Path(folder)
        before, after = root / 'before.ifc', root / 'after.ifc'
        unpack(review['baseline_key'], before)
        unpack(review['candidate_key'], after)
        request, output, merged = root / 'request.json', root / 'result.json', root / 'merged.ifc'
        request.write_text(json.dumps(dict(mode=mode, before=str(before), after=str(after), merged=str(merged), **options)), encoding='utf-8')
        run_worker(ifc_revision_worker, request, output, timeout=180)
        result = json.loads(output.read_text(encoding='utf-8'))
        if mode == 'merge':
            packed = root / 'merged.ifc.gz'
            with merged.open('rb') as source, gzip.open(packed, 'wb') as target:
                while chunk := source.read(1024 * 1024): target.write(chunk)
            key = object_storage.generate_storage_key('ifc-revisions', 'approved.ifc.gz')
            object_storage.upload_from_path(key, packed, 'application/gzip')
            result.update(storage_key=key, size_bytes=packed.stat().st_size)
        return result

def public(review):
    return {k: v for k, v in review.items() if not k.endswith('_key')}

def validate_decisions(report, decisions):
    changes = {c['guid']: c for c in report['changes']}
    if set(changes) != set(decisions): raise HTTPException(422, 'Choose Accept or Reject for every changed element.')
    for guid, d in decisions.items():
        if d['action'] == 'reject' and not d['rationale'].strip(): raise HTTPException(422, 'Every rejection needs a rationale.')
        if changes[guid]['kind'] == 'modified' and d['action'] == 'accept' and d['assignments'] not in ('keep', 'remove'):
            raise HTTPException(422, 'Choose whether to keep or remove assignments for each modified element.')
