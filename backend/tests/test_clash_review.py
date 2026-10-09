import base64
import gzip
import json
from datetime import datetime, timedelta, timezone

from app.main import app
from app.core.auth import get_db_user
from app.models.clash_run import ClashReport
from tests.test_clash_tests import _make_collection, _make_test, _pair


def mesh(key):
    return {"key": key, "meshes": [{"positions": [0, 0, 0, 1, 0, 0, 0, 1, 0], "indices": [0, 1, 2]}]}


async def setup(client, project):
    a = await _make_collection(client, project, "A")
    b = await _make_collection(client, project, "B")
    members = []
    for collection_id, ref in [(a, "a"), (a, "c"), (b, "b"), (b, "d")]:
        response = await client.post('/api/v1/collection-members/', json={"collection_id": collection_id, "source_kind": "ifc", "element_ref": ref, "element_label": ref})
        assert response.status_code == 201, response.text
        members.append(response.json()["id"])
    test = await _make_test(client, project, a, b)
    test["_member_ids"] = members
    return test


def payload(test, pairs=None):
    pairs = [_pair("a", "b"), _pair("c", "d")] if pairs is None else pairs
    keys = {"ifc:" + p[f"element_{side}_ref"] for p in pairs for side in ("a", "b")}
    return {"pairs": pairs, "scope": "all", "timeline_date": None, "expected": 4, "resolved": 4, "excluded": 0,
            "complete": True, "models": ["private-full-model.ifc"], "warnings": [],
            "geometry_z": base64.b64encode(gzip.compress(json.dumps([mesh(k) for k in keys]).encode())).decode(),
            "member_ids": test["_member_ids"], "checked_keys": ["ifc:a", "ifc:b", "ifc:c", "ifc:d"], "test_updated_at": test["updated_at"]}


async def run(client, test, pairs=None):
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=payload(test, pairs))
    assert response.status_code == 201, response.text
    data = response.json()
    data["test"]["_member_ids"] = test["_member_ids"]
    return data


async def test_run_preserves_resolves_and_reopens(client, project):
    test = await setup(client, project)
    first = await run(client, test)
    result = first["test"]["results"][0]
    await client.patch(f"/api/v1/clash-results/{result['id']}", json={"comment": "Review history"})
    second = await run(client, first["test"], [])
    assert all(r["status"] == "resolved" for r in second["test"]["results"])
    third = await run(client, second["test"])
    assert all(r["status"] == "reopened" for r in third["test"]["results"])
    assert next(r for r in third["test"]["results"] if r["id"] == result["id"])["comment"] == "Review history"
    history = (await client.get(f"/api/v1/clash-review/{test['id']}/runs")).json()
    assert len(history) == 3
    assert all("geometry_z" not in r for r in history)
    assert history[-1]["result_count"] == 2
    original = (await client.get(f"/api/v1/clash-review/{test['id']}/runs/{first['run_id']}")).json()
    assert original["results"][0]["status"] == "new"


async def test_incomplete_and_stale_runs_do_not_replace_results(client, project):
    test = await setup(client, project)
    first = await run(client, test)
    request = payload(first["test"], [])
    request.update(complete=False, resolved=2)
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)
    assert response.status_code == 422
    request = payload(test, [])
    assert (await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)).status_code == 409
    listing = (await client.get('/api/v1/clash-tests/', params={"project_id": str(project.id)})).json()
    assert len(listing[0]["results"]) == 2
    assert all(r["status"] == "new" for r in listing[0]["results"])


async def test_share_is_scoped_immutable_and_revocable(client, project):
    test = await setup(client, project)
    first = await run(client, test)
    chosen = first["test"]["results"][0]
    response = await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [chosen["id"]]})
    assert response.status_code == 201, response.text
    share = response.json()
    url = f"/api/v1/public/clash-reports/{share['token']}"
    public = await client.get(url)
    assert public.status_code == 200
    assert public.headers["cache-control"] == "no-store"
    snapshot = public.json()["snapshot"]
    assert len(snapshot["results"]) == 1
    assert "private-full-model" not in json.dumps(snapshot)
    geometry = json.loads(gzip.decompress(base64.b64decode(snapshot["geometry_z"])))
    assert {g["key"] for g in geometry} == {"ifc:" + chosen["element_a_ref"], "ifc:" + chosen["element_b_ref"]}
    await client.patch(f"/api/v1/clash-results/{chosen['id']}", json={"comment": "New private note"})
    assert (await client.get(url)).json()["snapshot"] == snapshot
    assert (await client.post(url + '/comments', json={"name": "Reviewer", "text": "Note", "result_id": chosen["id"]})).status_code == 403
    assert (await client.delete(f"/api/v1/clash-review/{test['id']}/reports/{share['id']}")).status_code == 204
    assert (await client.get(url)).status_code == 404


