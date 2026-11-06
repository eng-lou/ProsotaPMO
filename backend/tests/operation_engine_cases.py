"""Pure scheduling regressions; runs without a database or application config."""
import unittest
from copy import deepcopy
from app.schemas.simulation import SimulationConfig
from app.services.operation_simulation import calculate, stamp

START = '2026-10-28T08:00:00'
END = '2026-10-29T08:00:00'


def config(steps, resources=None, **options):
    return dict(activity_ids=['a', 'b'], start=START, horizon_days=1,
                resources=resources or [], steps=steps, **options)


def step(id, aid='a', **kw):
    return dict(id=id, name=id, activity_id=aid, hours=1, **kw)


def run(cfg, **context):
    windows={'activity:a': [[START, END]], 'activity:b': [[START, END]]}
    windows.update({'resource:'+r['id']: [[START, END]] for r in cfg['resources']})
    windows.update(context.pop('windows', {}))
    return calculate(SimulationConfig.model_validate(cfg), dict(activities=[{'id':'a'}, {'id':'b'}], windows=windows, **context))


class Operations(unittest.TestCase):
    def test_queue_metrics_distinguish_resources_with_the_same_label(self):
        cfg=config([step('first',resources=[{'resource_id':'r1'}]),step('next',resources=[{'resource_id':'r1'}]),step('other','b',resources=[{'resource_id':'r2'}])],
                   [dict(id='r1',name='Crane'),dict(id='r2',name='Crane')])
        result=run(cfg)
        self.assertEqual(result['resources'][0]['waiting_hours'],1)
        self.assertEqual(result['resources'][1]['waiting_hours'],0)

    def test_start_relationship_releases_on_first_step_in_activity(self):
        cfg=config([step('early'),step('late',dependencies=[dict(step_id='early')]),
                    step('successor','b',dependencies=[dict(step_id='early',relation='start',any_group='activity-a'),dict(step_id='late',relation='start',any_group='activity-a')])])
        result=run(cfg)
        self.assertEqual(result['steps'][0]['start'],result['steps'][2]['start'])

    def test_excavator_three_trucks_partial_load_and_truck_outage(self):
        cfg=config([dict(id='haul',name='Excavate and haul',activity_id='a',basis='cycle',unit='m3',quantity=115,cycle_quantity=10,
            hold_resources=[{'resource_id':'trucks'}],phases=[
                dict(id='load',name='Load',bucket_loading=dict(capacity_m3=1.5,fill_factor=.9,cycle_seconds=30),resources=[{'resource_id':'excavator'}]),
                dict(id='travel',name='Travel',hours=5/60),dict(id='tip',name='Tip',hours=1/60),dict(id='return',name='Return',hours=4/60)]),step('b','b')],
            [dict(id='trucks',name='Trucks',capacity=3),dict(id='excavator',name='Excavator',capacity=1)])
        baseline=run(cfg)
        self.assertEqual(baseline['status'],'current')
        self.assertEqual(baseline['steps'][0]['quantity'],115)
        loads=[e for e in baseline['events'] if e['phase']=='Load']
        self.assertAlmostEqual(sum(stamp(e['end'])-stamp(e['start']) for e in loads),11*240+120)
        cfg['disruptions']=[dict(id='out',name='Truck outage',target='resource',target_id='trucks',start=START,unavailable_units=1)]
        changed=run(cfg)
        self.assertGreater(stamp(changed['steps'][0]['finish']),stamp(baseline['steps'][0]['finish']))
        self.assertEqual(changed['steps'][0]['quantity'],115)

    def test_instant_installation_and_overlapping_object_handling(self):
        h=dict(model_ref='beam',state='installed')
        cfg=config([dict(id='a',name='Install',activity_id='a',hours=0,object_states=[h]),step('b','b')])
        result=run(cfg)
        self.assertEqual(result['events'][0]['object_states'][0]['state'],'installed')
        self.assertEqual(result['events'][0]['start'],result['events'][0]['end'])
        cfg['steps'][0]['hours']=1;cfg['steps'][1]['object_states']=[h]
        self.assertTrue(any('Overlapping handling' in i['reason'] for i in run(cfg)['issues']))

    def test_shared_crane_queues_and_separate_resources_overlap(self):
        demand=[{'resource_id':'crane'}]
        cfg=config([step('lift-a', resources=demand), step('lift-b','b',resources=demand)], [{'id':'crane','name':'Crane'}])
        result=run(cfg)
        self.assertEqual(result['status'],'current')
        a,b=result['steps']; self.assertEqual(a['finish'],b['start'])
        self.assertEqual(result['resources'][0]['utilisation'],100)
        self.assertTrue(any('Crane' in w['reason'] for w in result['waiting']))
        cfg['resources'][0]['capacity']=2
        result=run(cfg); self.assertEqual(result['steps'][0]['start'],result['steps'][1]['start'])

    def test_trucks_remain_reserved_through_load_travel_and_return(self):
        cfg=config([dict(id='haul', name='Haul', activity_id='a', basis='cycle',quantity=30,cycle_quantity=10,
                         hold_resources=[{'resource_id':'truck'}], phases=[
                             dict(id='load',name='Load',hours=1,resources=[{'resource_id':'loader'}]),
                             dict(id='travel',name='Travel',hours=2)]) , step('other','b')],
                   [{'id':'truck','name':'Trucks','capacity':2},{'id':'loader','name':'Loader'}])
        result=run(cfg); haul=result['steps'][0]
        self.assertEqual(haul['quantity'],30)
        self.assertEqual((stamp(haul['finish'])-stamp(START))/3600,6)
        self.assertEqual([p['quantity'] for p in result['production'] if p['step_id']=='haul'],[10,10,10])

    def test_half_release_starts_successor_before_all_cycles_finish(self):
        cfg=config([dict(id='batch',name='Batch',activity_id='a',basis='cycle',quantity=40,cycle_quantity=10,
                         resources=[{'resource_id':'crew'}],phases=[dict(id='work',name='Work',hours=1)]),
                    step('next','b',dependencies=[dict(step_id='batch',release_fraction=.5)])],
                   [{'id':'crew','name':'Crew'}])
        result=run(cfg); a,b=result['steps']
        self.assertEqual((stamp(b['start'])-stamp(START))/3600,2)
        self.assertLess(stamp(b['finish']),stamp(a['finish']))

    def test_missing_window_is_unresolved_and_no_finish_is_invented(self):
        result=run(config([step('a',access_required=True),step('b','b')]))
        self.assertEqual(result['status'],'incomplete'); self.assertIsNone(result['steps'][0]['finish'])

    def test_resumable_access_and_must_fit(self):
        cfg=config([step('a',access_windows=[dict(start=START,end='2026-10-28T08:30:00'),dict(start='2026-10-28T10:00:00',end='2026-10-28T10:30:00')]),step('b','b')])
        self.assertEqual(run(cfg)['steps'][0]['finish'],'2026-10-28T10:30:00.000')
        cfg['steps'][0]['resumable']=False
        self.assertEqual(run(cfg)['status'],'incomplete')

    def test_outage_and_improved_productivity_and_external_commitments(self):
        cfg=config([step('a',resources=[{'resource_id':'crane'}]),step('b','b')],[{'id':'crane','name':'Crane'}],disruptions=[dict(id='fast',name='Faster',target='step',target_id='a',kind='productivity',start=START,factor=2)])
        self.assertEqual(run(cfg)['steps'][0]['finish'],'2026-10-28T08:30:00.000')
        cfg['disruptions']=[dict(id='out',name='Maintenance',target='resource',target_id='crane',start=START,end='2026-10-28T10:00:00')]
        self.assertEqual(run(cfg)['steps'][0]['finish'],'2026-10-28T11:00:00.000')
        cfg['disruptions']=[]
        self.assertEqual(run(cfg,boundaries=[dict(resource_id='crane',start=START,end='2026-10-28T12:00:00',units=1)])['steps'][0]['finish'],'2026-10-28T13:00:00.000')

    def test_reproducible_no_input_mutation_and_route_duration(self):
        cfg=config([dict(id='a',name='Route',activity_id='a',basis='cycle',quantity=1,cycle_quantity=1,phases=[dict(id='go',name='Go',route_id='r',speed_mps=2)]),step('b','b')])
        before=deepcopy(cfg); a=run(cfg,routes={'r':7200}); b=run(cfg,routes={'r':7200})
        self.assertEqual(a,b);self.assertEqual(cfg,before)
        self.assertEqual(a['steps'][0]['finish'],'2026-10-28T09:00:00.000')


if __name__=='__main__':unittest.main()
