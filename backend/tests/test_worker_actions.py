import copy
import unittest
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.schemas.site_scene import SiteItem,SceneEdit
from app.services.site_scene import evaluate

def uid(n): return f'00000000-0000-0000-0000-{n:012d}'
def actor(n=1): return dict(id=uid(n),name='Worker',kind='asset',asset_id=uid(99),up_axis='z',position=dict(x=0,y=0,z=0))
def action(): return dict(id=uid(3),name='Drill',start='2026-10-29T00:00:05Z',end='2026-10-29T00:00:12Z',clip=2,speed=1,loop=True,blend=.2)

class WorkerActionsTests(unittest.TestCase):
 def test_roundtrip_actions_and_attachment(self):
  worker=actor();worker['motion_actions']=[action()]
  tool=actor(2);tool['attachment']=dict(parent_id=uid(1),node='CC_Base_R_Hand',start=action()['start'],end=action()['end'],position=dict(x=.1,y=0,z=0),rotation=dict(x=0,y=90,z=0),only_during=True)
  values=[evaluate(SiteItem.model_validate(i).model_dump(mode='json')) for i in [worker,tool]]
  # Storage and undo both roundtrip the complete JSON recipe.
  for value in values: value.pop('layout',None)
  saved=SceneEdit(items=values,command_id=uid(8),expected_revision=0).model_dump_json()
  restored=SceneEdit.model_validate_json(saved)
  self.assertEqual(restored.items[0].motion_actions[0].clip,2)
  self.assertEqual(str(restored.items[1].attachment.parent_id),uid(1))
  self.assertEqual(restored.items[1].attachment.position.x,.1)
 def test_invalid_action_and_overlap(self):
  for patch in [dict(end=action()['start']),dict(start='2026-10-29T00:00:05'),dict(speed=float('nan')),dict(clip=-1)]:
   with self.subTest(patch=patch),self.assertRaises(ValueError):SiteItem(**actor(),motion_actions=[{**action(),**patch}])
  with self.assertRaises(ValueError):SiteItem(**actor(),motion_actions=[action(),{**action(),'id':uid(4)}])
 def test_attachment_cycles_missing_parent_and_own_route(self):
  a,b=actor(),actor(2);attachment=dict(parent_id=uid(1),node='',start=action()['start'],end=action()['end'])
  b['attachment']=attachment
  with self.assertRaisesRegex(ValueError,'parent'):SceneEdit(items=[b],command_id=uid(8),expected_revision=0)
  a['attachment']={**attachment,'parent_id':uid(2)}
  with self.assertRaisesRegex(ValueError,'cycle'):SceneEdit(items=[a,b],command_id=uid(8),expected_revision=0)
  b['path_motion']=dict(path_id=uid(6),start=action()['start'])
  with self.assertRaises(ValueError):SiteItem.model_validate(b)

if __name__=='__main__':unittest.main()
