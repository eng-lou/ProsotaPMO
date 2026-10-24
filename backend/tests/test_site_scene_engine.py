"""Pure geometry acceptance fixtures; no application/database configuration."""
import unittest
import copy
from types import SimpleNamespace
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.site_scene import fence_layout, evaluate, generated_layout, sample_path, zone_points
from app.schemas.site_scene import SiteItem, SceneEdit


def fixture():
    return SiteItem(id="00000000-0000-0000-0000-000000000001", name="Fence", kind="fence", up_axis="z",
        position={"x":0,"y":0,"z":0}, path_id="00000000-0000-0000-0000-000000000002",
        points=[{"x":0,"y":0,"z":0},{"x":12,"y":0,"z":0}], gate_start=4, gate_width=2).model_dump(mode="json")


class SiteGeometryTests(unittest.TestCase):
    def test_path_motion_roundtrip_and_validation(self):
        item = fixture()
        item['path_motion'] = dict(path_id=item['path_id'], start='2026-10-23T00:00:00Z', speed=1.4,
                                  loop=False, orient=True, heading=-90, animation_reference_speed=1.4, bind_origin={'x':23.,'y':-15.,'z':-31.})
        parsed = SiteItem.model_validate(item)
        self.assertEqual(parsed.model_dump(mode='json')['path_motion'], item['path_motion'])
        self.assertEqual(evaluate(parsed.model_dump(mode='json'))['path_motion'], item['path_motion'])
        legacy = {k:v for k,v in item['path_motion'].items() if k != 'bind_origin'}
        self.assertIsNone(SiteItem.model_validate({**item, 'path_motion':legacy}).path_motion.bind_origin)
        for patch in ({'bind_origin': {'x':float('nan'),'y':0,'z':0}}, {'speed': 0}, {'speed': float('nan')}, {'animation_reference_speed': 0}, {'start': 'not-a-date'}):
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                SiteItem.model_validate({**item, 'path_motion': {**item['path_motion'], **patch}})

    def test_asset_transform_roundtrip_and_legacy_defaults(self):
        item = fixture()
        item.update(kind='asset', asset_id='00000000-0000-0000-0000-000000000003')
        item.pop('rotation', None)
        item.pop('scale', None)
        parsed = SiteItem.model_validate(item)
        self.assertEqual(parsed.scale.x, 1)
        self.assertEqual(parsed.rotation.z, 0)
        item.update(rotation={'x': .2, 'y': -.3, 'z': 1.5}, scale={'x': 2, 'y': .5, 'z': 3})
        self.assertEqual(SiteItem.model_validate(item).model_dump()['rotation'], item['rotation'])
        self.assertEqual(SiteItem.model_validate(item).model_dump()['scale'], item['scale'])
        item['scale']['x'] = float('nan')
        with self.assertRaises(ValueError): SiteItem.model_validate(item)

    def test_gate_fixture_and_stable_identity(self):
        item = fixture(); original = copy.deepcopy(item)
        result = fence_layout(item)
        self.assertEqual(result["panel_count"], 5)
        self.assertEqual([p["a"]["x"] for p in result["panels"]], [0,2,6,8,10])
        self.assertEqual(fence_layout(item), result)
        self.assertEqual(item, original)

    def test_axes_and_origin(self):
        item = fixture(); item["up_axis"] = "y"
        for point in item["points"]:
            point["x"] += 12345; point["y"] = 200
        self.assertEqual(fence_layout(item)["panel_count"], 5)
        self.assertEqual(fence_layout(item)["length"], 12)

    def test_invalid_spans_gate_and_slope(self):
        for patch in [{"gate_width":3}, {"gate_start":11}, {"module_length":3}]:
            with self.assertRaises(ValueError): fence_layout({**fixture(), "panel_fit":"strict", **patch})
        item = fixture(); item["points"][1]["z"] = 1
        with self.assertRaisesRegex(ValueError, "level"): fence_layout(item)

    def test_corner_requires_whole_panels_and_gate_on_one_segment(self):
        item = fixture(); item["points"] = [{"x":0,"y":0,"z":0},{"x":6,"y":0,"z":0},{"x":6,"y":6,"z":0}]
        self.assertEqual(fence_layout(item)["panel_count"], 5)
        item["gate_start"] = 5
        with self.assertRaisesRegex(ValueError, "corner"): fence_layout(item)

    def test_intersection_and_nonfinite_input_rejected(self):
        item = fixture(); item["points"] = [{"x":x,"y":y,"z":0} for x,y in [(0,0),(4,4),(0,4),(4,0)]]
        with self.assertRaisesRegex(ValueError, "intersects"): fence_layout(item)
        item = fixture(); item['points'].append({'x': 0, 'y': 0, 'z': 0})
        with self.assertRaisesRegex(ValueError, "doubles back"): fence_layout(item)
        item = fixture(); item["position"]["x"] = float('nan')
        with self.assertRaises(ValueError): SiteItem.model_validate(item)

    def test_circle_zone_uses_elevation_for_both_up_axes(self):
        zone=SimpleNamespace(shape='circle',points=[{'x':10,'y':20,'z':30}],radius=4,elevation=6)
        for up in ('y','z'):
            points=zone_points(zone,up)
            self.assertEqual(len(points),64)
            self.assertTrue(all(p[up]==6 for p in points))
            item={**fixture(),'kind':'shape','up_axis':up,'points':points,'closed':True,'path_id':None,'zone_id':'00000000-0000-0000-0000-000000000003'}
            self.assertEqual(len(evaluate(SiteItem.model_validate(item).model_dump(mode='json'))['layout']['footprint']),64)

    def test_scene_command_validation(self):
        command=SceneEdit(command_id="00000000-0000-0000-0000-000000000099",expected_revision=0,items=[fixture()])
        self.assertEqual(len(command.items),1)

    def test_fitted_and_trimmed_non_module_span(self):
        item=fixture();item.update(gate_width=0,points=[{'x':0,'y':0,'z':0},{'x':6.472,'y':0,'z':0}])
        for fit in ('fit','trim'):
            result=fence_layout({**item,'panel_fit':fit})
            self.assertEqual(result['panel_count'],4)
            self.assertAlmostEqual(result['panels'][-1]['b']['x'],6.472)
        result=fence_layout({**item,'panel_fit':'trim'})
        self.assertAlmostEqual(result['panels'][-1]['b']['x']-result['panels'][-1]['a']['x'],.472)

    def test_shape_array_scatter_and_reproducibility(self):
        item=fixture();item.update(kind='shape',closed=True,points=[{'x':x,'y':y,'z':2} for x,y in [(0,0),(20,0),(20,20),(10,10),(0,20)]])
        parsed=SiteItem.model_validate(item).model_dump(mode='json')
        self.assertEqual(len(evaluate(parsed)['layout']['footprint']),5)
        scattered={**parsed,'kind':'scatter','count':12,'spacing':2,'seed':42}
        first=generated_layout(scattered)
        self.assertEqual(first,generated_layout(scattered))
        self.assertEqual(first['count'],12)
        self.assertTrue(all(p['position']['z']==2 for p in first['placements']))
        self.assertNotEqual(first,generated_layout({**scattered,'seed':43}))
        with self.assertRaisesRegex(ValueError,'Only'): generated_layout({**scattered,'spacing':100})
        array=generated_layout({**parsed,'kind':'array','spacing':5})
        self.assertGreater(array['count'],10)
        with self.assertRaises(ValueError): SiteItem.model_validate({**parsed,'closed':False})

    def test_curved_sampling_and_invalid_shape(self):
        item=fixture();item.update(points=[{'x':x,'y':y,'z':0} for x,y in [(0,0),(5,5),(10,0)]],curve_mode='curved',gate_width=0)
        sampled=sample_path(item)
        self.assertEqual(sampled[0],item['points'][0]);self.assertEqual(sampled[-1],item['points'][-1])
        self.assertGreater(len(sampled),3)
        self.assertLess(fence_layout(item)['panel_count'],20)
        item.update(kind='shape',closed=True,curve_mode='straight',points=[{'x':x,'y':y,'z':0} for x,y in [(0,0),(4,4),(0,4),(4,0)]])
        with self.assertRaisesRegex(ValueError,'intersects'): evaluate(item)


if __name__ == '__main__': unittest.main()
