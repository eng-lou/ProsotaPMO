"""Worker method scheduling: run directly without a database."""
import unittest
from copy import deepcopy
from operation_engine_cases import config, run, START, END
from app.schemas.simulation import SimulationConfig
from app.services.operation_simulation import stamp


def method(worker='worker', tool='tool'):
    return dict(version=1, kind='walk_work_continue', worker_id=worker, worker_asset_id='actor-asset',
                tool_id=tool, tool_asset_id='tool-asset', route_id='route',
                route=dict(id='route', geometry={}, samples=[[0,0,0],[12,0,0]], length_m=12),
                idle_clip='Idle', walk_clip='Walk', work_clip='Drill', hand='CC_Base_R_Hand',
                work_seconds=10, speed_mps=1.2, work_position=50)


def step(id='method', worker='worker', tool='tool'):
    return dict(id=id, name=id, activity_id='a', quantity=1, worker_method=method(worker,tool))


class WorkerMethods(unittest.TestCase):
    def test_one_clock_retimes_all_three_stages(self):
        cfg=config([step()]); result=run(cfg)
        events=result['events']
        self.assertEqual([e['worker_action']['stage'] for e in events], ['approach','work','continue'])
        self.assertEqual([stamp(e['end'])-stamp(e['start']) for e in events], [5,10,5])
        cfg['steps'][0]['worker_method']['work_seconds']=25
        longer=run(cfg)['events']
        self.assertEqual(stamp(longer[2]['start'])-stamp(events[2]['start']),15)
        self.assertEqual(longer[1]['worker_action']['seconds'],25)

    def test_worker_and_tool_are_exclusive_until_departure(self):
        for shared in ['worker','tool']:
            cfg=config([step('one'),step('two',worker='worker' if shared=='worker' else 'other',tool='tool' if shared=='tool' else 'another')])
            result=run(cfg); a,b=result['steps']
            self.assertEqual(a['finish'],b['start'])
            self.assertTrue(any('already in use' in w['reason'] for w in result['waiting']))
        independent=run(config([step('one'),step('two','other','another')]))
        self.assertEqual(independent['steps'][0]['start'],independent['steps'][1]['start'])

    def test_calendar_break_preserves_work_progress(self):
        result=run(config([step()]), windows={'activity:a':[[START,'2026-10-28T08:00:08'],['2026-10-28T08:00:18',END]]})
        work=[e for e in result['events'] if e['worker_action']['stage']=='work']
        self.assertEqual(len(work),2)
        self.assertAlmostEqual(work[0]['progress_to'],.3)
        self.assertEqual(work[1]['progress_from'],work[0]['progress_to'])
        self.assertEqual(work[1]['progress_to'],1)
        self.assertEqual(stamp(result['steps'][0]['finish'])-stamp(START),30)

    def test_endpoint_work_and_roundtrip(self):
        for position in [0,100]:
            cfg=config([step()]);cfg['steps'][0]['worker_method']['work_position']=position
            validated=SimulationConfig.model_validate_json(SimulationConfig.model_validate(cfg).model_dump_json())
            events=run(validated.model_dump(mode='json'))['events']
            self.assertEqual(len(events),3)
            self.assertEqual(stamp(events[-1]['end'])-stamp(START),20)
            self.assertEqual(events[1]['worker_action']['from_progress'],position/100)

    def test_incompatible_handling_and_role_conflicts_are_rejected(self):
        cfg=config([step()]);cfg['steps'][0]['object_states']=[dict(model_ref='beam')]
        with self.assertRaises(ValueError):SimulationConfig.model_validate(cfg)
        cfg=config([step('one'),step('two',worker='tool',tool='other')])
        with self.assertRaises(ValueError):SimulationConfig.model_validate(cfg)
        cfg=config([step()]);cfg['steps'][0]['worker_method']['speed_mps']=0
        with self.assertRaises(ValueError):SimulationConfig.model_validate(cfg)


if __name__=='__main__': unittest.main()
