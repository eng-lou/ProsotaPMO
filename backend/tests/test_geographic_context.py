import math
import pytest
from pydantic import ValidationError
from app.services.geographic_context import reconstruct, metres, query_bounds
from app.schemas.geographic_context import GeographicContext

def feature(id,points,tags):
    return {'type':'way','id':id,'geometry':[{'lat':y/111320,'lon':x/111320} for x,y in points],'tags':tags}

def test_footprints_courtyards_and_estimates():
    outer=feature(1,[(-20,-20),(20,-20),(20,20),(-20,20),(-20,-20)],{'building':'industrial'})
    inner=feature(2,[(-5,-5),(5,-5),(5,5),(-5,5),(-5,-5)],{})
    relation={'type':'relation','id':3,'tags':{'type':'multipolygon','building':'industrial','height':'30 ft','roof:shape':'flat'},'members':[{'type':'way','ref':f['id'],'role':r,'geometry':f['geometry']} for f,r in [(outer,'outer'),(inner,'inner')]]}
    result=reconstruct({'elements':[outer,inner,relation]},0,0,100,100)
    assert len(result.features)==1
    f=result.features[0]
    assert len(f.holes)==1 and f.height==pytest.approx(9.144)
    assert f.height_basis=='mapped height' and f.roof_basis=='mapped'

def test_clip_keeps_coordinates_in_study_and_reports_estimates():
    elements=[feature(1,[(-80,-20),(20,-20),(20,20),(-80,20),(-80,-20)],{'building':'yes'}),feature(2,[(-80,0),(80,0)],{'highway':'secondary'})]
    result=reconstruct({'elements':elements},0,0,100,100)
    assert len(result.features)==2
    assert all(f.cropped for f in result.features)
    assert all(-50<=x<=50 and -50<=y<=50 for f in result.features for x,y in f.points)
    assert result.features[0].height_basis=='estimated'
    assert result.features[1].width==12

def test_schema_rejects_nonfinite_duplicate_and_oversized_requests():
    data=reconstruct({'elements':[feature(1,[(0,0),(10,0),(10,10),(0,0)],{'building':'house'})]},0,0,100,100).model_dump()
    data['features'][0]['height']=float('nan')
    with pytest.raises(ValidationError):GeographicContext.model_validate(data)
    data['features'][0]['height']=8
    data['features']*=2
    with pytest.raises(ValidationError):GeographicContext.model_validate(data)
    with pytest.raises(ValueError):query_bounds(0,180,100,100)

def test_incomplete_response_not_published():
    with pytest.raises(ValueError):reconstruct({'remark':'runtime error: timeout','elements':[]},0,0,100,100)
    assert metres('not measured',8)==8

def test_parking_estimates_do_not_cover_buildings():
    from shapely.geometry import Polygon
    building=feature(1,[(-10,-10),(10,-10),(10,10),(-10,10),(-10,-10)],{'building':'yes'})
    aisles=[feature(2,[(-30,-20),(30,-20)],{'highway':'service','service':'parking_aisle'}),feature(3,[(-30,20),(30,20)],{'highway':'service','service':'parking_aisle'})]
    result=reconstruct({'elements':[building,*aisles]},0,0,100,100)
    shape=Polygon(result.features[0].points)
    parking=[f for f in result.features if f.category=='estimated_parking']
    assert parking
    assert all(Polygon(f.points,f.holes).intersection(shape).area==0 for f in parking)
