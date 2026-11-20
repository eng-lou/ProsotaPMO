import unittest
from uuid import uuid4
from pydantic import ValidationError
from app.schemas.climbing_formwork import ClimbingFormwork
from app.schemas.site_scene import SiteItem

class ClimbTests(unittest.TestCase):
    def row(self):return dict(id=uuid4(),activity_id=uuid4(),height=3.5,duration_hours=12)
    def test_round_trip(self):
        c=ClimbingFormwork(axis='z',lifts=[self.row()])
        self.assertEqual(ClimbingFormwork.model_validate_json(c.model_dump_json()),c)
    def test_invalid(self):
        for patch in ({'height':float('nan')},{'duration_hours':0},{'activity_id':None},{'start':'2026-11-01T00:00:00'}):
            with self.assertRaises(ValidationError):ClimbingFormwork(axis='z',lifts=[{**self.row(),**patch}])
        row=self.row()
        with self.assertRaises(ValidationError):ClimbingFormwork(axis='z',lifts=[row,row])
    def test_attachment_conflict(self):
        data=dict(id=uuid4(),name='Formwork',kind='asset',asset_id=uuid4(),generator_version=1,up_axis='y',position=dict(x=0,y=0,z=0),climbing_formwork=dict(axis='z',lifts=[self.row()]),load_handling=dict(events=[dict(id=uuid4(),date='2026-11-01T00:00:00Z',matrix=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1])]))
        with self.assertRaises(ValidationError):SiteItem(**data)
