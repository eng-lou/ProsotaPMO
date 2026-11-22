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

    def test_articulated_phase_links_and_keys_survive_json(self):
        row = {**self.row(), **{k: uuid4() for k in ['climb_activity_id', 'pour_activity_id', 'strip_activity_id']}}
        key = dict(date='2026-11-22T08:00:00Z', deployment=0.75, slew=-40)
        cfg = ClimbingFormwork(axis='z', mode='articulated', lifts=[row], boom_keys=[key])
        self.assertEqual(ClimbingFormwork.model_validate_json(cfg.model_dump_json()), cfg)
        for keys in [[key, key], [{**key,'date':'2026-11-22'}], [{**key,'deployment':1.1}]]:
            with self.assertRaises(ValidationError):
                ClimbingFormwork(axis='z', boom_keys=keys)

    def test_legacy_signature(self):
        value=ClimbingFormwork(axis='z',lifts=[self.row()]).model_dump(mode='json')
        self.assertEqual(set(value),{'axis','reference_elevation','lifts'})
        self.assertEqual(set(value['lifts'][0]),{'id','activity_id','height','duration_hours','start','finish'})

    def test_pour_channels_roundtrip_and_validation(self):
        row = self.row()
        sweep = dict(start_angle=-55, finish_angle=80)
        keys = [dict(progress=.2, slew=-40), dict(progress=.8, deployment=.65, slew=90)]
        cfg = ClimbingFormwork(axis='y', mode='articulated', lifts=[{**row,'pour_keys':keys}], pour_sweep=sweep)
        self.assertEqual(ClimbingFormwork.model_validate_json(cfg.model_dump_json()), cfg)
        self.assertIsNone(cfg.lifts[0].pour_keys[0].deployment)
        for invalid in ([keys[0],keys[0]], [dict(progress=.5)], [dict(progress=1.2,slew=0)],
                        [dict(progress=0,deployment=-.1)], [dict(progress=.5,slew=200)]):
            with self.subTest(keys=invalid), self.assertRaises(ValidationError):
                ClimbingFormwork(axis='y', lifts=[{**row,'pour_keys':invalid}])
        with self.assertRaises(ValidationError):
            ClimbingFormwork(axis='y', pour_sweep={**sweep,'start_angle':float('nan')})
