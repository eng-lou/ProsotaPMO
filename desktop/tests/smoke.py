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
    equipment = request('/api/v1/equipment-rigs/', 'POST', {
        'project_id': project_id, 'model_ref': 'equipment-test.glb', 'name': 'Single link loader',
        'definition': {'schema_version': 1,
            'controls': [{'id': 'lift', 'name': 'Lift', 'value': 0, 'rest': 0, 'keys': [
                {'date': '2026-01-01T00:00:00Z', 'value': 0, 'interpolation': 'linear'},
                {'date': '2026-01-01T00:00:10Z', 'value': 1, 'interpolation': 'smooth'}]}],
            'joints': [{'id': 'arm', 'name': 'Arm', 'node': '/0:Arm', 'members': ['/1:ArmPin'],
                'parent': None, 'control': 'lift', 'kind': 'hinge', 'pivot': [0,0,0],
                'axis': [1,0,0], 'minimum': 0, 'maximum': 90, 'response': [[0,0],[1,1]]}],
            'motion_details': [{'node': '/3:AccessLadder', 'joint': 'arm', 'threshold': 0.5}],
            'followers': [{'id': 'link', 'name': 'Bucket linkage', 'barrel': '/2:Link', 'piston': '',
                'base_node': '', 'tip_node': '/0:Arm', 'base_point': [0,0,0], 'tip_point': [0,1,0]}]}})
    equipment_rows = request('/api/v1/equipment-rigs/?project_id=' + project_id)
    assert equipment_rows[0]['definition'] == equipment['definition']
    assert equipment_rows[0]['definition']['motion_details'] == [{'node': '/3:AccessLadder', 'joint': 'arm', 'threshold': 0.5}]
    assert equipment_rows[0]['definition']['followers'][0]['piston'] == ''
    print('PASS: packaged backend saves grouped original parts, rigid links and animation keys')
    cycle_definition = equipment['definition']
    cycle_definition['soil'] = dict(enabled=True, show_guide=False, bucket_node='/0:Arm', center=[0,0,0], size=[1,1,1], rotation=[0,0,0],
        opening_direction=[0,.6,.8],
        capacity=.5, dump_angle=105, pour_seconds=1.5, source=[4,5,0], radius=2, height=1, up_axis='z',
        start='2026-01-01T00:00:00Z', end='2026-01-01T00:00:14Z', duration_seconds=14, steps=240, color='#806046',
        cycle=dict(pickup={'lift':0},carry={'lift':.5},tip={'lift':1},approach_seconds=4,lift_seconds=2,travel_seconds=5,tip_seconds=1,start_progress=0,pickup_progress=25,drop_progress=85))
    equipment = request('/api/v1/equipment-rigs/' + equipment['id'], 'PUT', {'version':equipment['version'], 'name':equipment['name'], 'definition':cycle_definition})
    assert request('/api/v1/equipment-rigs/?project_id=' + project_id)[0]['definition']['soil'] == equipment['definition']['soil']
    assert equipment['definition']['soil']['opening_direction'] == [0,.6,.8]
    print('PASS: packaged backend retains the guided cycle poses, soil settings and timing')
    bulk_definition = equipment['definition']
    bulk_definition['followers'].insert(0, dict(id='hose', name='Flexible feed', barrel='/3:Hose', piston='',
        base_node='/2:Link', tip_node='/0:Arm', base_point=[0,0,0], tip_point=[0,1,0],
        flex_curve=[[0,0,0],[.2,.5,0],[0,1,0]]))
    bulk_definition['soil'].update(mode='preloaded', material='rocks', initial_fill=.75,
        outlet=[0,.5,0], dump_angle=28, pour_seconds=5)
    equipment = request('/api/v1/equipment-rigs/' + equipment['id'], 'PUT', {'version':equipment['version'], 'name':equipment['name'], 'definition':bulk_definition})
    persisted = request('/api/v1/equipment-rigs/?project_id=' + project_id)[0]['definition']
    assert persisted['followers'] == equipment['definition']['followers']
    assert persisted['soil']['mode'] == 'preloaded' and persisted['soil']['material'] == 'rocks'
    assert persisted['soil']['initial_fill'] == .75 and persisted['soil']['outlet'] == [0,.5,0]
    print('PASS: packaged backend retains dependent flexible hoses and preloaded aggregate loads')
    removal = request('/api/v1/animation-profiles/', 'POST', {
        'project_id': project_id, 'name': 'Opaque removal', 'config': {
            'transform_kind': 'grow', 'grow_mode': 'remove', 'opacity_from': 1, 'opacity_to': 1}})
    saved_profiles = request('/api/v1/animation-profiles/?project_id=' + project_id)
    assert next(p for p in saved_profiles if p['id'] == removal['id'])['config']['grow_mode'] == 'remove'
    print('PASS: packaged backend preserves explicit removal profile mode')
    import uuid
    site_path = request('/api/v1/paths/', 'POST', {'project_id': project_id, 'name': 'Site fence path', 'curve_mode': 'straight',
        'points': [{'x': 0, 'y': 0, 'z': 0}, {'x': 12, 'y': 0, 'z': 0}]})
    site_item = dict(id=str(uuid.uuid4()), name='Boundary fence', kind='fence', up_axis='z',
        position={'x':0,'y':0,'z':0}, path_id=site_path['id'], points=site_path['points'], gate_start=4, gate_width=2)
    site_item['path_motion'] = dict(path_id=site_path['id'],start='2026-01-01T00:00:00Z',speed=1,loop=False,orient=True,heading=0,animation_reference_speed=1,
        progress_keys=[dict(date=f'2026-01-01T00:00:{second:02d}Z',progress=progress,interpolation='linear') for second,progress in [(0,0),(4,25),(6,25),(11,85),(14,85)]])
    scene_url = f'/api/v1/site-scenes/{project_id}'
    preview = request(scene_url + '/preview', 'POST', site_item)
    assert preview['layout']['panel_count'] == 5
    assert request(scene_url)['items'] == []  # preview has no side effects
    recipe = {k:v for k,v in preview.items() if k != 'layout'}
    recipe['section_boxes'] = [dict(id=str(uuid.uuid4()), name='Site section', active=True, visible=False,
        min_x=-1, min_y=0, min_z=0, max_x=1, max_y=2, max_z=4, rot_x=0, rot_y=0, rot_z=0)]
    command = dict(command_id=str(uuid.uuid4()), expected_revision=0, items=[recipe])
    scene = request(scene_url, 'PUT', command)
    assert scene['revision'] == 1 and scene['items'][0]['layout']['panel_count'] == 5
    assert request(scene_url)['items'][0]['section_boxes'] == recipe['section_boxes']
    collection = request('/api/v1/collections/', 'POST', dict(project_id=project_id, name='Site works'))
    members = dict(collection_id=collection['id'], members=[dict(source_kind='mesh',
        element_ref='site:'+recipe['id'], element_label=recipe['name'])])
    assert len(request('/api/v1/collection-members/bulk', 'POST', members)['created']) == 1
    assert request('/api/v1/collection-members/bulk', 'POST', members)['skipped_duplicates'] == 1
    saved_collection = next(c for c in request('/api/v1/collections/?project_id='+project_id) if c['id'] == collection['id'])
    assert saved_collection['members'][0]['element_ref'] == 'site:'+recipe['id']
    print('PASS: saved site section box, collection membership and duplicate prevention')
    assert request(scene_url)['items'][0]['path_motion']['progress_keys'] == site_item['path_motion']['progress_keys']
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
    direct = request(f"/api/v1/site-assets/{asset['id']}/download?direct=true")
    assert isinstance(direct, dict) and isinstance(direct.get('download_url'), str), 'Packaged backend must support the signed-URL JSON contract'
    assert request(direct['download_url']) == asset_bytes
    if '--worker-motion' in sys.argv:
        motion_config = data / 'motion-test.json'
        motion_config.write_text(json.dumps({'origin': origin, 'token': token, 'projectId': project_id, 'folder': 'D:/BIM Assets/Prosota Assets/Construction Workers/Worker F-0014'}))
        motion = subprocess.run([str(desktop / 'node_modules/electron/dist/electron.exe'), str(desktop / 'tests/site-motion.cjs'), str(motion_config)],
            text=True, capture_output=True, timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
        print(motion.stdout, flush=True)
        assert motion.returncode == 0, motion.stderr
        assert 'PASS packaged renderer motion workflow' in motion.stdout, motion.stderr or 'Renderer test exited without completing'
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
    mixed_points = [{"x":0,"y":0,"z":2},
        {"x":10,"y":10,"z":2,"segment_mode":"curved","segment_controls":[{"x":4,"y":0,"z":0},{"x":0,"y":-4,"z":0}]},
        {"x":20,"y":10,"z":2,"segment_mode":"straight"}]
    mixed_path = request('/api/v1/paths/', 'POST', {'project_id':project_id,'name':'Mixed route','points':mixed_points})
    mixed_fence = request(scene_url + '/preview', 'POST', {**recipe, 'path_id':mixed_path['id'],
        'points':mixed_points, 'closed':False, 'curve_mode':'curved', 'gate_start':0, 'gate_width':0})
    assert mixed_fence['layout']['panel_count'] > 0
    assert mixed_fence['points'] == mixed_points
    # Timed worker actions and attachments must survive the packaged storage path.
    previous_scene = request(scene_url)
    worker = {**saved_asset, 'id':str(uuid.uuid4()), 'name':'Timed worker', 'path_motion':None,
        'motion_actions':[dict(id=str(uuid.uuid4()), name='Work', start='2026-10-29T00:00:02Z',
            end='2026-10-29T00:00:07Z', clip=2, speed=1, loop=True, blend=.2)]}
    hand_tool = {**saved_asset, 'id':str(uuid.uuid4()), 'name':'Hand tool', 'path_motion':None,
        'attachment':dict(parent_id=worker['id'], node='CC_Base_R_Hand', start='2026-10-29T00:00:02Z',
            end='2026-10-29T00:00:07Z', position=dict(x=.1,y=0,z=0), rotation=dict(x=0,y=90,z=0), only_during=True)}
    previous_items = [{k:v for k,v in row.items() if k != 'layout'} for row in previous_scene['items']]
    saved_workers = request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()),
        expected_revision=previous_scene['revision'], items=[*previous_items,worker,hand_tool]))
    reopened_workers = request(scene_url)
    restored_worker = next(row for row in reopened_workers['items'] if row['id']==worker['id'])
    restored_tool = next(row for row in reopened_workers['items'] if row['id']==hand_tool['id'])
    assert restored_worker['motion_actions'][0]['clip'] == 2
    assert restored_worker['motion_actions'][0]['blend'] == .2
    assert restored_tool['attachment']['parent_id'] == worker['id']
    assert restored_tool['attachment']['position']['x'] == .1
    assert restored_tool['attachment']['rotation']['y'] == 90
    rejected(dict(command_id=str(uuid.uuid4()),expected_revision=saved_workers['revision'],
        items=[*previous_items,hand_tool]), status=422)
    request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()),
        expected_revision=saved_workers['revision'], items=previous_items))
    print('PASS: packaged worker actions and hand attachments persist; missing parent rejected')
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
    # A site's dimensions must not be mistaken for a geometry-complexity limit.
    large_dimensions = dict(width=2500.25, depth=3500.5, height=750.75)
    large_upload = request('/api/v1/site-assets/', 'POST', dict(
        project_id=other_project['id'], name='Large site.glb', category='Other'))
    request(large_upload['upload_url'], 'PUT', asset_bytes, content_type='model/gltf-binary')
    large_asset = request(f"/api/v1/site-assets/{large_upload['id']}/ready", 'POST', large_dimensions)
    assert large_asset['dimensions'] == large_dimensions
    large_scene_url = f"/api/v1/site-scenes/{other_project['id']}"
    large_item = dict(id=str(uuid.uuid4()), name='Large site', kind='asset', asset_id=large_asset['id'],
        up_axis='z', position=dict(x=0,y=0,z=0), **large_dimensions)
    request(large_scene_url+'/preview', 'POST', large_item)
    request(large_scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=0, items=[large_item]))
    large_saved = request(large_scene_url)['items'][0]
    assert {axis:large_saved[axis] for axis in large_dimensions} == large_dimensions
    print('PASS: large asset import, placement and reload retain original dimensions')
    # Keep the packaged API's object count independent of the import UI. Use the
    # real data-centre split when available, otherwise an equivalent large recipe.
    assembly_fixture = repo / 'outputs/data-centre-import/independent-parts.json'
    if assembly_fixture.exists():
        assembly_parts = json.loads(assembly_fixture.read_text(encoding='utf-8'))
    else:
        assembly_parts = [dict(id=str(uuid.uuid4()), name=f'Construction part {i}',
            kind='asset', up_axis='z', position=dict(x=i%60,y=i//60,z=0),
            asset_part=dict(path=[0,i],transform=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),
            rig_disabled=True) for i in range(3447)]
    assert len(assembly_parts) == 3447
    for part in assembly_parts:
        part['asset_id'] = large_asset['id']
    request(large_scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=1, items=assembly_parts))
    assembly_saved = request(large_scene_url)['items']
    assert len(assembly_saved) == 3447 and len({part['id'] for part in assembly_saved}) == 3447
    for original, saved in zip(assembly_parts, assembly_saved):
        assert saved['asset_part'] == original['asset_part'] and saved['position'] == original['position']
    assembly_schedule = request(f"/api/v1/schedule-variants/context?project_id={other_project['id']}")
    scheduled_parts = [assembly_parts[i] for i in (0,1723,3446)]
    assembly_generated = request('/api/v1/schedule-bulk-generate/', 'POST', dict(
        project_id=other_project['id'], schedule_period_id=assembly_schedule['period']['id'],
        activities=[dict(temp_id=p['id'],task_name=p['name'],duration_hours=1,
            source_kind='site',element_refs=[p['id']]) for p in scheduled_parts],
        site_animation_profile=dict(transform_kind='fall',axis='z',direction=1,color_from=None)))
    assert assembly_generated['model_element_link_count'] == 3
    print('PASS: 3,447 independent parts save/reload and generate individual schedule links')
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
    # Exercise the frozen open-map service import without an external network call.
    try:
        request('/api/v1/site-context/open-map', 'POST', {'project_id':project_id,'lat':0,'lon':180,'width':100,'depth':100})
        raise AssertionError('Date-line map request accepted')
    except urllib.error.HTTPError as exc:
        assert exc.code == 422
    context_recipe = {'source_date':'2026-10-26','lat':53.33,'lon':-6.34,'width':100,'depth':100,'features':[
        {'id':'way/1/0','name':'Editable warehouse','kind':'building','height':12,'height_basis':'user',
         'points':[[-10,-10],[10,-10],[10,10],[-10,10]],'roof':'industrial',
         'surfaces':{'wall:0:1':{'finish':'brick','color':'#934b32'},'material:0':{'finish':'original','color':'#aaccbb'}},
         'replacement':{'asset_id':asset['id'],'width':4,'depth':5,'height':12,'anchor':[0,0,.14]}}]}
    context_item = request(scene_url+'/preview','POST',{'id':str(uuid.uuid4()),'kind':'geographic','name':'Open context','up_axis':'z','position':{'x':0,'y':0,'z':0},'geographic':context_recipe})
    current_scene = request(scene_url)
    part_item = dict(id=str(uuid.uuid4()),name='Independent GLB part',kind='asset',asset_id=asset['id'],up_axis='z',position=dict(x=1,y=2,z=0),asset_part=dict(path=[0,0],transform=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]),assembly_id=str(uuid.uuid4()),assembly_name='Construction kit',rig_disabled=True)
    context_items = [{k:v for k,v in item.items() if k!='layout'} for item in [*current_scene['items'],part_item,context_item]]
    request(scene_url,'PUT',{'command_id':str(uuid.uuid4()),'expected_revision':current_scene['revision'],'items':context_items})
    part_schedule=request('/api/v1/schedule-bulk-generate/','POST',dict(project_id=project_id,schedule_period_id=schedule['period']['id'],activities=[dict(temp_id='part',task_name='Install independent GLB part',duration_hours=1,source_kind='site',element_refs=[part_item['id']])],site_animation_profile=dict(transform_kind='fall',axis='z',direction=1,color_from=None)))
    assert part_schedule['model_element_link_count']==1
    print('PASS: packaged 3D parts retain selectors and generate schedule activity/profile links')
    isolation_planes = [[1,0,0,10],[-1,0,0,10],[0,1,0,10],[0,-1,0,10],[0,0,1,10],[0,0,-1,10]]
    request('/api/v1/site-context/','PUT',{'project_id':project_id,'view_isolation':isolation_planes,'cutout_mode':'isolate'})
    assert request('/context/tree-small.glb')[:4] == b'glTF'
    simulation = request('/api/v1/simulations/', 'POST', dict(project_id=project_id,schedule_period_id=schedule['period']['id'],name='Packaged operation',config=dict(activity_ids=[activity['id']],start='2026-10-28T08:00:00',horizon_days=10,steps=[dict(id='work',name='Work',activity_id=activity['id'],hours=2)])))
    simulation = request('/api/v1/simulations/'+simulation['id']+'/run','POST',dict(revision=simulation['revision']))
    assert simulation['result']['steps'][0]['status']=='complete'
    assert request('/api/v1/simulations/activity/'+activity['id'])['scenario_id']==simulation['id']
    print('PASS: packaged Simulator endpoint calculates and persists an isolated method')
    # Frozen schema/solver/persistence check. Actual clips and grip playback are
    # exercised separately by worker-method-review.cjs with the real models.
    worker_id, tool_id = str(uuid.uuid4()), str(uuid.uuid4())
    current_scene = request(scene_url)
    method_items = [dict(id=i, name=n, kind='asset', asset_id=asset['id'], up_axis='z',
                         position=dict(x=0, y=0, z=0))
                    for i,n in [(worker_id,'Method worker'),(tool_id,'Method tool')]]
    method_scene_items = [{k: v for k, v in item.items() if k != 'layout'}
                          for item in [*current_scene['items'][:-1], *method_items, current_scene['items'][-1]]]
    request(scene_url, 'PUT', dict(command_id=str(uuid.uuid4()), expected_revision=current_scene['revision'],
                                  items=method_scene_items))
    method_points = [dict(x=0,y=0,z=0),dict(x=12,y=0,z=0)]
    method_route = request('/api/v1/paths/', 'POST', dict(project_id=project_id,name='Method route',
                                                       points=method_points,closed=False,curve_mode='straight'))
    visual_method = dict(version=1,kind='walk_work_continue',worker_id=worker_id,tool_id=tool_id,
                         worker_asset_id=asset['id'],tool_asset_id=asset['id'],route_id=method_route['id'],
                         route=dict(id=method_route['id'],geometry=dict(points=method_points,closed=False,curve_mode='straight'),
                                    samples=[[0,0,0],[12,0,0]],length_m=12),
                         idle_clip='Idle',walk_clip='Walk',work_clip='Drill',hand='CC_Base_R_Hand',
                         work_seconds=10,speed_mps=1.2,work_position=50,
                         grip=dict(position=[.1,.2,.3],rotation=[0,90,0]))
    visual_simulation = request('/api/v1/simulations/', 'POST', dict(project_id=project_id,
        schedule_period_id=schedule['period']['id'],name='Packaged visual method',config=dict(
            activity_ids=[activity['id']],start='2026-10-28T08:00:00',horizon_days=10,
            steps=[dict(id='visual-work',name='Use tool',activity_id=activity['id'],worker_method=visual_method)])))
    visual_simulation = request('/api/v1/simulations/'+visual_simulation['id']+'/run', 'POST',
                                dict(revision=visual_simulation['revision']))
    assert [e['worker_action']['stage'] for e in visual_simulation['result']['events']] == ['approach','work','continue']
    assert visual_simulation['config']['steps'][0]['worker_method']['grip'] == visual_method['grip']
    print('PASS: packaged visual worker method emits approach/work/continue events and retains grip bindings')
    working_url = f"/api/v1/simulations/working?project_id={project_id}&schedule_period_id={schedule['period']['id']}"
    assert request(working_url) is None
    working_sequence = request('/api/v1/simulations/'+visual_simulation['id']+'/promote', 'POST',
                               dict(revision=visual_simulation['revision'], working_revision=0))
    assert working_sequence['revision'] == 1 and working_sequence['status'] == 'current'
    assert working_sequence['scenario']['timing']['mode'] == 'parent_activity'
    assert request(working_url)['scenario'] == working_sequence['scenario']
    print('PASS: packaged working sequence fits the parent activity and persists independently')
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
    assert request(scene_url)['items'][-1]['geographic']['features'][0]['height'] == 12
    restored_part=next(i for i in request(scene_url)['items'] if i['id']==part_item['id'])
    assert restored_part['asset_part']['path']==[0,0] and restored_part['rig_disabled']
    restored_assembly = request(large_scene_url)['items']
    assert restored_assembly == assembly_saved
    restored_assembly_links = request(f"/api/v1/model-element-links/?project_id={other_project['id']}")
    assert {link['element_ref'] for link in restored_assembly_links} == {part['id'] for part in scheduled_parts}
    assert all(link['source_kind']=='site' and link['animation_profile_id'] for link in restored_assembly_links)
    print('PASS: all 3,447 parts, transforms and independent schedule links survive portable backup/reopen')
    assert any(l['element_ref']==part_item['id'] and l['source_kind']=='site' and l['animation_profile_id'] for l in request(f'/api/v1/model-element-links/?project_id={project_id}'))
    restored_feature = request(scene_url)['items'][-1]['geographic']['features'][0]
    assert restored_feature['surfaces']['wall:0:1']['finish'] == 'brick'
    assert restored_feature['surfaces']['material:0']['color'] == '#aaccbb'
    assert restored_feature['replacement']['asset_id'] == asset['id']
    assert request('/api/v1/site-context/?project_id='+project_id)['view_isolation'] == isolation_planes
    restored_simulation=request('/api/v1/simulations/'+simulation['id'])
    assert restored_simulation['config']==simulation['config'] and restored_simulation['result']==simulation['result']
    restored_visual=request('/api/v1/simulations/'+visual_simulation['id'])
    assert restored_visual['config']==visual_simulation['config'] and restored_visual['result']==visual_simulation['result']
    restored_working = request(working_url)
    assert restored_working['revision'] == 1 and restored_working['status'] == 'current'
    assert restored_working['scenario'] == working_sequence['scenario']
    print('PASS: promoted parent-fitted sequence survives portable backup/reopen')
    print('PASS: visual worker method, route snapshot, grip and events survive portable backup/reopen')
    print('PASS: Simulator method, source snapshot and results survive portable backup/reopen')
    print('PASS: packaged geographic service, editable scene, bundled vegetation and saved isolation survive backup/reopen')
    assert any(l['id']==site_link['id'] and l['animation_profile_id']==profile['id'] for l in request(f'/api/v1/model-element-links/?project_id={project_id}'))
    assert request(f"/api/v1/site-assets/{asset['id']}/download") == asset_bytes
    print('PASS: GLB library import is separate from placement; immutable versions; project validation; asset placement and bytes survive backup/reopen')
    print('PASS: atomic site recipes, gate geometry, preview isolation, locks, source validation, idempotency and backup/reopen')
    routes = request(f"/api/v1/paths/?project_id={project_id}")
    assert next(p for p in routes if p['id']==mixed_path['id'])['points'] == mixed_points
    print('PASS: per-segment curves and straight lines survive portable backup/reopen')
    assert any(p["id"] == path_row["id"] and p["opacity"] == 0.35 and not p["show_in_viewport"]
               and not p["show_in_render"] and len(p["points"]) == 2 for p in routes)
    print("PASS: path display controls persist without altering route points")
    assert any(m["id"] == route["id"] and m["value"] == 17 and len(m["points"]) == 3 for m in measurements)
    assert any(m["id"] == area["id"] and m["value"] == 4 for m in measurements)
    print("PASS: multi-point length and area save/reload in the Windows backend")
    print("PASS: local CRUD, authenticated API, IFC conversion, portable backup/restore with new DB password, model bytes, resource/cost persistence, Maps configuration")
    revision_base = f"/api/v1/model3d-files/{model['id']}"
    initial_version = request(revision_base + '/content-version')
    revised_bytes = fixture.replace(b"'Wall'", b"'Revised wall'").replace(b'#11,3.)', b'#11,4.)')
    revision = request(revision_base + '/revisions', 'POST', {'name': 'wall-revision.ifc'})
    request(revision['upload_url'], 'PUT', gzip.compress(revised_bytes), content_type='application/gzip')
    review_url = revision_base + '/revisions/' + revision['id']
    report = request(review_url + '/compare', 'POST')
    assert len(report['report']['changes']) == 1
    changed = report['report']['changes'][0]
    assert changed['kind'] == 'modified' and 'geometry' in changed['fields']
    preview_mesh = request(review_url + '/geometry/' + changed['guid'])
    assert preview_mesh['before']['faces'] and max(preview_mesh['after']['vertices']) == 4
    request(review_url + '/apply', 'POST', {'decisions': {changed['guid']: {'action': 'accept', 'assignments': 'keep'}}})
    assert request(revision_base + '/content-version') != initial_version
    assert b'Revised wall' in gzip.decompress(request(revision_base + '/download'))
    fresh_conversion = request(revision_base + '/ifc4-export-source', 'POST')
    assert b'Revised wall' in gzip.decompress(request(fresh_conversion['download_url']))
    assert request(revision_base + '/revisions')[-1]['status'] == 'applied'
    print('PASS: packaged IFC revision worker compares, renders, applies, persists review and invalidates converted download')
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

