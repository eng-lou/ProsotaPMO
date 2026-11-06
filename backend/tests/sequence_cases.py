"""Promotion timing checks; run without touching project databases."""
import unittest
from copy import deepcopy
from datetime import datetime, timedelta
from types import SimpleNamespace
from fastapi import HTTPException
from app.services.simulation_sequence import fit_to_activities
from app.services.operation_simulation import stamp

START = datetime(2026, 10, 28, 8)
def at(seconds): return (START + timedelta(seconds=seconds)).isoformat()
def parent(id, start=0, finish=3600):
    return SimpleNamespace(id=id, start=START+timedelta(seconds=start), finish=START+timedelta(seconds=finish))
def sample(second_activity='a'):
    return dict(config=dict(steps=[dict(id='one'),dict(id='two')]), source={'untouched':True}, result=dict(
        activities=[dict(activity_id=a,name=a) for a in dict.fromkeys(['a', second_activity])],
        steps=[dict(id='one',name='first',activity_id='a',start=at(0),finish=at(10)),dict(id='two',name='second',activity_id=second_activity,start=at(10),finish=at(30))],
        events=[dict(step_id='one',task_id='one:0',activity_id='a',start=at(0),end=at(10),object_states=[]),dict(step_id='two',task_id='two:0',activity_id=second_activity,start=at(10),end=at(30),object_states=[])],
        waiting=[dict(step_id='two',start=at(5),end=at(10))],production=[dict(step_id='two',time=at(30),quantity=1)],start=at(0),finish=at(30)))

class PromotionTiming(unittest.TestCase):
    def test_all_steps_share_parent_window_and_original_stays_unchanged(self):
        original=sample(); before=deepcopy(original)
        fitted=fit_to_activities(original,[parent('a')]); result=fitted['result']
        self.assertEqual([stamp(e['end'])-stamp(e['start']) for e in result['events']],[1200,2400])
        self.assertEqual(result['steps'][0]['finish'],result['steps'][1]['start'])
        self.assertEqual(stamp(result['finish']),stamp(at(3600)))
        self.assertEqual(stamp(result['waiting'][0]['start']),stamp(at(600)))
        self.assertEqual(stamp(result['production'][0]['time']),stamp(at(3600)))
        self.assertEqual(original,before)
        self.assertNotIn('source',fitted)
        self.assertEqual(fitted['timing']['mode'],'parent_activity')

    def test_each_activity_fits_its_own_programme_window(self):
        fitted=fit_to_activities(sample('b'),[parent('a',0,3600),parent('b',7200,9000)])['result']
        self.assertEqual([stamp(e['start'])-stamp(at(0)) for e in fitted['events']],[0,7200])
        self.assertEqual([stamp(e['end'])-stamp(e['start']) for e in fitted['events']],[3600,1800])

    def test_missing_or_zero_parent_window_is_not_promoted(self):
        for parents in [[],[parent('a',0,0)],[SimpleNamespace(id='a',start=None,finish=None)]]:
            with self.assertRaises(HTTPException):fit_to_activities(sample(),parents)

    def test_parent_fitting_rejects_shared_worker_or_tool_overlap(self):
        for shared in ['worker_id','tool_id']:
            scenario=sample('b')
            scenario['config']['steps'][0]['worker_method']={'worker_id':'w1','tool_id':'t1'}
            scenario['config']['steps'][1]['worker_method']={'worker_id':'w2','tool_id':'t2'}
            scenario['config']['steps'][1]['worker_method'][shared]=scenario['config']['steps'][0]['worker_method'][shared]
            with self.assertRaisesRegex(HTTPException,'same worker or tool'):
                fit_to_activities(scenario,[parent('a'),parent('b')])
            fit_to_activities(scenario,[parent('a'),parent('b',3600,7200)])

    def test_cross_activity_predecessor_cannot_be_inverted(self):
        scenario=sample('b');scenario['config']['steps'][1]['dependencies']=[{'step_id':'one'}]
        with self.assertRaisesRegex(HTTPException,'predecessor'):
            fit_to_activities(scenario,[parent('a',3600,7200),parent('b',0,3600)])

    def test_conflicting_handling_detected_but_separate_elements_allowed(self):
        scenario=sample('b')
        for event in scenario['result']['events']:event['object_states']=[{'model_ref':'beam.ifc','element_id':'beam1'}]
        with self.assertRaisesRegex(HTTPException,'handling instructions'):
            fit_to_activities(scenario,[parent('a'),parent('b')])
        scenario['result']['events'][1]['object_states'][0]['element_id']='beam2'
        fit_to_activities(scenario,[parent('a'),parent('b')])
        scenario['result']['events'][0]['object_states'][0].pop('element_id')
        with self.assertRaises(HTTPException):fit_to_activities(scenario,[parent('a'),parent('b')])

if __name__=='__main__':unittest.main()
