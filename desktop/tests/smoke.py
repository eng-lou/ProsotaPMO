"""Uses a disposable private PostgreSQL cluster; never loads backend/.env."""
import json
import gzip
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

desktop = Path(__file__).resolve().parents[1]
repo = desktop.parent
data = desktop / ".test-data" / secrets.token_hex(5)
data.mkdir(parents=True)
token = secrets.token_hex(32)
password = secrets.token_hex(32)
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
origin = f"http://127.0.0.1:{port}"
env = dict(os.environ, PYTHONPATH=str(repo / "backend"))
identity = {"sub": "test|owner", "email": "trial@example.invalid", "is_super_user": False}

def request(path, method="GET", body=None, authenticated=True, content_type="application/json"):
    if isinstance(body, dict):
        body = json.dumps(body).encode()
    headers = {"Content-Type": content_type}
    if authenticated:
        headers["X-Prosota-Desktop"] = token
    req = urllib.request.Request(path if path.startswith("http") else origin + path, data=body, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        raw = res.read()
        return json.loads(raw) if raw and "json" in res.headers.get("content-type", "") else raw

def launch():
    log = (data / "test.log").open("ab")
    executable = desktop / "runtime/backend/prosota-backend.exe"
    command = [str(executable)] if "--packaged" in sys.argv else [sys.executable, str(desktop / "backend/runner.py")]
    process = subprocess.Popen(command, cwd=data, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log,
                               creationflags=subprocess.CREATE_NO_WINDOW)
    process.stdin.write((json.dumps(dict(
        dataDir=str(data), token=token, port=port, origin=origin, dbPassword=password,
        postgresDir=str(desktop / "runtime/postgres") if "--packaged" in sys.argv else "C:/Program Files/PostgreSQL/16",
        uiDir=str(desktop / "dist"), ai={"provider": "off"}, identity=identity,
    )) + "\n").encode())
    process.stdin.flush()
    for _ in range(180):
        if process.poll() is not None:
            raise RuntimeError((data / "test.log").read_text(errors="replace"))
        try:
            request("/health")
            return process
        except (urllib.error.URLError, ConnectionError):
            time.sleep(.5)
    process.stdin.close()
    process.wait(timeout=40)
    raise RuntimeError("Startup timed out")

process = launch()
try:
    try:
        request("/api/v1/projects/", authenticated=False)
        raise AssertionError("Unauthenticated project access allowed")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    assert request("/api/v1/users/me")["status"] == "approved"
    # Exercise the cloud handoff protocol against this disposable database.
    import hashlib, base64
    verifier = secrets.token_urlsafe(32)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    handoff = request("/api/v1/desktop-auth/handoff", "POST", {"challenge": challenge})
    try:
        request("/api/v1/desktop-auth/exchange", "POST", {"code": handoff["code"], "verifier": secrets.token_urlsafe(32)})
        raise AssertionError("Wrong PKCE verifier accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    session = request("/api/v1/desktop-auth/exchange", "POST", {"code": handoff["code"], "verifier": verifier})
    assert request("/api/v1/desktop-auth/session", "POST", {"token": session["token"]})["user"]["sub"] == "desktop|owner"
    import psycopg
    db_port = int((data / "database/postmaster.pid").read_text().splitlines()[3])
    with psycopg.connect(host="127.0.0.1", port=db_port, user="prosota", password=password, dbname="postgres", autocommit=True) as db:
        db.execute("UPDATE users SET status='pending' WHERE auth0_sub='desktop|owner'")
        for endpoint, body in [("session", {"token": session["token"]}), ("handoff", {"challenge": challenge})]:
            try:
                request("/api/v1/desktop-auth/" + endpoint, "POST", body)
                raise AssertionError("Unapproved account admitted")
            except urllib.error.HTTPError as exc:
                assert exc.code == 403
        db.execute("UPDATE users SET status='approved' WHERE auth0_sub='desktop|owner'")
        expired = request("/api/v1/desktop-auth/handoff", "POST", {"challenge": challenge})
        db.execute("UPDATE desktop_sessions SET expires_at=now()-interval '1 minute' WHERE challenge IS NOT NULL")
        try:
            request("/api/v1/desktop-auth/exchange", "POST", {"code": expired["code"], "verifier": verifier})
            raise AssertionError("Expired handoff accepted")
        except urllib.error.HTTPError as exc:
            assert exc.code == 401
    try:
        request("/api/v1/desktop-auth/exchange", "POST", {"code": handoff["code"], "verifier": verifier})
        raise AssertionError("One-time code replay accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    request("/api/v1/desktop-auth/logout", "POST", {"token": session["token"]})
    try:
        request("/api/v1/desktop-auth/session", "POST", {"token": session["token"]})
        raise AssertionError("Revoked session accepted")
    except urllib.error.HTTPError as exc:
        assert exc.code == 401
    request("/desktop-config", "POST", {"provider": "off", "googleMapsKey": "test-maps-key"})
    assert request("/api/v1/site-context/tiles-key")["api_key"] == "test-maps-key"
    request("/desktop-config", "POST", {"provider": "off"})
    assert request("/api/v1/site-context/tiles-key")["api_key"] == ""
    project = request("/api/v1/projects/", "POST", {"name": "Desktop persistence test"})
    assert project["name"] == "Desktop persistence test"
    project_id = project["id"]
    import uuid
    site_path = request('/api/v1/paths/', 'POST', {'project_id': project_id, 'name': 'Site fence path',
        'points': [{'x': 0, 'y': 0, 'z': 0}, {'x': 12, 'y': 0, 'z': 0}]})
    site_item = dict(id=str(uuid.uuid4()), name='Boundary fence', kind='fence', up_axis='z',
        position={'x':0,'y':0,'z':0}, path_id=site_path['id'], points=site_path['points'], gate_start=4, gate_width=2)
    scene_url = f'/api/v1/site-scenes/{project_id}'
    preview = request(scene_url + '/preview', 'POST', site_item)
    assert preview['layout']['panel_count'] == 5
    assert request(scene_url)['items'] == []  # preview has no side effects
    recipe = {k:v for k,v in preview.items() if k != 'layout'}
    command = dict(command_id=str(uuid.uuid4()), expected_revision=0, items=[recipe])
    scene = request(scene_url, 'PUT', command)
    assert scene['revision'] == 1 and scene['items'][0]['layout']['panel_count'] == 5
    assert request(scene_url, 'PUT', command)['revision'] == 1  # retry never duplicates
    def rejected(body, status=409):
        try:
            request(scene_url, 'PUT', body)
            raise AssertionError('Invalid scene operation succeeded')
        except urllib.error.HTTPError as exc:
            assert exc.code == status, (exc.code, exc.read())
    rejected(dict(command_id=str(uuid.uuid4()), expected_revision=0, items=[]))
    scene = request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=1, items=[]))
    scene = request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=2, items=[recipe]))
    assert scene['items'][0]['layout'] == preview['layout']  # undo/redo identity
    locked = {**recipe, 'locked': True}
    request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=3, items=[locked]))
    rejected(dict(command_id=str(uuid.uuid4()), expected_revision=4, items=[]))
    rejected(dict(command_id=str(uuid.uuid4()), expected_revision=4, items=[{**locked, 'height':3}]))
    request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=4, items=[recipe]))
    other_project = request('/api/v1/projects/', 'POST', {'name': 'Cross-project source test'})
    asset_upload = request('/api/v1/site-assets/', 'POST', {'project_id': project_id, 'name': 'Cabin.glb', 'category': 'Cabins'})
    asset_bytes = (desktop / 'tests/fixtures/site-cabin.glb').read_bytes()
    request(asset_upload['upload_url'], 'PUT', asset_bytes, content_type='model/gltf-binary')
    assert request(f'/api/v1/site-assets/?project_id={project_id}') == []
    asset = request(f"/api/v1/site-assets/{asset_upload['id']}/ready", 'POST', {'width':6,'height':2.6,'depth':2.4})
    assert request(scene_url)['revision'] == 5  # library import never places geometry
    assert request(f"/api/v1/site-assets/{asset['id']}/download") == asset_bytes
    request(asset_upload['upload_url'], 'PUT', b'overwritten pending upload', content_type='model/gltf-binary')
    assert request(f"/api/v1/site-assets/{asset['id']}/download") == asset_bytes  # saved version is immutable
    asset_item = {**recipe, 'id':str(uuid.uuid4()), 'kind':'asset', 'asset_id':asset['id'], 'path_id':None, 'points':[], 'width':6,'height':2.6,'depth':2.4}
    asset_preview = request(scene_url+'/preview', 'POST', asset_item)
    try:
        request(f"/api/v1/site-scenes/{other_project['id']}/preview", 'POST', asset_item)
        raise AssertionError('Cross-project library asset accepted')
    except urllib.error.HTTPError as exc:
        assert exc.code == 422
    saved_asset = {k:v for k,v in asset_preview.items() if k!='layout'}
    request(scene_url,'PUT',dict(command_id=str(uuid.uuid4()),expected_revision=5,items=[recipe,saved_asset]))
    try:
        request(f"/api/v1/site-scenes/{other_project['id']}/preview", 'POST', recipe)
        raise AssertionError('Cross-project path accepted')
    except urllib.error.HTTPError as exc:
        assert exc.code == 422
    request(f"/api/v1/paths/{site_path['id']}", 'PATCH', {'points':[{'x':0,'y':0,'z':0},{'x':14,'y':0,'z':0}]})
    rejected(dict(command_id=str(uuid.uuid4()), expected_revision=6, items=[{**recipe, 'height':3},saved_asset]))
    assert request(scene_url)['items'][0]['layout'] == preview['layout']  # source edits preserve committed result
    path_row = request("/api/v1/paths/", "POST", {
        "project_id": project_id, "name": "Hidden driving route",
        "points": [{"x": 0, "y": 0, "z": 0}, {"x": 10, "y": 0, "z": 0}],
    })
    assert path_row["opacity"] == 1 and path_row["show_in_render"] and path_row["show_in_viewport"]
    request(f"/api/v1/paths/{path_row['id']}", "PATCH", {
        "opacity": 0.35, "show_in_viewport": False, "show_in_render": False,
    })
    route_points = [{"x": 0, "y": 0, "z": 0}, {"x": 3, "y": 4, "z": 0}, {"x": 3, "y": 4, "z": 12}]
    route = request("/api/v1/measurements/", "POST", {
        "project_id": project_id, "kind": "length", "points": route_points, "value": 17,
    })
    area = request("/api/v1/measurements/", "POST", {
        "project_id": project_id, "kind": "area", "points": [
            {"x": 0, "y": 0, "z": 0}, {"x": 2, "y": 0, "z": 0},
            {"x": 2, "y": 2, "z": 0}, {"x": 0, "y": 2, "z": 0},
        ], "value": 4,
    })
    assert route["value"] == 17 and len(route["points"]) == 3
    assert area["value"] == 4 and len(area["points"]) == 4
    period = request(f"/api/v1/periods/bootstrap?project_id={project_id}")
    schedule = request(f"/api/v1/schedule-variants/context?project_id={project_id}")
    activity = request("/api/v1/activities/", "POST", {
        "project_id": project_id, "schedule_period_id": schedule["period"]["id"],
        "task_name": "Install test wall", "duration_hours": 16,
    })
    # Site instances reuse the existing activity/profile relationship API.
    profile = request('/api/v1/animation-profiles/', 'POST', {'project_id':project_id,'name':'Install cabin'})
    foreign_profile = request('/api/v1/animation-profiles/', 'POST', {'project_id':other_project['id'],'name':'Other project'})
    link_body = {'activity_id':activity['id'],'source_kind':'site','element_ref':saved_asset['id'],'element_label':'Cabin'}
    site_link = request('/api/v1/model-element-links/', 'POST', link_body)
    assert site_link['animation_profile_id'] is None
    site_link = request(f"/api/v1/model-element-links/{site_link['id']}", 'PATCH', {'animation_profile_id':profile['id']})
    assert site_link['animation_profile_id'] == profile['id']
    for url, method, body in [
        ('/api/v1/model-element-links/', 'POST', {**link_body,'element_ref':str(uuid.uuid4())}),
        (f"/api/v1/model-element-links/{site_link['id']}", 'PATCH', {'animation_profile_id':foreign_profile['id']}),
    ]:
        try:
            request(url,method,body)
            raise AssertionError('Invalid site/profile link accepted')
        except urllib.error.HTTPError as exc:
            assert exc.code == 422
    assert any(l['id']==site_link['id'] for l in request(f'/api/v1/model-element-links/?project_id={project_id}'))
    # IFC linking still works through the same endpoints.
    old_link = request('/api/v1/model-element-links/', 'POST', {**link_body,'source_kind':'ifc','element_ref':'test-wall'})
    request(f"/api/v1/model-element-links/{old_link['id']}", 'DELETE')
    renamed = request(f"/api/v1/site-assets/{asset['id']}", 'PATCH', {'name':'Tagged tree','category':'Trees'})
    assert renamed['name']=='Tagged tree' and renamed['category']=='Trees'
    request(f"/api/v1/site-assets/{asset['id']}", 'DELETE')
    assert request(f'/api/v1/site-assets/?project_id={project_id}') == []
    assert request(f"/api/v1/site-assets/{asset['id']}/download") == asset_bytes
    assert request(scene_url+'/preview','POST',saved_asset)['asset_id'] == asset['id']
    resource = request("/api/v1/resources/", "POST", {
        "project_id": project_id, "resource_type": "labour", "name": "Test crew", "unit": "hour", "rate": 25,
    })
    assignment = request("/api/v1/resource-assignments/", "POST", {
        "activity_id": activity["id"], "resource_id": resource["id"], "utilisation_pct": 100,
    })
    cost = request("/api/v1/cost-elements/", "POST", {
        "project_id": project_id, "period_id": period["id"], "description": "Test preliminaries", "budget": 1000,
    })
    assert assignment["resource_id"] == resource["id"]
    assert float(cost["budget"]) == 1000
    assert b"<html" in request("/scheduling").lower()
    # Exercise the same direct upload protocol used by the IFC viewer.
    presign = request("/api/v1/model3d-files/presign", "POST",
                      {"name": "test.ifc", "content_type": "application/octet-stream"})
    fixture = (desktop / "tests/fixtures/wall.ifc").read_bytes()
    request(presign["upload_url"], "PUT", fixture, content_type="application/octet-stream")
    model = request("/api/v1/model3d-files/", "POST", {
        "project_id": project_id, "name": "test.ifc", "kind": "ifc", "source_up_axis": "z",
        "storage_key": presign["storage_key"],
    })
    assert request(f"/api/v1/model3d-files/{model['id']}/download") == fixture
    conversion = request(f"/api/v1/model3d-files/{model['id']}/ifc4-export-source", "POST")
    assert b"FILE_SCHEMA(('IFC4'))" in gzip.decompress(request(conversion["download_url"]))
    assert any((data / "files").rglob("*.ifc"))
    process.stdin.close()
    process.wait(timeout=40)
    assert process.returncode == 0
    # Portable backup restore into a NEW cluster and password (another PC).
    def maintenance(action, destination, password_value, archive):
        command = [str(desktop / "runtime/backend/prosota-backend.exe")] if "--packaged" in sys.argv else [sys.executable, str(desktop / "backend/runner.py")]
        job = subprocess.run(command, cwd=destination, env=env, input=(json.dumps(dict(
            dataDir=str(destination), dbPassword=password_value, maintenance=action,
            backupPath=str(archive),
            postgresDir=str(desktop / "runtime/postgres") if "--packaged" in sys.argv else "C:/Program Files/PostgreSQL/16",
        )) + "\n").encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
        if job.returncode:
            raise AssertionError(job.stderr.decode(errors="replace"))
    archive = data.parent / (data.name + ".prosota-backup")
    maintenance("backup", data, password, archive)
    original_data = data
    data = data.parent / (data.name + "-restored")
    data.mkdir()
    password = secrets.token_hex(32)
    maintenance("restore", data, password, archive)
    process = launch()
    assert any(p["id"] == project["id"] for p in request("/api/v1/projects/"))
    assert request(f"/api/v1/model3d-files/{model['id']}/download") == fixture
    assert any(a["id"] == activity["id"] for a in request(f"/api/v1/activities/?project_id={project_id}&schedule_period_id={schedule['period']['id']}"))
    assert any(r["id"] == resource["id"] for r in request(f"/api/v1/resources/?project_id={project_id}"))
    assert any(c["id"] == cost["id"] for c in request(f"/api/v1/cost-elements/?project_id={project_id}&period_id={period['id']}"))
    assert request("/api/v1/site-context/tiles-key")["api_key"] == ""
    measurements = request(f"/api/v1/measurements/?project_id={project_id}")
    assert request(scene_url)['items'][0]['layout'] == preview['layout']
    assert request(scene_url)['items'][1]['asset_id'] == asset['id']
    assert any(l['id']==site_link['id'] and l['animation_profile_id']==profile['id'] for l in request(f'/api/v1/model-element-links/?project_id={project_id}'))
    assert request(f"/api/v1/site-assets/{asset['id']}/download") == asset_bytes
    print('PASS: GLB library import is separate from placement; immutable versions; project validation; asset placement and bytes survive backup/reopen')
    print('PASS: atomic site recipes, gate geometry, preview isolation, locks, source validation, idempotency and backup/reopen')
    routes = request(f"/api/v1/paths/?project_id={project_id}")
    assert any(p["id"] == path_row["id"] and p["opacity"] == 0.35 and not p["show_in_viewport"]
               and not p["show_in_render"] and len(p["points"]) == 2 for p in routes)
    print("PASS: path display controls persist without altering route points")
    assert any(m["id"] == route["id"] and m["value"] == 17 and len(m["points"]) == 3 for m in measurements)
    assert any(m["id"] == area["id"] and m["value"] == 4 for m in measurements)
    print("PASS: multi-point length and area save/reload in the Windows backend")
    print("PASS: local CRUD, authenticated API, IFC conversion, portable backup/restore with new DB password, model bytes, resource/cost persistence, Maps configuration")
    def capped(path, body):
        try:
            request(path, "POST", body)
            raise AssertionError("Trial project cap bypassed")
        except urllib.error.HTTPError as error:
            assert error.code == 403
    capped('/api/v1/projects/', {'name': 'Third trial project'})
    capped(f'/api/v1/projects/{project_id}/duplicate', {})
    process.stdin.close()
    process.wait(timeout=40)
    # Existing workspace must heal using the currently deployed identity-only
    # cloud response, without changing its local owner or project IDs.
    identity = {"sub": "test|owner", "email": "sotalouisx@gmail.com"}
    process = launch()
    assert request('/api/v1/users/me')['is_super_user'] is True
    request('/api/v1/projects/', 'POST', {'name': 'Third owner project'})
    request(f'/api/v1/projects/{project_id}/duplicate', 'POST', {})
    process.stdin.close()
    process.wait(timeout=40)
    identity['is_super_user'] = False
    process = launch()
    assert request('/api/v1/users/me')['is_super_user'] is False
    capped('/api/v1/projects/', {'name': 'Role revoked'})
    print('PASS: trial caps enforced; existing owner workspace healed; third project and duplicate allowed; explicit role revocation respected')
finally:
    if process.poll() is None:
        process.stdin.close()
        process.wait(timeout=40)
