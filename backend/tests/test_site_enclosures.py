"""Site enclosure recipes are pinned to a path snapshot and use metre chainage."""
import copy
import unittest
from uuid import uuid4
from app.schemas.site_scene import SceneEdit, SiteItem
from app.services.site_scene import evaluate


def fence(**changes):
    values = dict(id=uuid4(), name="Entrance", kind="fence", up_axis="y", position=dict(x=0,y=0,z=0),
                  path_id=uuid4(), points=[dict(x=0,y=2,z=0),dict(x=20,y=2,z=0)],
                  enclosure=dict(style="hoarding", levels=[0,3.5], openings=[
                      dict(kind="vehicle", start=4,width=5,angle=70,board="Prosota",lights=True),
                      dict(kind="gap",start=10,width=1),dict(kind="turnstile",start=18.5,width=1.5)]))
    return SiteItem(**{**values, **changes})


class EnclosureTests(unittest.TestCase):
    def test_command_save_reload_and_source_immutability(self):
        item=fence()
        command=SceneEdit(command_id=uuid4(),expected_revision=1,items=[item])
        data=item.model_dump(mode="json")
        before=copy.deepcopy(data)
        layout=evaluate(data)["layout"]
        restored=SceneEdit.model_validate_json(command.model_dump_json()).items[0]
        self.assertEqual(evaluate(restored.model_dump(mode="json"))["layout"],layout)
        self.assertEqual(data,before)
        self.assertEqual(layout["gate_width"],7.5)
        self.assertEqual(len(layout["openings"]),6)
        self.assertEqual(len({p["id"] for p in layout["panels"]}),len(layout["panels"]))
        for y in [2,5.5]:
            panels=[p for p in layout["panels"] if p["a"]["y"]==y]
            self.assertAlmostEqual(sum(p["b"]["x"]-p["a"]["x"] for p in panels),12.5)
            for cut in layout["openings"]:
                for p in panels:
                    self.assertTrue(p["b"]["x"]<=cut["start"] or p["a"]["x"]>=cut["start"]+cut["width"])

    def test_overlaps_corners_curve_and_total_limit(self):
        def layout(points, openings, **settings):
            return evaluate(fence(points=[dict(x=x,y=0,z=z,segment_mode=mode) for x,z,mode in points],
                                  enclosure=dict(openings=openings,**settings)).model_dump(mode="json"))["layout"]
        points=[(0,0,None),(10,0,"straight"),(18,8,"curved")]
        self.assertEqual(layout(points,[dict(kind="vehicle",start=3,width=4)])["openings"][0]["b"]["x"],7)
        for cuts in [[(1,2),(2,2)],[(9,3)],[(11,.25)],[(100,1)]]:
            with self.subTest(cuts=cuts), self.assertRaises(ValueError):
                layout(points,[dict(kind="gap",start=x,width=w) for x,w in cuts])
        with self.assertRaisesRegex(ValueError,"2,000"):
            layout([(0,0,None),(100,0,"straight")],[],levels=list(range(42)))

    def test_gate_can_cross_collinear_waypoint(self):
        item=fence(points=[dict(x=x,y=0,z=0) for x in [0,5,20]])
        opening=evaluate(item.model_dump(mode="json"))["layout"]["openings"][0]
        self.assertEqual((opening["a"]["x"],opening["b"]["x"]),(4,9))

    def test_closed_z_up_and_end_to_end_openings(self):
        corners=[dict(x=x,y=y,z=1) for x,y in [(0,0),(8,0),(8,8),(0,8)]]
        item=fence(up_axis="z",points=corners,closed=True,enclosure=dict(style="edge",levels=[3],openings=[
            dict(kind="pedestrian",start=24,width=1),dict(kind="gap",start=25,width=7)]))
        layout=evaluate(item.model_dump(mode="json"))["layout"]
        self.assertEqual(layout["openings"][-1]["b"],dict(x=0,y=0,z=4))
        self.assertEqual(layout["panel_count"],12)

    def test_hoarding_closure_and_repeated_corner_clicks(self):
        for up, horizontal in [("y", "z"), ("z", "y")]:
            corners = [{"x": x, horizontal: y, up: 3} for x, y in [(0, 0), (12, 0), (12, 8), (0, 8)]]
            item = fence(up_axis=up, points=corners, closed=True, module_length=2.4, height=2.4,
                         enclosure=dict(style="hoarding", levels=[0], openings=[
                             dict(kind="vehicle", start=0, width=5, angle=0, lights=True)])).model_dump(mode="json")
            expected = evaluate(item)["layout"]
            self.assertEqual(expected["length"], 40)
            self.assertEqual(expected["openings"][0]["b"]["x"], 5)
            for closed in (False, True):
                for delta in (0, 0.0004):
                    with self.subTest(up=up, closed=closed, delta=delta):
                        points = [corners[0], corners[1], {**corners[1], horizontal: delta},
                                  *corners[2:], {**corners[0], "x": delta}]
                        variant = {**item, "closed": closed, "points": points}
                        original = copy.deepcopy(variant)
                        self.assertEqual(evaluate(variant)["layout"], expected)
                        self.assertEqual(variant, original)

    def test_repeated_end_preserves_authored_closing_curve(self):
        corners = [dict(x=x, y=0, z=z, segment_mode="straight") for x, z in [(0, 0), (12, 0), (12, 8), (0, 8)]]
        end = {**corners[0], "segment_mode": "curved",
               "segment_controls": [dict(x=-3, y=0, z=0), dict(x=-3, y=0, z=0)]}
        item = fence(points=[end, *corners[1:]], closed=True, enclosure=dict(openings=[])).model_dump(mode="json")
        expected = evaluate(item)["layout"]
        self.assertGreater(expected["length"], 40)
        self.assertEqual(evaluate({**item, "points": [*corners, end]})["layout"], expected)
        loop = {**end, "segment_controls": [dict(x=12, y=0, z=0), dict(x=0, y=0, z=12)]}
        two_points = {**item, "points": [corners[0], loop]}
        self.assertGreater(evaluate(two_points)["layout"]["length"], 10)
        self.assertEqual(evaluate(two_points)["layout"], evaluate({**two_points, "closed": False})["layout"])

    def test_crossings_degenerate_paths_and_overlaps(self):
        def layout(coords, closed=False):
            return evaluate(fence(points=[dict(x=x, y=y, z=z) for x, y, z in coords],
                                  closed=closed, enclosure=dict(openings=[])).model_dump(mode="json"))

        with self.assertRaisesRegex(ValueError, r"intersects itself.*0\.00–10\.00 m and 18\.00–28\.00 m"):
            layout([(0,0,0), (8,0,6), (0,0,6), (8,0,0)])
        with self.assertRaisesRegex(ValueError, "level path"):
            layout([(0,0,0), (8,0,6), (0,3,6), (8,3,0)])
        with self.assertRaisesRegex(ValueError, "distinct points"):
            layout([(0,0,0), (0,0,0)], closed=True)
        with self.assertRaisesRegex(ValueError, "intersects|doubles back"):
            layout([(0,0,0), (8,0,0), (8,0,8), (2,0,8), (2,0,0), (0,0,0)])
        with self.assertRaisesRegex(ValueError, "intersects"):
            layout([(0,0,0), (8,0,0), (8,0,8), (4,0,0)])

    def test_old_fence_and_explicitly_empty_openings(self):
        old=fence(enclosure=None,gate_start=4,gate_width=2).model_dump(mode="json")
        old.pop("enclosure"); old.pop("tower_cover")
        legacy=evaluate(old)["layout"]
        self.assertEqual(legacy["panel_count"],9)
        self.assertNotIn("openings",legacy)
        self.assertEqual(legacy["panels"][0]["id"],old["id"]+":panel:0.000000")
        self.assertEqual(evaluate({**old,"enclosure":dict(openings=[],levels=[0],style="plain")})["layout"]["panel_count"],10)

    def test_tower_recipe_roundtrip_and_scope(self):
        asset=dict(id=uuid4(),asset_id=uuid4(),kind="asset",name="Tower",up_axis="z",position=dict(x=0,y=0,z=0))
        cover=dict(style="netted",width=3.3,depth=2.9,height=18,offset=dict(x=.1,y=.2,z=-.2))
        item=SiteItem(**asset,tower_cover=cover)
        self.assertEqual(SiteItem.model_validate_json(item.model_dump_json()),item)
        self.assertIsNone(SiteItem(**asset).tower_cover)
        with self.assertRaises(ValueError): fence(tower_cover=cover)
        with self.assertRaises(ValueError): SiteItem(**asset,tower_cover={**cover,"height":-1})
        with self.assertRaises(ValueError): fence(enclosure=dict(levels=[0,0]))