async def test_external_comments_and_expiry(client, project, db):
    test = await setup(client, project); first = await run(client, test); result = first["test"]["results"][0]
    response = await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [result["id"]], "allow_comments": True})
    share = response.json(); url = f"/api/v1/public/clash-reports/{share['token']}"
    comment = await client.post(url + '/comments', json={"name": "Reviewer", "text": "Please revise", "result_id": result["id"]})
    assert comment.status_code == 201
    assert (await client.get(url)).json()["comments"][0]["text"] == "Please revise"
    import uuid
    report = await db.get(ClashReport, uuid.UUID(share["id"]))
    report.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1); await db.commit()
    assert (await client.get(url)).status_code == 404
    assert (await client.post(url + '/comments', json={"name": "Reviewer", "text": "Note", "result_id": result["id"]})).status_code == 404


async def test_other_user_cannot_share_or_read_private_runs(client, project, other_user):
    test = await setup(client, project); first = await run(client, test)
    previous = app.dependency_overrides[get_db_user]
    app.dependency_overrides[get_db_user] = lambda: other_user
    try:
        assert (await client.get(f"/api/v1/clash-review/{test['id']}/runs")).status_code == 404
        assert (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [first["test"]["results"][0]["id"]]})).status_code == 404
        assert (await client.post(f"/api/v1/clash-review/{test['id']}/run-upload")).status_code == 404
        assert (await client.post(f"/api/v1/clash-review/{test['id']}/uploaded-runs", json={"upload_id": first['run_id']})).status_code == 404
        assert (await client.delete(f"/api/v1/clash-tests/{test['id']}")).status_code == 404
    finally:
        app.dependency_overrides[get_db_user] = previous


async def test_issue_is_linked_and_not_duplicated(client, project, live_period):
    test = await setup(client, project); first = await run(client, test); result = first["test"]["results"][0]
    url = f"/api/v1/clash-review/{test['id']}/results/{result['id']}/issue"
    body = {"period_id": str(live_period.id), "owner": "Coordinator", "due_date": "2026-11-01"}
    response = await client.post(url, json=body)
    assert response.status_code == 201, response.text
    assert (await client.post(url, json=body)).json()["id"] == response.json()["id"]


async def test_email_requires_configuration_and_rejects_header_injection(client, project):
    test = await setup(client, project); first = await run(client, test)
    share = (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [first["test"]["results"][0]["id"]]})).json()
    url = f"/api/v1/clash-review/{test['id']}/reports/{share['id']}/email"
    assert (await client.post(url, json={"token": share["token"], "recipient": "review@example.com\r\nBcc: steal@example.com"})).status_code == 422
    assert (await client.post(url, json={"token": share["token"], "recipient": "review@example.com"})).status_code == 503


async def test_invalid_geometry_rolls_back_run(client, project):
    test = await setup(client, project)
    request = payload(test)
    request.pop("geometry_z")
    request["geometry"] = [mesh("ifc:unselected")]
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)
    assert response.status_code == 422
    listing = (await client.get('/api/v1/clash-tests/', params={"project_id": str(project.id)})).json()
    assert listing[0]["last_run_at"] is None and not listing[0]["results"]


async def test_changed_collection_rejects_run(client, project):
    test = await setup(client, project)
    await client.delete('/api/v1/collection-members/' + test["_member_ids"][0])
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=payload(test))
    assert response.status_code == 409


async def test_visible_scope_does_not_resolve_unchecked_clashes(client, project):
    test = await setup(client, project); first = await run(client, test)
    request = payload(first["test"], [])
    request.update(scope="visible", resolved=2, excluded=2, checked_keys=["ifc:a", "ifc:b"])
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)
    assert response.status_code == 201, response.text
    by_ref = {r["element_a_ref"]: r for r in response.json()["test"]["results"]}
    assert by_ref["a"]["status"] == "resolved"
    assert by_ref["c"]["status"] == "new"


async def test_model_qualified_upgrade_keeps_legacy_reviews(client, project):
    test = await setup(client, project)
    previous = (await client.put(f"/api/v1/clash-tests/{test['id']}/results", json=[_pair("a", "b")])).json()
    previous["_member_ids"] = test["_member_ids"]
    result = previous["results"][0]
    await client.patch(f"/api/v1/clash-results/{result['id']}", json={"status": "approved", "comment": "Accepted with sleeve"})
    qualified = lambda ref: '@model:' + json.dumps(["model.ifc", ref], separators=(",", ":"))
    request = payload(previous, [_pair(qualified("a"), qualified("b"))])
    request["checked_keys"] = ['ifc:' + qualified(ref) for ref in ('a', 'b', 'c', 'd')]
    response = await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)
    assert response.status_code == 201, response.text
    assert len(response.json()["test"]["results"]) == 1
    updated = response.json()["test"]["results"][0]
    assert updated["id"] == result["id"] and updated["status"] == "approved"
    assert updated["comment"] == "Accepted with sleeve" and updated["review_history"]


