"""OpenStreetMap vectors -> saved metre-scale context recipes. No imagery/tiles read."""
import math
import re
import json
import zlib
import httpx
from shapely.geometry import Polygon, LineString, Point, box
from shapely.ops import polygonize, unary_union
from app.schemas.geographic_context import GeographicContext

ENDPOINT = 'https://overpass-api.de/api/interpreter'

def metres(value, fallback):
    match = re.fullmatch(r'\s*(\d+(?:\.\d+)?)\s*(m|ft|\x27)?\s*', str(value or ''))
    return float(match[1]) * (.3048 if match[2] in ('ft', "'") else 1) if match else fallback

def query_bounds(lat, lon, width, depth):
    dx = width / 2 / (111320 * math.cos(math.radians(lat)))
    dy = depth / 2 / 111320
    if lon-dx < -180 or lon+dx > 180:
        raise ValueError('Areas crossing the date line are not supported')
    return lat-dy, lon-dx, lat+dy, lon+dx

async def fetch_context(lat, lon, width, depth, provider='main'):
    bbox = ','.join(f'{n:.7f}' for n in query_bounds(lat, lon, width, depth))
    filters = ['building', '"building:part"', 'highway', 'landuse', 'natural', 'leisure', '"amenity"="parking"', 'railway', 'waterway']
    query = '[out:json][timeout:45];(' + ''.join(f'nwr[{f}]({bbox});' for f in filters) + ');out geom;'
    async with httpx.AsyncClient(timeout=60, follow_redirects=False) as client:
        endpoint = ENDPOINT if provider == 'main' else 'https://overpass.private.coffee/api/interpreter'
        async with client.stream('POST', endpoint, data={'data': query}, headers={'User-Agent': 'ProsotaPlanner/1.0 (site-context)'}) as response:
            response.raise_for_status()
            content = bytearray()
            async for chunk in response.aiter_bytes():
                content.extend(chunk)
                if len(content) > 12 * 1024 * 1024:
                    raise ValueError('Map response is too large. Choose a smaller area.')
    return reconstruct(json.loads(content), lat, lon, width, depth)

