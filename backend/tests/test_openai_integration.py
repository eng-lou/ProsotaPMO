"""No network/DB required: python -m unittest tests.test_openai_integration."""
import base64
import copy
import json
import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app.ai import client, openai_client as adapter, openai_transport as transport, orchestrator
from app.core.config import settings
from app.services import ai_concept_render as concept


def answer(text='Done'):
    return {'status': 'completed', 'output': [
        {'type': 'message', 'id': 'msg_1', 'role': 'assistant', 'status': 'completed',
         'content': [{'type': 'output_text', 'text': text, 'annotations': []}]},
    ]}


def call(name='get_project_snapshot'):
    return {'status': 'completed', 'output': [
        {'type': 'reasoning', 'id': 'rs_1', 'summary': [], 'encrypted_content': 'opaque'},
        {'type': 'function_call', 'id': 'fc_1', 'call_id': 'call_1', 'name': name, 'arguments': '{}'},
    ]}


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    def test_legacy_conversation_and_attachments(self):
        messages = [
            {'role': 'user', 'content': [
                {'type': 'text', 'text': 'Check this'},
                {'type': 'image', 'source': {'type': 'url', 'url': 'https://storage.invalid/image.png'}},
                {'type': 'document', 'source': {'type': 'url', 'url': 'https://storage.invalid/report.pdf'}},
            ]},
            {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'legacy'},
                {'type': 'tool_use', 'id': 'old_call', 'name': 'find_records', 'input': {'query': 'roof'}}]},
            {'role': 'user', 'content': [{'type': 'tool_result', 'tool_use_id': 'old_call', 'content': {'records': []}}]},
        ]
        original = copy.deepcopy(messages)
        result = adapter.responses_input(messages)
        self.assertEqual(result[0]['content'][1]['type'], 'input_image')
        self.assertEqual(result[0]['content'][2]['type'], 'input_file')
        self.assertEqual(result[1]['call_id'], 'old_call')
        self.assertEqual(json.loads(result[1]['arguments']), {'query': 'roof'})
        self.assertEqual(result[2]['type'], 'function_call_output')
        self.assertEqual(messages, original)

    def test_output_round_trip_does_not_duplicate_tool_or_text(self):
        response = call()
        response['output'] += answer()['output']
        turn = adapter.parse_response(response)
        blocks = [b.model_dump() for b in turn.content]
        self.assertEqual(turn.stop_reason, 'tool_use')
        self.assertEqual(sum(b['type'] == 'tool_use' for b in blocks), 1)
        replay = adapter.responses_input([{'role': 'assistant', 'content': blocks}])
        self.assertEqual(replay, response['output'])
        self.assertEqual(replay[0]['encrypted_content'], 'opaque')

    def test_rejects_privileged_replay_roles(self):
        for role in ('developer', 'system', 'user'):
            with self.subTest(role=role), self.assertRaises(HTTPException):
                adapter.responses_input([{'role': 'assistant', 'content': [
                    {'type': 'openai_item', 'item': {'type': 'message', 'role': role, 'content': []}},
                ]}])

    def test_incomplete_and_invalid_calls_never_execute(self):
        responses = [call(), call(), {'status': 'completed', 'output': []}]
        responses[0]['status'] = 'incomplete'
        responses[1]['output'][1]['arguments'] = '[]'
        for response in responses:
            with self.subTest(response=response), self.assertRaises(HTTPException):
                adapter.parse_response(response)

    async def test_request_preserves_tool_schema_and_uses_astra(self):
        tools = [{'name': 'find_records', 'description': 'Find', 'input_schema': {'type': 'object', 'properties': {}}}]
        with patch.object(adapter, 'post_openai', new=AsyncMock(return_value=answer())) as post:
            result = await adapter.run_turn('System', [{'role': 'user', 'content': 'Hello'}], tools)
        payload = post.call_args.kwargs['json']
        self.assertEqual(payload['model'], 'gpt-6-astra')
        self.assertFalse(payload['store'])
        self.assertFalse(payload['tools'][0]['strict'])
        self.assertEqual(payload['tools'][0]['parameters'], tools[0]['input_schema'])
        self.assertEqual(result.stop_reason, 'end_turn')

    async def test_proposals_still_pause_for_user_approval(self):
        response = adapter.parse_response(call('propose_create_risks'))
        with patch.object(orchestrator, 'run_turn', new=AsyncMock(return_value=response)), \
             patch.object(orchestrator, '_execute_server_tool', new=AsyncMock()) as execute:
            result = await orchestrator.run_agent_turn(None, [{'role': 'user', 'content': 'Draft a risk'}], uuid.uuid4(), None, None, [])
        execute.assert_not_awaited()
        self.assertEqual(result.pending_proposals[0]['id'], 'call_1')
        self.assertEqual(result.pending_proposals[0]['name'], 'propose_create_risks')

    async def test_server_tools_round_trip_then_answer(self):
        turns = [adapter.parse_response(call()), adapter.parse_response(answer())]
        with patch.object(orchestrator, 'run_turn', new=AsyncMock(side_effect=turns)) as run, \
             patch.object(orchestrator, '_execute_server_tool', new=AsyncMock(return_value={'count': 4})) as execute:
            result = await orchestrator.run_agent_turn(None, [{'role': 'user', 'content': 'Summary'}], uuid.uuid4(), None, None, [])
        execute.assert_awaited_once()
        followup = adapter.responses_input(run.call_args_list[1].args[1])
        self.assertEqual(followup[-1]['call_id'], 'call_1')
        self.assertEqual(json.loads(followup[-1]['output']), {'count': 4})
        self.assertEqual(result.stop_reason, 'end_turn')

    async def test_routing_and_no_silent_fallback_on_openai_error(self):
        with patch.object(settings, 'ai_provider', 'auto'), patch.object(settings, 'openai_api_key', 'test-key'), \
             patch.object(client, 'run_openai_turn', new=AsyncMock(side_effect=HTTPException(429, 'limited'))), \
             patch.object(client, '_get_client') as legacy:
            with self.assertRaises(HTTPException):
                await client.run_turn('system', [], [])
            legacy.assert_not_called()

    async def test_explicit_rollback_removes_openai_envelopes(self):
        legacy = SimpleNamespace(messages=SimpleNamespace(create=AsyncMock(return_value='legacy')))
        blocks = [b.model_dump() for b in adapter.parse_response(answer()).content]
        with patch.object(settings, 'ai_provider', 'anthropic'), patch.object(client, '_get_client', return_value=legacy):
            await client.run_turn('system', [{'role': 'assistant', 'content': blocks}], [])
        self.assertEqual(legacy.messages.create.call_args.kwargs['messages'][0]['content'], [{'type': 'text', 'text': 'Done'}])


