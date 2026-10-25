from app.schemas.animation_profile import AnimationProfileConfig
import pytest

async def test_removal_profile_persists_and_can_be_changed(client, project):
    response = await client.post('/api/v1/animation-profiles/', json={
        'project_id': str(project.id), 'name': 'Remove X', 'config': {
            'transform_kind': 'grow', 'grow_mode': 'remove', 'opacity_from': 1,
            'opacity_to': 1, 'color_from': '#c53522'}})
    assert response.status_code == 201, response.text
    row = response.json()
    rows = (await client.get('/api/v1/animation-profiles/', params={'project_id': str(project.id)})).json()
    saved = next(p for p in rows if p['id'] == row['id'])
    assert saved['config']['grow_mode'] == 'remove'
    config = saved['config'] | {'grow_mode': 'reveal'}
    changed = await client.patch(f"/api/v1/animation-profiles/{row['id']}", json={'name': 'Reveal X', 'config': config})
    assert changed.status_code == 200
    assert changed.json()['config']['grow_mode'] == 'reveal'

def test_legacy_configs_default_to_unchanged_behaviour():
    assert AnimationProfileConfig(transform_kind='grow').grow_mode is None
    assert AnimationProfileConfig.model_validate_json(AnimationProfileConfig(grow_mode='remove').model_dump_json()).grow_mode == 'remove'
    with pytest.raises(ValueError):
        AnimationProfileConfig(grow_mode='invalid')
