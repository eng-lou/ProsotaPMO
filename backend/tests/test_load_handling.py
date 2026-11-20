import unittest
from uuid import uuid4
from pydantic import ValidationError
from app.schemas.load_handling import LoadHandling
from app.schemas.site_scene import SiteItem, SceneEdit

IDENTITY=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
def event(parent=None):
    return dict(id=str(uuid4()),date='2026-11-20T12:00:00Z',parent_id=parent,matrix=IDENTITY)
def item():
    return dict(id=str(uuid4()),name='Deck',kind='asset',asset_id=str(uuid4()),generator_version=1,up_axis='y',position=dict(x=0,y=0,z=0))
class LoadTests(unittest.TestCase):
    def test_round_trip_and_rejections(self):
        value=LoadHandling(events=[event()],lifting_points=[(1,2,3)])
        self.assertEqual(LoadHandling.model_validate_json(value.model_dump_json()),value)
        for events in ([event(),event()],[{**event(), 'matrix':[0]*16}],[{**event(),'date':'2026-11-20T12:00:00'}]):
            with self.assertRaises(ValidationError): LoadHandling(events=events)
    def test_named_lifting_points(self):
        value=LoadHandling(lifting_points=[(0,0,0)],lifting_nodes=['LiftEye_1'])
        self.assertEqual(LoadHandling.model_validate_json(value.model_dump_json()).lifting_nodes,['LiftEye_1'])
        with self.assertRaises(ValidationError): LoadHandling(lifting_points=[],lifting_nodes=['LiftEye_1'])
        with self.assertRaises(ValidationError): LoadHandling(lifting_points=[(0,0,0)],lifting_nodes=['x'*257])
    def test_parent_graph(self):
        a,b=item(),item();a['load_handling']=dict(events=[event(b['id'])])
        args=dict(command_id=uuid4(),expected_revision=0)
        SceneEdit(items=[a,b],**args)
        with self.assertRaises(ValidationError): SceneEdit(items=[a],**args)
        b['load_handling']=dict(events=[event(a['id'])])
        with self.assertRaises(ValidationError): SceneEdit(items=[a,b],**args)
    def test_exclusive_pose_ownership(self):
        a=item();a['load_handling']=dict(events=[event()]);a['attachment']=dict(parent_id=uuid4(),start='2026-11-20T12:00:00Z',end='2026-11-20T13:00:00Z')
        with self.assertRaises(ValidationError): SiteItem(**a)
