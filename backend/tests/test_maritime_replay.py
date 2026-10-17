import uuid
import pytest
from pydantic import ValidationError
from app.schemas.maritime_workspace import WorkspaceDefinition
from app.services.maritime_operations import simulate, compare
from app.services.maritime_replay import ReplayRecorder
from tests.test_maritime_workspace import terminal


def at(result, key, hour):
    rows = result['replay']['tracks'][key]
    row = next((r for r in reversed(rows) if r['start'] <= hour), rows[0])
    return row, row['value'] + row['rate'] * max(0, min(hour, row['end']) - row['start'])


def test_replay_freezes_at_outage_and_resumes_without_jump():
    plan, ids = terminal()
    result = compare(plan, plan.scenarios[0])
    assert result['baseline']['vessel_completion_hour'] == 22
    assert result['scenario']['vessel_completion_hour'] == 25
    r = result['scenario']
    key = 'asset:' + ids['crane2']
    for hour in [8, 8.001, 10, 13.999]:
        row, value = at(r, key, hour)
        assert row['state'] == 'unavailable'
        assert row['rate'] == 0
        assert value == pytest.approx(180)
    row, value = at(r, key, 14)
    assert row['state'] == 'working'
    assert row['rate'] == 30
    assert value == pytest.approx(180)
    assert at(r, key, 15)[1] == pytest.approx(210)
    assert sum(map(len, r['replay']['tracks'].values())) < 100


def test_interpolated_replay_preserves_cargo_and_equipment_totals():
    plan, _ = terminal()
    next(a for a in plan.assets if a.kind == 'yard').initial_stock = 47
    next(a for a in plan.assets if a.kind == 'gate').rate = 22
    r = simulate(plan, plan.scenarios[0])
    for minute in range(int(r['elapsed_hours'] * 60)):
        hour = (minute + .37) / 60
        assert at(r, 'flow:handled', hour)[1] + 47 == pytest.approx(
            at(r, 'flow:yard', hour)[1] + at(r, 'flow:cleared', hour)[1], abs=1e-5)
    for equipment in r['equipment']:
        assert at(r, 'asset:' + equipment['id'], r['elapsed_hours'])[1] == pytest.approx(equipment['moves'], abs=.001)
    assert at(r, 'call:' + str(plan.calls[0].id), r['elapsed_hours'])[1] == pytest.approx(1200)


def test_blocked_and_queued_states_do_not_claim_completion():
    plan, ids = terminal()
    next(a for a in plan.assets if a.kind == 'gate').rate = 0
    next(a for a in plan.assets if a.kind == 'yard').capacity = 100
    second = plan.calls[0].model_copy(deep=True)
    second.id = uuid.uuid4()
    second.arrival_hour = 3
    plan.calls.append(second)
    r = simulate(plan)
    assert r['status'] == 'horizon_reached'
    blocked, handled = at(r, 'call:' + str(plan.calls[0].id), 72)
    assert blocked['state'] == 'blocked'
    assert blocked['reason'] == 'Yard storage'
    assert handled == 100
    assert at(r, 'call:' + str(second.id), 72)[0]['state'] == 'waiting'


def test_replay_track_namespaces_do_not_mix_equal_call_and_asset_ids():
    plan, ids = terminal()
    plan.calls[0].id = uuid.UUID(ids['crane1'])
    r = simulate(plan)
    assert at(r, 'call:' + ids['crane1'], 22)[1] == 1200
    assert at(r, 'asset:' + ids['crane1'], 22)[1] == 600


def test_bounded_recorder_discards_detail_rather_than_partial_playback(monkeypatch):
    monkeypatch.setattr('app.services.maritime_replay.MAX_SEGMENTS', 2)
    recorder = ReplayRecorder()
    recorder.add('a', 0, 1, 0, 30, 'working')
    recorder.add('a', 1, 2, 30, 30, 'working')
    assert recorder.count == 1
    recorder.add('a', 2, 3, 60, 0, 'unavailable')
    recorder.add('a', 3, 4, 60, 30, 'working')
    assert recorder.result()['available'] is False
    assert recorder.result()['tracks'] == {}
    recorder.add('b', 0, 1, 0, 30, 'working')
    assert recorder.result()['tracks'] == {}


def test_scene_settings_validate_and_old_plans_remain_valid():
    plan, ids = terminal()
    data = plan.model_dump(mode='json')
    data['assets'][0]['placement'] = {'x': 22, 'z': 30, 'heading': 45}
    data['exercises'] = [{'id': str(uuid.uuid4()), 'name': 'Lift', 'asset_id': ids['crane1'],
                          'required_actions': ['Stop'], 'scene_effects': {'Stop': 'stop'}}]
    parsed = WorkspaceDefinition.model_validate(data)
    assert parsed.assets[0].placement.x == 22
    assert parsed.exercises[0].scene_effects == {'Stop': 'stop'}
    data['exercises'][0]['scene_effects'] = {'Unknown': 'stop'}
    with pytest.raises(ValidationError):
        WorkspaceDefinition.model_validate(data)
    data['exercises'] = []
    data['assets'][0]['placement']['x'] = float('nan')
    with pytest.raises(ValidationError):
        WorkspaceDefinition.model_validate(data)