class ConceptTests(unittest.IsolatedAsyncioTestCase):
    async def test_openai_image_edit_keeps_guardrail_and_source(self):
        expected = b'synthetic-image'
        with patch.object(settings, 'ai_concept_render_provider', 'openai'), \
             patch.object(concept, 'post_openai', new=AsyncMock(return_value={'data': [{'b64_json': base64.b64encode(expected).decode()}]})) as post:
            result = await concept._generate(b'capture', 'Warm evening light')
        self.assertEqual(result, expected)
        args = post.call_args.kwargs
        self.assertEqual(args['files']['image'][1], b'capture')
        self.assertTrue(args['data']['prompt'].startswith(concept.GUARDRAIL_PROMPT))
        self.assertIn('Warm evening light', args['data']['prompt'])
        self.assertEqual(args['data']['model'], 'gpt-image-2.5-sunburst')
        self.assertEqual(args['data']['n'], '1')

    def test_creativity_validation_and_prompt_guidance(self):
        from app.schemas.ai_concept_render import ConceptRenderRequest
        from pydantic import ValidationError
        for value in (-0.1, 1.1, float('nan'), float('inf')):
            with self.assertRaises(ValidationError):
                ConceptRenderRequest(storage_key='capture', creativity=value)
        for value, expected in ((0, 'close source alignment'), (0.5, 'Balance'), (1, 'adventurous')):
            request = ConceptRenderRequest(storage_key='capture', creativity=value)
            prompt = concept.build_render_prompt('Warm light', request.creativity)
            self.assertIn(expected, prompt)
            self.assertIn(f'Creativity: {value:.2f}', prompt)
            self.assertIn('Warm light', prompt)

    async def test_route_forwards_creativity(self):
        from app.api.ai_concept_render import concept_render
        from app.schemas.ai_concept_render import ConceptRenderRequest
        with patch.object(concept, 'generate_concept_render', new=AsyncMock(return_value='result')) as render:
            await concept_render(ConceptRenderRequest(storage_key='capture', prompt='Warm light', creativity=1))
        render.assert_awaited_once_with('capture', 'Warm light', 1)

    async def test_invalid_image_is_reported(self):
        with patch.object(settings, 'ai_concept_render_provider', 'openai'), \
             patch.object(concept, 'post_openai', new=AsyncMock(return_value={'data': [{'b64_json': 'invalid!'}]})):
            with self.assertRaises(HTTPException) as raised:
                await concept._generate(b'capture', '')
        self.assertEqual(raised.exception.status_code, 502)


class TransportTests(unittest.IsolatedAsyncioTestCase):
    async def test_missing_key_never_calls_network(self):
        with patch.object(settings, 'openai_api_key', ''), patch.object(transport.httpx, 'AsyncClient') as http:
            with self.assertRaises(HTTPException) as raised:
                await transport.post_openai('responses', json={})
            http.assert_not_called()
        self.assertEqual(raised.exception.status_code, 503)

    async def test_provider_errors_do_not_leak_response_or_key(self):
        for status, expected in [(401, 503), (403, 503), (404, 503), (429, 429), (500, 502)]:
            request = httpx.Request('POST', 'https://api.openai.com/v1/responses')
            response = httpx.Response(status, request=request, json={'error': 'sensitive-provider-details'})
            http = AsyncMock()
            http.__aenter__.return_value = http
            http.post.return_value = response
            with self.subTest(status=status), patch.object(settings, 'openai_api_key', 'secret-test-key'), \
                 patch.object(transport.httpx, 'AsyncClient', return_value=http):
                with self.assertRaises(HTTPException) as raised:
                    await transport.post_openai('responses', json={})
                self.assertEqual(raised.exception.status_code, expected)
                self.assertNotIn('secret-test-key', raised.exception.detail)
                self.assertNotIn('sensitive-provider-details', raised.exception.detail)


if __name__ == '__main__':
    unittest.main()