async def test_review_validation_and_report_viewpoints(client, project):
    test = await setup(client, project); first = await run(client, test); result = first["test"]["results"][0]
    assert (await client.patch(f"/api/v1/clash-results/{result['id']}", json={"status": None})).status_code == 422
    assert (await client.patch(f"/api/v1/clash-tests/{test['id']}", json={"tolerance_mm": -1})).status_code == 422
    pose = {"eye": [1, 2, 3], "target": [0, 0, 0], "up": [0, 1, 0]}
    share = (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [result["id"]], "viewpoints": {result["id"]: pose}})).json()
    snapshot = (await client.get(f"/api/v1/public/clash-reports/{share['token']}")).json()["snapshot"]
    assert snapshot["viewpoints"][result["id"]] == pose
    assert "review_history" not in snapshot["results"][0]


async def test_email_delivery_uses_only_generated_report_link(client, project, monkeypatch):
    import smtplib
    from app.core.config import settings
    sent = []
    class FakeSMTP:
        def __init__(self, *args, **kwargs): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def starttls(self): pass
        def login(self, *args): pass
        def send_message(self, message): sent.append(message)
    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(settings, "smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "smtp_from", "reports@example.com")
    monkeypatch.setattr(settings, "public_app_url", "https://www.prosota.com")
    test = await setup(client, project); first = await run(client, test)
    share = (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={"run_id": first["run_id"], "result_ids": [first["test"]["results"][0]["id"]]})).json()
    response = await client.post(f"/api/v1/clash-review/{test['id']}/reports/{share['id']}/email", json={"token": share["token"], "recipient": "review@example.com"})
    assert response.status_code == 200 and len(sent) == 1
    assert sent[0]["To"] == "review@example.com"
    assert 'https://www.prosota.com/clash-report#' + share["token"] in sent[0].get_content()


def test_clash_migration_upgrade_and_downgrade():
    import importlib.util
    import uuid
    from pathlib import Path
    from sqlalchemy import create_engine, text, inspect
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from tests.conftest import _SYNC_URL
    engine = create_engine(_SYNC_URL)
    schema = "clash_migration_" + uuid.uuid4().hex
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(text(f'CREATE SCHEMA "{schema}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{schema}"'))
            conn.execute(text('CREATE TABLE icd_items (id uuid PRIMARY KEY)'))
            conn.execute(text('CREATE TABLE clash_tests (id uuid PRIMARY KEY)'))
            conn.execute(text('CREATE TABLE clash_results (id uuid PRIMARY KEY, clash_test_id uuid, element_a_source_kind varchar(10), element_a_ref varchar(300), element_b_source_kind varchar(10), element_b_ref varchar(300), CONSTRAINT uq_clash_results_test_pair UNIQUE (clash_test_id, element_a_ref, element_b_ref))'))
            path = Path(__file__).parents[1] / 'alembic/versions/d7b284ec9012_clash_runs_and_reports.py'
            spec = importlib.util.spec_from_file_location('clash_migration', path)
            migration = importlib.util.module_from_spec(spec); spec.loader.exec_module(migration)
            with Operations.context(MigrationContext.configure(conn)):
                migration.upgrade()
                assert {'clash_runs', 'clash_reports'} <= set(inspect(conn).get_table_names(schema=schema))
                assert {'issue_id', 'clash_point', 'review_history', 'element_metadata'} <= {c['name'] for c in inspect(conn).get_columns('clash_results', schema=schema)}
                migration.downgrade()
                assert 'clash_reports' not in inspect(conn).get_table_names(schema=schema)
        finally:
            transaction.rollback()
    engine.dispose()


