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
    def test_hook_connection(self):
        value=LoadHandling(events=[{**event(), 'sling_offset':(0,-1,0), 'sling_ring_angle':90}])
        self.assertEqual(LoadHandling.model_validate_json(value.model_dump_json()),value)
        for patch in ({'sling_offset':(0,float('nan'),0)},{'sling_offset':(0,1001,0)},{'sling_ring_angle':361}):
            with self.assertRaises(ValidationError): LoadHandling(events=[{**event(),**patch}])
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

class BalanceTests(unittest.TestCase):
    def test_balance_defaults_and_roundtrip(self):
        from app.schemas.load_handling import LoadHandling
        self.assertEqual(LoadHandling().balance_mode,'gravity')
        value=LoadHandling(balance_mode='fixed',center_of_gravity=(1,2,3))
        self.assertEqual(LoadHandling.model_validate_json(value.model_dump_json()),value)
    def test_invalid_mass_centre(self):
        from app.schemas.load_handling import LoadHandling
        for value in [(float('nan'),0,0),(1000001,0,0),(0,0)]:
            with self.assertRaises(ValueError):LoadHandling(center_of_gravity=value)

class RiggingTests(unittest.TestCase):
    def test_rig_roundtrip_and_validation(self):
        crane=str(uuid4());leg=dict(point=0,parent_id=crane,length=4)
        e={**event(crane), 'slings':True, 'rigging':dict(mass_kg=1000,legs=[leg])}
        h=LoadHandling(events=[e],lifting_points=[(0,0,0)])
        self.assertEqual(LoadHandling.model_validate_json(h.model_dump_json()),h)
        for patch in [dict(length=0),dict(length=float('nan')),dict(point=1),dict(offset=(1001,0,0)),dict(capacity_kn=-1)]:
            with self.assertRaises(ValidationError):LoadHandling(events=[{**e,'rigging':dict(mass_kg=1000,legs=[{**leg,**patch}])}],lifting_points=[(0,0,0)])
    def test_secondary_carrier_graph(self):
        a,b,c=item(),item(),item()
        a['load_handling']=dict(lifting_points=[(0,0,0)],events=[{**event(b['id']),'slings':True,'rigging':dict(mass_kg=1000,legs=[dict(point=0,parent_id=c['id'],length=4)])}])
        args=dict(command_id=uuid4(),expected_revision=0)
        SceneEdit(items=[a,b,c],**args)
        with self.assertRaises(ValidationError):SceneEdit(items=[a,b],**args)
        c['load_handling']=dict(events=[event(a['id'])])
        with self.assertRaises(ValidationError):SceneEdit(items=[a,b,c],**args)