def reconstruct(data, lat, lon, width, depth):
    if data.get('remark'):
        raise ValueError('The map service did not finish this request. Try a smaller area.')
    bounds = box(-width/2, -depth/2, width/2, depth/2)
    features = []
    def xy(p): return ((p['lon']-lon)*111320*math.cos(math.radians(lat)), (p['lat']-lat)*111320)
    def coords(ring): return [[round(x, 3), round(y, 3)] for x, y in ring.coords][:-1]
    def kind(t):
        if t.get('building:part') not in (None, 'no') or t.get('building') not in (None, 'no'): return 'building'
        if t.get('highway') in ('motorway','trunk','primary','secondary','tertiary','unclassified','residential','service','living_street','pedestrian','footway','path','cycleway','track','steps'): return 'road'
        if t.get('railway') in ('rail','tram','light_rail'): return 'rail'
        if t.get('natural') == 'tree': return 'tree'
        if t.get('natural') in ('water','wetland') or t.get('waterway') in ('riverbank',): return 'water'
        if t.get('natural') in ('wood','scrub') or t.get('landuse') in ('forest',): return 'wood'
        if t.get('landuse') in ('grass','meadow','recreation_ground','village_green','cemetery') or t.get('leisure') in ('park','garden','pitch'): return 'grass'
        if t.get('amenity') == 'parking' or t.get('landuse') in ('industrial','commercial','retail') or t.get('leisure') == 'schoolyard': return 'paving'
        return None
    # Relations own their outer/inner members. Avoid duplicate faces and preserve courtyards.
    relations = [e for e in data.get('elements',[]) if e['type']=='relation' and e.get('tags',{}).get('type')=='multipolygon' and kind(e.get('tags',{}))]
    consumed = {m['ref'] for e in relations for m in e.get('members',[]) if m.get('type')=='way'}
    elements = relations + [e for e in data.get('elements',[]) if e['type']!='relation' and not (e['type']=='way' and e['id'] in consumed)]
    for e in elements:
        t=e.get('tags',{}); k=kind(t)
        if not k: continue
        shapes=[]
        if e['type']=='relation':
            lines={role:[LineString([xy(p) for p in m['geometry']]) for m in e.get('members',[]) if m.get('role','outer')==role and len(m.get('geometry',[]))>=2] for role in ('outer','inner')}
            outers=list(polygonize(unary_union(lines['outer'])))
            inners=list(polygonize(unary_union(lines['inner'])))
            shapes=[p.difference(unary_union(inners)) for p in outers]
        elif k=='tree' and 'lat' in e:
            shapes=[Point(xy(e))]
        elif len(e.get('geometry',[]))>=2:
            points=[xy(p) for p in e['geometry']]
            if k in ('road','rail'): shapes=[LineString(points)]
            elif len(points)>=4 and points[0]==points[-1]: shapes=[Polygon(points)]
        for shape in shapes:
            if not shape.is_valid: shape=shape.buffer(0)
            if shape.is_empty: continue
            clipped=shape.intersection(bounds)
            parts=list(clipped.geoms) if hasattr(clipped,'geoms') else [clipped]
            for p in parts:
                if p.is_empty or p.geom_type not in ('Polygon','LineString','Point'): continue
                if k not in ('tree','road','rail') and (p.geom_type!='Polygon' or p.area<1): continue
                if k in ('road','rail') and (p.geom_type!='LineString' or p.length<1): continue
                category=t.get('building',t.get('highway',t.get('landuse',t.get('natural',k))))
                if k=='road' and t.get('service')=='parking_aisle': category='parking_aisle'
                industrial=category in ('industrial','warehouse','retail','commercial') or (k=='building' and p.area>800 and category=='yes')
                floors=metres(t.get('building:levels'),0)
                height=metres(t.get('height'),0)
                basis='mapped height' if height else 'mapped floors' if floors else 'estimated'
                height=height or floors*(4 if industrial else 3.1) or (9 if industrial else 15 if category=='apartments' else 3 if category in ('shed','garage','service') else 7.5)
                roof=t.get('roof:shape')
                roof=roof if roof in ('flat','gabled','hipped') else 'industrial' if industrial else 'hipped' if category in ('house','terrace','detached','semidetached_house') else 'flat'
                roadwidth=metres(t.get('width'),0) or (metres(t.get('lanes'),0)*3.1) or {'secondary':12,'tertiary':8,'residential':6,'service':4.5,'footway':1.8,'path':1.8,'cycleway':2.5,'steps':2,'rail':1.435}.get(category,6)
                variant=zlib.crc32(str(e['id']).encode())
                color=['#d7d7cf','#b9c5c5','#c5c3b9','#cbd0c8'][variant%4] if industrial else '#b68e75' if t.get('building:material')=='brick' else ['#ded9cd','#c7c8bd','#d4c8b7'][variant%3]
                roof_color=['#bbc3c0','#7d898a','#b1bab7','#626d70','#d3d2c7'][variant%5] if industrial else '#686b68' if roof in ('gabled','hipped') else '#a8b1ad'
                if k=='road': color='#d7d6cc' if category in ('footway','path','cycleway','steps','pedestrian') else '#606a6d'
                elif k in ('grass','wood','water','paving'):
                    color={'grass':'#8a9b67','wood':'#687d4c','water':'#7aa2a6','paving':'#bfc2bb' if category=='industrial' else '#9ca5a1'}[k]
                colors={'white':'#e3e1d6','red':'#b17661','brown':'#8a7769','grey':'#b6b9b7','gray':'#b6b9b7'}
                def colour(key,default):
                    raw=t.get(key,'');return raw if re.fullmatch(r'#[0-9a-fA-F]{6}',raw) else colors.get(raw,default)
                features.append(dict(id=f"{e['type']}/{e['id']}/{len(features)}", name=(t.get('name') or t.get('addr:housename') or category.replace('_',' ').title())[:160],kind=k,category=category[:50],points=coords(p.exterior) if p.geom_type=='Polygon' else [[round(x,3),round(y,3)] for x,y in p.coords],holes=[coords(r) for r in p.interiors] if p.geom_type=='Polygon' else [],height=min(200,height),height_basis=basis,width=min(100,max(.5,roadwidth)),roof=roof,roof_basis='mapped' if t.get('roof:shape') in ('flat','gabled','hipped') else 'estimated',color=colour('building:colour',color),roof_color=colour('roof:colour',roof_color),cropped=not bounds.covers(shape)))
    # Parking aisles define an estimated paved apron. Join nearby mapped aisles,
    # exclude buildings, and retain the inference in the editable feature category.
    aisles=[LineString(f['points']).buffer(6) for f in features if f['kind']=='road' and f['category']=='parking_aisle']
    if aisles:
        joined=unary_union(aisles)
        buildings=unary_union([Polygon(f['points'],f['holes']) for f in features if f['kind']=='building'])
        for index,lot in enumerate(list(joined.geoms) if hasattr(joined,'geoms') else [joined]):
            apron=lot.convex_hull.difference(buildings).intersection(bounds)
            for part in list(apron.geoms) if hasattr(apron,'geoms') else [apron]:
                if part.geom_type=='Polygon' and part.area>30:
                    features.append(dict(id=f'estimated-parking/{index}/{len(features)}',name='Parking apron (estimated from mapped aisles)',kind='paving',category='estimated_parking',color='#727f80',points=coords(part.exterior),holes=[coords(r) for r in part.interiors]))
    # Building parts replace an outline only when they actually cover it. Avoid hiding uncovered wings.
    part_shapes=[Polygon(f['points'],f['holes']) for f in features if f['kind']=='building' and any(e.get('tags',{}).get('building:part') and f['id'].startswith(f"{e['type']}/{e['id']}/") for e in elements)]
    if part_shapes:
        covered=unary_union(part_shapes)
        features=[f for f in features if not (f['kind']=='building' and not any(f['id'].startswith(f"{e['type']}/{e['id']}/") and e.get('tags',{}).get('building:part') for e in elements) and covered.covers(Polygon(f['points'],f['holes'])))]
    return GeographicContext(source_date=data.get('osm3s',{}).get('timestamp_osm_base','unknown'),lat=lat,lon=lon,width=width,depth=depth,features=features)
