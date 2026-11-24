import pytest
from app.services.site_scene import evaluate
from app.schemas.site_scene import SiteItem
from uuid import uuid4


def rect(x,z,w,d):
    return [(x,z),(x+w,z),(x+w,z+d),(x,z+d)]


def slab(ref,height,outer,*holes):
    return dict(ref=ref,name=ref,elevation=height,rings=[outer,*holes])


def layout(refs, edits=None, axis='y'):
    item=SiteItem(id=uuid4(),name='Perimeter',kind='fence',up_axis=axis,
        position=dict(x=0,y=0,z=0),height=2,module_length=2.5,enclosure=dict(style='scaffold',
        scaffold=dict(slabs=refs,base_elevation=0,bay_edits=edits or {},netted=True)))
    return evaluate(item.model_dump(mode='json'))['layout']


@pytest.mark.parametrize("axis",["y","z"])
def test_aligned_floors_measured_rises_and_local_opening(axis):
    outline=rect(0,0,10,8)
    refs=[slab('roof',7,outline),slab('ground',0,outline),slab('first',3,outline)]
    model=layout(refs,axis=axis)
    assert all(b['status']=='supported' for b in model['reference_bays'])
    assert {p['rise'] for p in model['panels']}=={1.5,2}
    assert len(model['scaffold_corners'])==16
    lower=next(b for b in model['reference_bays'] if b['elevation']==3)
    model=layout(refs,{lower['key']:'gap'},axis)
    assert sum(b['status']=='gap' for b in model['reference_bays'])==1
    assert any(b['status']=='review' and b['elevation']==7 for b in model['reference_bays'])
    assert all(p['a'][axis] in (0,3) for p in model['panels'])
    stairs=layout(refs,{lower['key']:'stairs'},axis)
    assert sum(bool(p['stairs']) for p in stairs['panels'])==1


def test_terrace_opening_and_overhang():
    lower=rect(-6,-6,22,20)
    upper=rect(0,0,10,8)
    refs=[slab('G',0,lower),slab('L1',3,lower),slab('L2',6,upper)]
    assert all(b['status']=='supported' for b in layout(refs)['reference_bays'])
    refs[1]=slab('L1',3,lower,rect(-2,-2,2,3))
    assert any(b['status']=='review' and b['elevation']==6 for b in layout(refs)['reference_bays'])
    refs[2]=slab('L2',6,rect(13,0,10,8))
    assert any(b['status']=='review' and b['elevation']==6 for b in layout(refs)['reference_bays'])


async def test_preview_save_and_reload_without_a_drawn_path(client, project):
    refs=[slab('L0',0,rect(0,0,10,8)),slab('L1',3,rect(0,0,10,8)),slab('L2',6,rect(0,0,10,8))]
    recipe=SiteItem(id=uuid4(),name='Tower scaffold',kind='fence',up_axis='z',
        position=dict(x=0,y=0,z=0),height=2,module_length=2.5,
        enclosure=dict(style='scaffold',scaffold=dict(slabs=refs,base_elevation=0))).model_dump(mode='json')
    url=f'/api/v1/site-scenes/{project.id}'
    preview=await client.post(url+'/preview',json=recipe)
    assert preview.status_code==200,preview.text
    selected=preview.json()['layout']['reference_bays'][0]['key']
    recipe['enclosure']['scaffold']['bay_edits']={selected:'gap'}
    saved=await client.put(url,json=dict(expected_revision=0,command_id=str(uuid4()),items=[recipe]))
    assert saved.status_code==200,saved.text
    loaded=(await client.get(url)).json()['items'][0]
    assert loaded['path_id'] is None and loaded['enclosure']['scaffold']['slabs']==recipe['enclosure']['scaffold']['slabs']
    assert any(b['key']==selected and b['status']=='gap' for b in loaded['layout']['reference_bays'])
    assert any(b['elevation']==6 and b['status']=='review' for b in loaded['layout']['reference_bays'])


def test_adjacent_slabs_remove_seam_and_preserve_stable_bay_edits():
    r=rect(0,0,10,8)
    a,b=slab('a',3,rect(0,0,5,8)),slab('b',3,rect(5,0,5,8))
    alone=layout([slab('G',0,r),slab('L1',3,r)])
    split=layout([b,slab('G',0,r),a])
    assert {b['key'] for b in alone['reference_bays']}=={b['key'] for b in split['reference_bays']}
    assert all(b['status']=='supported' for b in split['reference_bays'])
