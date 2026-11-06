"""Large imported sites retain their dimensions through library and scene saving."""
from pathlib import Path
from uuid import uuid4

import pytest
from pydantic import ValidationError

from app.api.site_assets import Dimensions
from app.schemas.geographic_context import FeatureReplacement
from app.schemas.site_scene import SiteItem


LARGE = dict(width=2500.25, depth=3500.5, height=750.75)


async def test_large_asset_import_place_replace_and_reload(client, project, fake_object_storage):
    upload = await client.post('/api/v1/site-assets/', json={
        'project_id': str(project.id), 'name': 'Large site', 'category': 'Other',
    })
    assert upload.status_code == 201, upload.text
    registered = upload.json()
    blob = (Path(__file__).resolve().parents[2] / 'desktop/tests/fixtures/site-cabin.glb').read_bytes()
    key = registered['upload_url'].removeprefix(fake_object_storage.PUT_PREFIX)
    fake_object_storage.objects[key] = blob
    ready = await client.post(f"/api/v1/site-assets/{registered['id']}/ready", json=LARGE)
    assert ready.status_code == 200, ready.text
    assert ready.json()['dimensions'] == LARGE
    inventory = await client.get('/api/v1/site-assets/', params={'project_id': str(project.id)})
    assert inventory.json()[0]['dimensions'] == LARGE
    download = await client.get(f"/api/v1/site-assets/{registered['id']}/download?direct=true")
    assert fake_object_storage.read_url(download.json()['download_url']) == blob

    item = dict(id=str(uuid4()), name='Large site', kind='asset', asset_id=registered['id'],
                up_axis='z', position=dict(x=0, y=0, z=0), **LARGE)
    scene_url = f'/api/v1/site-scenes/{project.id}'
    preview = await client.post(scene_url + '/preview', json=item)
    assert preview.status_code == 200, preview.text
    # Replacements use the same dimension contract, including generated instances.
    path = await client.post('/api/v1/paths/', json=dict(project_id=str(project.id), name='Test route',
                            points=[dict(x=0,y=0,z=0), dict(x=10,y=0,z=0)], curve_mode='straight'))
    assert path.status_code == 201, path.text
    array = dict(id=str(uuid4()), name='Replacements', kind='array', up_axis='z',
                 position=dict(x=0, y=0, z=0), path_id=path.json()['id'], points=path.json()['points'],
                 instance_overrides={'0': dict(asset_id=registered['id'], anchor=[0,0,0], **LARGE)})
    saved = await client.put(scene_url, json=dict(
        command_id=str(uuid4()), expected_revision=0, items=[item, array]))
    assert saved.status_code == 200, saved.text
    reloaded = (await client.get(scene_url)).json()['items']
    assert {axis: reloaded[0][axis] for axis in LARGE} == LARGE
    assert reloaded[0]['scale'] == dict(x=1, y=1, z=1)
    assert {axis: reloaded[1]['instance_overrides']['0'][axis] for axis in LARGE} == LARGE


def test_dimensions_still_require_positive_finite_values():
    constructors = [
        lambda dims: Dimensions(**dims),
        lambda dims: SiteItem(id=uuid4(), name='Site', kind='asset', asset_id=uuid4(),
                             up_axis='z', position=dict(x=0,y=0,z=0), **dims),
        lambda dims: FeatureReplacement(asset_id=uuid4(), anchor=[0,0,0], **dims),
    ]
    for constructor in constructors:
        constructor(LARGE)
        for axis in LARGE:
            for invalid in (0, -1, float('nan'), float('inf'), -float('inf')):
                with pytest.raises(ValidationError):
                    constructor({**LARGE, axis: invalid})