async def test_large_run_direct_storage_transfer(client, project, monkeypatch):
    import uuid
    from app.services import object_storage, clash_transfer
    test = await setup(client, project)
    request = payload(test)
    # Well over the inline body limit, without changing clash coverage.
    request['warnings'] = ['x' * 3_100_000]
    body = gzip.compress(json.dumps(request).encode())
    saved = {}
    monkeypatch.setattr(object_storage, 'presigned_put_url', lambda key, *a, **kw: 'https://storage.test/' + key)
    monkeypatch.setattr(object_storage, 'head_object_size', lambda key: len(body))
    monkeypatch.setattr(object_storage, 'download_to_path', lambda key, path: path.write_bytes(body))
    monkeypatch.setattr(object_storage, 'delete_object', lambda key: saved.update(deleted=key))
    monkeypatch.setattr(object_storage, 'upload_bytes', lambda key, data, *a: saved.update({key: data}))
    monkeypatch.setattr(object_storage, 'presigned_get_url', lambda key, **kw: 'https://storage.test/' + key)
    upload = (await client.post(f"/api/v1/clash-review/{test['id']}/run-upload")).json()
    assert 'clash-uploads/' in upload['upload_url']
    response = await client.post(f"/api/v1/clash-review/{test['id']}/uploaded-runs", json={'upload_id': upload['upload_id']})
    assert response.status_code == 201, response.text
    assert len(response.json()['test']['results']) == 2
    run_id = response.json()['run_id']
    assert saved['deleted'].endswith(upload['upload_id'] + '.gz')
    detail = (await client.get(f"/api/v1/clash-review/{test['id']}/runs/{run_id}")).json()
    assert 'snapshot_url' in detail
    key = detail['snapshot_url'].removeprefix('https://storage.test/')
    decoded = json.loads(gzip.decompress(saved[key]))
    assert len(decoded['results']) == 2 and decoded['warnings'] == request['warnings']
    # Oversized or corrupt uploads cannot alter an existing run.
    monkeypatch.setattr(object_storage, 'head_object_size', lambda key: clash_transfer.MAX_COMPRESSED + 1)
    rejected = await client.post(f"/api/v1/clash-review/{test['id']}/uploaded-runs", json={'upload_id': str(uuid.uuid4())})
    assert rejected.status_code == 413


def test_clash_transfer_bounded_decompression():
    import pytest
    from fastapi import HTTPException
    from app.services.clash_transfer import unpack
    assert unpack(gzip.compress(b'valid'), 10) == b'valid'
    with pytest.raises(HTTPException):
        unpack(gzip.compress(b'x' * 100), 10)
    with pytest.raises(HTTPException):
        unpack(b'not gzip')


async def test_large_result_listing_accepts_storage_envelope(client, project, monkeypatch):
    from app.services import clash_transfer
    test = await setup(client, project)
    await run(client, test)
    monkeypatch.setattr(clash_transfer, 'response_payload', lambda value, key: {'snapshot_url': 'https://storage.test/results.gz'})
    response = await client.get('/api/v1/clash-tests/', params={'project_id': str(project.id)})
    assert response.status_code == 200
    assert response.json()['snapshot_url'].endswith('results.gz')


async def test_preview_settings_survive_run_and_share(client, project):
    test = await setup(client, project)
    request = payload(test)
    request.update(up_axis='z', background_color='#e2e2e2')
    saved = (await client.post(f"/api/v1/clash-review/{test['id']}/runs", json=request)).json()
    report = (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={'run_id': saved['run_id'], 'result_ids': [saved['test']['results'][0]['id']], 'up_axis': 'y', 'background_color': '#000000'})).json()
    shared = (await client.get('/api/v1/public/clash-reports/' + report['token'])).json()['snapshot']
    assert shared['up_axis'] == 'z' and shared['background_color'] == '#e2e2e2'

async def test_legacy_run_preview_uses_sharing_settings(client, project):
    test = await setup(client, project)
    saved = await run(client, test)
    report = (await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={'run_id': saved['run_id'], 'result_ids': [saved['test']['results'][0]['id']], 'up_axis': 'z', 'background_color': '#eeeeee'})).json()
    shared = (await client.get('/api/v1/public/clash-reports/' + report['token'])).json()['snapshot']
    assert shared['up_axis'] == 'z' and shared['background_color'] == '#eeeeee'


async def test_report_context_is_opt_in_and_never_adds_unselected_results(client, project):
    test = await setup(client, project)
    saved = await run(client, test)
    chosen = saved['test']['results'][0]
    response = await client.post(f"/api/v1/clash-review/{test['id']}/reports", json={'run_id': saved['run_id'], 'result_ids': [chosen['id']], 'include_context': True})
    assert response.status_code == 201, response.text
    snapshot = (await client.get('/api/v1/public/clash-reports/' + response.json()['token'])).json()['snapshot']
    geometry = json.loads(gzip.decompress(base64.b64decode(snapshot['geometry_z'])))
    assert {g['key'] for g in geometry} == {'ifc:a', 'ifc:b', 'ifc:c', 'ifc:d'}
    assert snapshot['context_element_count'] == 2
    assert [r['id'] for r in snapshot['results']] == [chosen['id']]
