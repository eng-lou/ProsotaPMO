import unittest
from uuid import uuid4
from pydantic import ValidationError
from app.schemas.work_sequence import WorkSequence
from app.schemas.site_scene import SceneEdit, SiteItem
class WorkTests(unittest.TestCase):
    def config(self):
        return dict(kind='tbm',axis='z',offset=dict(x=0,y=0,z=0),path_id=uuid4(),steps=[dict(id=uuid4(),activity_id=uuid4(),start_chainage=0,end_chainage=10,position=dict(x=0,y=0,z=0),depth=10,travel_hours=0)])
    def item(self,**patch):
        return dict(id=uuid4(),name='Machine',kind='asset',asset_id=uuid4(),up_axis='z',position=dict(x=0,y=0,z=0),**patch)
    def test_round_trip_uses_public_field_names(self):
        c=WorkSequence(**self.config());payload=c.model_dump(mode='json');self.assertIn('start_chainage',payload['steps'][0]);self.assertEqual(WorkSequence.model_validate_json(c.model_dump_json()),c)
    def test_invalid_ranges_dates_and_duplicates(self):
        for patch in [dict(depth=0),dict(end_chainage=0),dict(travel_hours=-1),dict(start='2026-11-20T00:00:00'),dict(position=dict(x=float('nan'),y=0,z=0))]:
            c=self.config();c['steps'][0].update(patch)
            with self.assertRaises(ValidationError):WorkSequence(**c)
        c=self.config();c['steps']*=2
        with self.assertRaises(ValidationError):WorkSequence(**c)
    def test_machine_conflict(self):
        with self.assertRaises(ValidationError):SiteItem(**self.item(work_sequence=self.config(),climbing_formwork=dict(axis='z')))
    def test_visual_target_integrity(self):
        c=self.config();target=self.item();c['steps'][0]['excavation_id']=target['id'];machine=self.item(work_sequence=c)
        scene=dict(command_id=uuid4(),expected_revision=0,items=[machine,target]);SceneEdit(**scene)
        with self.assertRaises(ValidationError):SceneEdit(**{**scene,'items':[machine]})
        with self.assertRaises(ValidationError):SceneEdit(**{**scene,'items':[machine,target,self.item(work_sequence=c)]})
    def test_tool_depth_limit(self):
        c=self.config();c.update(kind='piling',tool_control='auger',tool_travel=5)
        with self.assertRaises(ValidationError):WorkSequence(**c)
