import pytest
import ifcopenshell
from app.services.ifc_revision_worker import compare, merge, preview


def fixture():
    f = ifcopenshell.file(schema='IFC4')
    metre = f.create_entity('IfcSIUnit', UnitType='LENGTHUNIT', Name='METRE')
    area = f.create_entity('IfcSIUnit', UnitType='AREAUNIT', Name='SQUARE_METRE')
    units = f.create_entity('IfcUnitAssignment', Units=[metre, area])
    f.create_entity('IfcProject', GlobalId=ifcopenshell.guid.new(), Name='Test', UnitsInContext=units)
    origin = f.create_entity('IfcAxis2Placement3D', Location=f.create_entity('IfcCartesianPoint', Coordinates=(0., 0., 0.)))
    context = f.create_entity('IfcGeometricRepresentationContext', ContextType='Model', CoordinateSpaceDimension=3, Precision=1e-5, WorldCoordinateSystem=origin)
    for name in ('Wall A', 'Wall B'):
        profile = f.create_entity('IfcRectangleProfileDef', ProfileType='AREA', XDim=2., YDim=.2)
        solid = f.create_entity('IfcExtrudedAreaSolid', SweptArea=profile, Position=origin, ExtrudedDirection=f.create_entity('IfcDirection', DirectionRatios=(0.,0.,1.)), Depth=3.)
        representation = f.create_entity('IfcShapeRepresentation', ContextOfItems=context, RepresentationIdentifier='Body', RepresentationType='SweptSolid', Items=[solid])
        f.create_entity('IfcWall', GlobalId=ifcopenshell.guid.new(), Name=name,
                        ObjectPlacement=f.create_entity('IfcLocalPlacement', RelativePlacement=origin),
                        Representation=f.create_entity('IfcProductDefinitionShape', Representations=[representation]))
    return f


def test_no_false_changes_for_renumbered_serialisation():
    old = fixture()
    new = ifcopenshell.file.from_string(old.to_string())
    assert compare(old, new)['changes'] == []


def test_mixed_accept_reject_preserves_rejected_geometry_and_identity():
    old = fixture()
    new = ifcopenshell.file.from_string(old.to_string())
    a, b = new.by_type('IfcWall')
    a.Name = 'Changed wall'
    a.Representation.Representations[0].Items[0].Depth = 4.
    removed_guid = b.GlobalId
    new.remove(b)
    added = new.create_entity('IfcWall', GlobalId=ifcopenshell.guid.new(), Name='New wall')
    changes = compare(old, new)['changes']
    assert {c['kind'] for c in changes} == {'modified','removed','added'}
    result = merge(old, new, {c['guid']: {'action': 'reject' if c['kind']=='removed' else 'accept', 'rationale': 'Retain existing wall'} for c in changes})
    assert result.by_guid(a.GlobalId).Name == 'Changed wall'
    assert result.by_guid(a.GlobalId).Representation.Representations[0].Items[0].Depth == 4.
    assert result.by_guid(removed_guid).Name == 'Wall B'
    assert result.by_guid(added.GlobalId).Name == 'New wall'
    remaining = compare(result, new)['changes']
    assert len(remaining)==1 and remaining[0]['kind']=='removed'


def test_rationale_and_complete_decisions_required():
    old=fixture(); new=ifcopenshell.file.from_string(old.to_string()); new.by_type('IfcWall')[0].Name='Changed'
    with pytest.raises(ValueError, match='explicit decision'): merge(old,new,{})
    with pytest.raises(ValueError, match='rationale'): merge(old,new,{new.by_type('IfcWall')[0].GlobalId:{'action':'reject'}})


def test_accept_removal_and_visual_geometry():
    old=fixture(); new=ifcopenshell.file.from_string(old.to_string()); wall=new.by_type('IfcWall')[0]; guid=wall.GlobalId
    shape=preview(old,guid)
    assert len(shape['faces'])>0 and max(shape['vertices'])==3.
    new.remove(wall)
    result = merge(old,new,{guid:{'action':'accept'}})
    with pytest.raises(RuntimeError): result.by_guid(guid)


