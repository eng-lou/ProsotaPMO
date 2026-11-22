from copy import deepcopy
import unittest
from uuid import uuid4

from pydantic import ValidationError

from app.schemas.equipment_rig import Definition


class TestCraneSweeps(unittest.TestCase):
    def setUp(self):
        self.rig = {
            'controls': [dict(id='slew', name='Slew', value=0)],
            'joints': [dict(id='jib', name='Jib', control='slew', node='/0:Jib', kind='hinge',
                            axis=[0, 0, 1], pivot=[0, 0, 0], minimum=0, maximum=180)],
        }
        self.sweep = dict(activity_id=str(uuid4()), control='slew', start_value=.25, end_value=.75,
                          cycles=2, enabled=True, keys=[dict(progress=.4, value=.8)])

    def test_legacy_rig_and_schedule_relative_keys_round_trip(self):
        self.assertEqual(Definition(**self.rig).crane_sweeps, [])
        rig = Definition(**self.rig, crane_sweeps=[self.sweep])
        self.assertEqual(rig.model_dump(mode='json')['crane_sweeps'], [self.sweep])
        self.assertEqual(Definition.model_validate_json(rig.model_dump_json()), rig)

    def test_reject_invalid_ranges_keys_and_assignments(self):
        for changes in [dict(cycles=0), dict(cycles=1.5), dict(end_value=2),
                        dict(keys=self.sweep['keys'] * 2), dict(control='missing')]:
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                Definition(**self.rig, crane_sweeps=[{**self.sweep, **changes}])
        with self.assertRaises(ValidationError):
            Definition(**self.rig, crane_sweeps=[self.sweep, self.sweep])
        rig = deepcopy(self.rig)
        rig['joints'][0]['kind'] = 'slide'
        with self.assertRaises(ValidationError):
            Definition(**rig, crane_sweeps=[self.sweep])
