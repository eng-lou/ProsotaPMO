from datetime import date
from unittest.mock import AsyncMock, patch

import anthropic
import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.ai.maritime import maritime_turn
from app.ai.openai_client import ContentBlock, TurnResponse
from app.core.auth import require_ai_quota
from app.main import app
from app.schemas.maritime import DeliveryScenario, MaritimePoeRequest, OperationsScenario
from app.services.maritime import delivery_results, operations_results


def test_foundation_delay_schedule_resource_and_cost_conservation():
    result = delivery_results(DeliveryScenario())
    assert result['impact'] == {'working_days': 15, 'calendar_days': 21, 'cost': 75000, 'resource_hours': 240}
    assert result['baseline']['total_cost'] == 441000
    assert result['scenario']['total_cost'] == 516000
    assert result['baseline']['finish'] == '2026-12-08T08:00:00'
    assert result['scenario']['finish'] == '2026-12-29T08:00:00'
    for variant in ('baseline', 'scenario'):
        s = result[variant]
        assert sum(a['cost'] for a in s['activities']) == s['direct_cost']
        assert sum(r['cost'] for r in s['resources']) == s['direct_cost']
        assert sum(d['cost'] for d in s['daily']) == s['total_cost']
        assert s['daily'][-1]['cumulative_cost'] == s['total_cost']
        assert sum(d['resource_hours'] for d in s['daily']) == sum(r['hours'] for r in s['resources'])
        for a in s['activities']:
            for pred in a['predecessors']:
                assert a['start'] >= next(p['finish'] for p in s['activities'] if p['id'] == pred)
            assert a['asset_id'] == 'expansion-01'
    for before, after in zip(result['baseline']['resources'], result['scenario']['resources']):
        if before['type'] in ('material', 'subcontractor'):
            assert before['cost'] == after['cost']


def test_parallel_procurement_consumes_float_before_readiness_moves():
    within = delivery_results(DeliveryScenario(delay_activity='procurement', delay_days=4))
    assert within['impact'] == {'working_days': 0, 'calendar_days': 0, 'cost': 0, 'resource_hours': 0}
    beyond = delivery_results(DeliveryScenario(delay_activity='procurement', delay_days=10))
    assert beyond['impact'] == {'working_days': 6, 'calendar_days': 8, 'cost': 6000, 'resource_hours': 0}
    procurement = next(a for a in beyond['scenario']['activities'] if a['id'] == 'procurement')
    assert procurement['critical'] is True
    assert next(a for a in beyond['baseline']['activities'] if a['id'] == 'procurement')['float_days'] == 4


def test_reset_and_weekend_anchor_preserve_baseline():
    baseline = delivery_results(DeliveryScenario(delay_days=0))
    delayed = delivery_results(DeliveryScenario(delay_days=90))
    assert baseline['baseline'] == baseline['scenario'] == delayed['baseline']
    weekend = delivery_results(DeliveryScenario(start_date=date(2026, 10, 17), delay_days=0))
    assert weekend['baseline']['start'] == '2026-10-19T08:00:00'
    assert weekend['baseline']['total_cost'] == baseline['baseline']['total_cost']


@pytest.mark.parametrize('kwargs', [{'delay_days': -1}, {'delay_days': 91}, {'delay_days': 2.5}, {'delay_activity': 'arbitrary'}, {'overhead_day_rate': float('nan')}, {'project_id': 'private-project'}])
def test_bounded_scenario_inputs(kwargs):
    with pytest.raises(ValidationError):
        DeliveryScenario(**kwargs)


def test_operations_results_are_calculated_from_inputs():
    assert operations_results(OperationsScenario())['delay_hours'] == 3
    assert operations_results(OperationsScenario(breakdown=False))['delay_hours'] == 0
    assert operations_results(OperationsScenario(outageStart=0, outageHours=1))['delay_hours'] == 0
    assert operations_results(OperationsScenario(outageStart=100))['delay_hours'] == 0
    assert operations_results(OperationsScenario(cargo=30, outageStart=2))['scenario_hours'] == 3


async def test_calculation_endpoint_and_validation(client):
    response = await client.post('/api/v1/maritime/delivery/calculate', json={})
    assert response.status_code == 200
    assert response.json()['impact']['cost'] == 75000
    invalid = await client.post('/api/v1/maritime/delivery/calculate', json={'delay_days': 1000})
    assert invalid.status_code == 422


async def test_poe_tool_returns_calculated_proposal_without_applying():
    proposed = DeliveryScenario(delay_activity='procurement', delay_days=10)
    first = TurnResponse([ContentBlock({'type': 'tool_use', 'id': 'test-call', 'name': 'evaluate_delivery_scenario', 'input': proposed.model_dump(mode='json')})], 'tool_use')
    second = TurnResponse([ContentBlock({'type': 'text', 'text': 'Procurement uses four days of float; readiness slips six working days.'})], 'end_turn')
    with patch('app.ai.maritime.run_turn', new=AsyncMock(side_effect=[first, second])) as provider:
        request = MaritimePoeRequest(question='Try a 10-day procurement extension.')
        result = await maritime_turn(request)
        assert result['proposals'][0]['impact']['working_days'] == 6
        assert result['proposals'][0]['impact']['cost'] == 6000
        assert request.delivery.delay_activity == 'foundation'
        tool_result = provider.call_args.args[1][-1]['content'][0]['content']
        assert '"applied": false' in tool_result
        assert '"baseline_hours": 22.0' in provider.call_args.args[0]


async def test_poe_rejects_invalid_tool_inputs():
    first = TurnResponse([ContentBlock({'type': 'tool_use', 'id': 'bad-call', 'name': 'evaluate_delivery_scenario', 'input': {'delay_days': 1000}})], 'tool_use')
    second = TurnResponse([ContentBlock({'type': 'text', 'text': 'Choose at most 90 days.'})], 'end_turn')
    with patch('app.ai.maritime.run_turn', new=AsyncMock(side_effect=[first, second])):
        result = await maritime_turn(MaritimePoeRequest(question='Test invalid inputs'))
        assert result['proposals'] == []


async def test_poe_quota_denial_prevents_provider_call(client):
    async def denied():
        raise HTTPException(429, 'Daily limit reached')
    app.dependency_overrides[require_ai_quota] = denied
    try:
        with patch('app.ai.maritime.run_turn', new=AsyncMock()) as provider:
            response = await client.post('/api/v1/maritime/poe', json={'question': 'Explain'})
            assert response.status_code == 429
            provider.assert_not_called()
    finally:
        app.dependency_overrides.pop(require_ai_quota, None)


async def test_poe_provider_failure_is_actionable():
    failure = anthropic.APIConnectionError(request=httpx.Request('POST', 'https://provider.invalid/messages'))
    with patch('app.ai.maritime.run_turn', new=AsyncMock(side_effect=failure)):
        with pytest.raises(HTTPException) as error:
            await maritime_turn(MaritimePoeRequest(question='Explain the delay'))
        assert error.value.status_code == 503
        assert 'provider' in error.value.detail