def test_units_change_is_not_silently_merged():
    old=fixture(); new=ifcopenshell.file.from_string(old.to_string())
    next(u for u in new.by_type('IfcSIUnit') if u.UnitType=='LENGTHUNIT').Prefix='MILLI'
    with pytest.raises(ValueError,match='units'): compare(old,new)


def test_all_rejected_retains_original_content():
    old=fixture(); original=old.to_string(); new=ifcopenshell.file.from_string(original)
    wall=new.by_type('IfcWall')[0]; wall.Name='Changed'
    result=merge(old,new,{wall.GlobalId:{'action':'reject','rationale':'Not approved'}})
    assert result.to_string()==original


def test_duplicate_and_unrelated_identities_fail_closed():
    old=fixture(); new=fixture()
    with pytest.raises(ValueError,match='No element GlobalIds'): compare(old,new)
    new=ifcopenshell.file.from_string(old.to_string())
    new.by_type('IfcWall')[1].GlobalId=new.by_type('IfcWall')[0].GlobalId
    with pytest.raises(ValueError,match='duplicate'): compare(old,new)


def test_area_is_explicit_ifc_quantity_not_bounding_box():
    from app.services.ifc_revision_worker import area_of
    f=fixture(); wall=f.by_type('IfcWall')[0]
    assert area_of(wall,f) is None
    square_mm=f.create_entity('IfcSIUnit',UnitType='AREAUNIT',Prefix='MILLI',Name='SQUARE_METRE')
    q=f.create_entity('IfcQuantityArea',Name='NetSideArea',Unit=square_mm,AreaValue=6000000.)
    group=f.create_entity('IfcElementQuantity',GlobalId=ifcopenshell.guid.new(),Name='Qto_WallBaseQuantities',Quantities=[q])
    f.create_entity('IfcRelDefinesByProperties',GlobalId=ifcopenshell.guid.new(),RelatedObjects=[wall],RelatingPropertyDefinition=group)
    assert area_of(wall,f)['m2']==6


def test_zero_area_remains_zero():
    from app.services.ifc_revision_worker import area_of
    f=fixture();wall=f.by_type('IfcWall')[0]
    q=f.create_entity('IfcQuantityArea',Name='NetArea',AreaValue=0.)
    group=f.create_entity('IfcElementQuantity',GlobalId=ifcopenshell.guid.new(),Name='Qto',Quantities=[q])
    f.create_entity('IfcRelDefinesByProperties',GlobalId=ifcopenshell.guid.new(),RelatedObjects=[wall],RelatingPropertyDefinition=group)
    assert area_of(wall,f)['m2']==0


def test_selective_merge_retains_surface_style_and_project_context():
    old=fixture();a,b=old.by_type('IfcWall')
    solid=a.Representation.Representations[0].Items[0]
    colour=old.create_entity('IfcColourRgb',Red=.8,Green=.8,Blue=.8)
    shading=old.create_entity('IfcSurfaceStyleShading',SurfaceColour=colour)
    style=old.create_entity('IfcSurfaceStyle',Name='Finish',Side='BOTH',Styles=[shading])
    old.create_entity('IfcStyledItem',Item=solid,Styles=[style])
    new=ifcopenshell.file.from_string(old.to_string())
    new.by_type('IfcColourRgb')[0].Red=.1
    removed=b.GlobalId;new.remove(new.by_guid(removed))
    report=compare(old,new)
    assert 'appearance' in next(c for c in report['changes'] if c['guid']==a.GlobalId)['fields']
    guid=a.GlobalId
    result=merge(old,new,{guid:{'action':'accept'},removed:{'action':'reject','rationale':'Retain wall'}})
    representation=result.by_guid(guid).Representation.Representations[0]
    assert representation.Items[0].StyledByItem[0].Styles[0].Styles[0].SurfaceColour.Red==.1
    assert len(result.by_type('IfcGeometricRepresentationContext'))==1
