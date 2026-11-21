"""Pure v1 geometry: level, fixed-module fencing along canonical control segments.

No smoothing of the user's existing animation path, no source model mutation.
All generated geometry is derived from a pinned recipe in local metre coordinates.
"""
import math
import random


def enclosure_path(item):
    """Retain authored corners and the straight/curved provenance of each chord."""
    controls = item["points"]
    sampled = sample_path(item)
    closed = item.get("closed", False)
    if closed:
        sampled.append(sampled[0])
    points, curved_edges = [sampled[0]], []
    cursor = 0
    for i in range(len(controls) if closed else len(controls) - 1):
        dest = controls[(i + 1) % len(controls)]
        curved = (dest.get("segment_mode") or item.get("curve_mode", "straight")) == "curved"
        edges = (24 if dest.get("segment_controls") else 16) if curved else 1
        section = sampled[cursor:cursor + edges + 1]
        cursor += edges
        if curved and len(controls) == 2 and not dest.get("segment_controls") and not closed:
            curved = False
        if not curved:
            if curved_edges and not curved_edges[-1]:
                first, middle, last = points[-2], points[-1], section[-1]
                before = [middle[k] - first[k] for k in "xyz"]
                after = [last[k] - middle[k] for k in "xyz"]
                lengths = math.hypot(*before) * math.hypot(*after)
                if lengths and math.isclose(sum(a*b for a,b in zip(before, after)), lengths, rel_tol=1e-13):
                    points[-1] = last
                    continue
            points.append(section[-1])
            curved_edges.append(False)
            continue
        lengths = [math.dist([a[k] for k in "xyz"], [b[k] for k in "xyz"]) for a,b in zip(section, section[1:])]
        length = sum(lengths)
        count = max(1, math.ceil(length / item["module_length"]))
        if count + len(curved_edges) > 2000:
            raise ValueError("Limit this fence to 2,000 panels.")
        j, distance = 0, 0
        for n in range(1, count + 1):
            station = length * n / count
            while j < len(lengths) - 1 and distance + lengths[j] < station:
                distance += lengths[j]
                j += 1
            t = (station - distance) / lengths[j] if lengths[j] else 0
            points.append(section[-1] if n == count else {k: section[j][k] + t*(section[j+1][k]-section[j][k]) for k in "xyz"})
            curved_edges.append(True)
    return points, curved_edges


def fence_layout(item):
    if item.get("enclosure"):
        points, curved_edges = enclosure_path(item)
    else:
        points = sample_path(item)
    if not item.get("enclosure") and (item.get('curve_mode') == 'curved' or any(p.get('segment_mode') == 'curved' for p in item['points'])) and len(points)>2:
        # Follow the curve with practical panel-length chords, not one panel per tessellation edge.
        route=points+([points[0]] if item.get('closed') else [])
        lengths=[math.dist([a[k] for k in 'xyz'],[b[k] for k in 'xyz']) for a,b in zip(route,route[1:])]
        total=sum(lengths); count=max(1,math.ceil(total/item['module_length']))
        if count>2000: raise ValueError('Limit this fence to 2,000 panels')
        points=[];segment=0;start=0
        for i in range(count if item.get('closed') else count+1):
            distance=total*i/count
            while segment<len(lengths)-1 and start+lengths[segment]<distance:
                start+=lengths[segment];segment+=1
            a,b=route[segment:segment+2]; t=(distance-start)/lengths[segment] if lengths[segment]>0 else 0
            points.append({k:a[k]+(b[k]-a[k])*t for k in 'xyz'})
    if item.get("closed") and points[-1] != points[0]:
        points.append(points[0])
    up = item["up_axis"]
    horizontal = [k for k in "xyz" if k != up]
    def orient(a, b, c):
        x, y = horizontal
        return (b[x]-a[x])*(c[y]-a[y]) - (b[y]-a[y])*(c[x]-a[x])
    edges = list(zip(points, points[1:]))
    for a, b, c in zip(points, points[1:], points[2:]):
        if abs(orient(a, b, c)) < 1e-9 and sum((b[k]-a[k])*(c[k]-b[k]) for k in horizontal) < 0:
            raise ValueError("The fence path doubles back on itself. Adjust the source path first.")
    for i, (a, b) in enumerate(edges):
        for j, (c, d) in enumerate(edges[i+2:], i+2):
            if item.get("closed") and i == 0 and j == len(edges)-1:
                continue
            if orient(a,b,c) * orient(a,b,d) <= 0 and orient(c,d,a) * orient(c,d,b) <= 0:
                if all(max(min(a[k],b[k]),min(c[k],d[k])) <= min(max(a[k],b[k]),max(c[k],d[k])) + 1e-9 for k in horizontal):
                    raise ValueError("The fence path intersects itself. Adjust the source path first.")
    segments, chainage = [], 0.0
    for a, b in zip(points, points[1:]):
        if abs(a[up] - b[up]) > 0.001:
            raise ValueError("This first fence tool needs a level path. Stepped/sloping fencing is not yet supported.")
        length = math.dist([a[k] for k in "xyz"], [b[k] for k in "xyz"])
        if length < 0.001:
            raise ValueError("Remove repeated path points before generating a fence.")
        segments.append((a, b, chainage, chainage + length))
        chainage += length
    config = item.get("enclosure")
    levels = config["levels"] if config else [0]
    if config:
        openings = sorted(config["openings"], key=lambda entry: entry["start"])
    elif item["gate_width"]:
        openings = [dict(kind="gap", start=item["gate_start"], width=item["gate_width"])]
    else:
        openings = []

    spans = [[] for _ in segments]
    previous_end = 0
    for opening in openings:
        start, end = opening["start"], opening["start"] + opening["width"]
        if start < previous_end - 1e-8:
            raise ValueError("Fence openings overlap. Adjust the start or width.")
        if end > chainage + 1e-8:
            raise ValueError("The gate opening extends beyond the path.")
        index = next((i for i, (_, _, lo, hi) in enumerate(segments)
                      if start >= lo - 1e-8 and end <= hi + 1e-8), None)
        if index is None or (config and curved_edges[index]):
            raise ValueError("Place each opening on one straight segment, clear of any curve or corner.")
        spans[index].append(opening)
        previous_end = end

    panels, entrances = [], []
    module, fit = item["module_length"], item.get("panel_fit", "fit")
    for (a, b, lo, hi), cuts in zip(segments, spans):
        def at(station, level):
            t = (station - lo) / (hi - lo)
            return {k: a[k] + (b[k] - a[k]) * t + (level if k == up else 0) for k in "xyz"}

        intervals, cursor = [], lo
        for cut in cuts:
            start, end = cut["start"], cut["start"] + cut["width"]
            intervals.append((cursor, start))
            cursor = end
            if config:
                for level in levels:
                    entrances.append({**cut, "level": level, "a": at(start, level), "b": at(end, level)})
        intervals.append((cursor, hi))
        for start, end in intervals:
            span = end - start
            if span < 1e-6:
                continue
            count = max(1, math.ceil(span / module - 1e-9)) if fit != "strict" else round(span / module)
            if fit == "strict" and (count < 1 or abs(span - count * module) > 0.001):
                raise ValueError(f"Unresolved span of {span:.3f} m. Each straight span beside a gate must fit whole {module:g} m panels.")
            if len(panels) + count * len(levels) > 2000:
                raise ValueError("Limit this fence to 2,000 panels across all levels.")
            step = span / count if fit == "fit" else module
            for level in levels:
                for n in range(count):
                    station = start + n * step
                    panel_id = f"{item['id']}:panel:{station:.6f}"
                    if level:
                        panel_id += f"@{level}"
                    panels.append({"id": panel_id, "a": at(station, level), "b": at(min(end, station + step), level)})
    layout = {"panels": panels, "length": chainage, "panel_count": len(panels),
              "gate_width": sum(cut["width"] for cut in openings)}
    if config:
        layout["openings"] = entrances
    return layout


def evaluate(item):
    kind = item["kind"]
    layout = fence_layout(item) if kind == "fence" else generated_layout(item) if kind in ("shape", "array", "scatter") else None
    return {**item, "layout": layout}

def sample_path(item):
    """Centripetal Catmull-Rom, matching Three's path display/followers."""
    points = item['points']
    mixed = any(p.get('segment_mode') for p in points)
    if (not mixed and item.get('curve_mode', 'straight') == 'straight') or len(points) < 2:
        return [{k:p[k] for k in 'xyz'} for p in points]
    closed = item.get('closed', False)
    result = []
    n = len(points)
    if n>128: raise ValueError('Limit curved source paths to 128 control points')
    for i in range(n if closed else n-1):
        p1, p2 = points[i], points[(i+1) % n]
        mode = p2.get('segment_mode') or item.get('curve_mode', 'straight')
        if mode == 'straight':
            result.append({k:p1[k] for k in 'xyz'})
            continue
        handles = p2.get('segment_controls')
        if handles:
            for j in range(24):
                t=j/24; u=1-t
                result.append({k:u**3*p1[k]+3*u*u*t*(p1[k]+handles[0][k])+3*u*t*t*(p2[k]+handles[1][k])+t**3*p2[k] for k in 'xyz'})
            continue
        p0 = points[(i-1) % n] if closed or i > 0 else {k: 2*p1[k]-p2[k] for k in 'xyz'}
        p3 = points[(i+2) % n] if closed or i+2 < n else {k: 2*p2[k]-p1[k] for k in 'xyz'}
        def dt(a,b): return math.sqrt(math.dist(list(a[k] for k in 'xyz'), list(b[k] for k in 'xyz')))
        d1=dt(p1,p2); d1=d1 if d1>=1e-4 else 1
        d0=dt(p0,p1); d0=d0 if d0>=1e-4 else d1
        d2=dt(p2,p3); d2=d2 if d2>=1e-4 else d1
        for j in range(16):
            t=j/16; point={}
            for k in 'xyz':
                a,b,c,d=p0[k],p1[k],p2[k],p3[k]
                m1=((b-a)/d0-(c-a)/(d0+d1)+(c-b)/d1)*d1
                m2=((c-b)/d1-(d-b)/(d1+d2)+(d-c)/d2)*d1
                point[k]=b+m1*t+(-3*b+3*c-2*m1-m2)*t*t+(2*b-2*c+m1+m2)*t*t*t
            result.append(point)
    if not closed: result.append({k:points[-1][k] for k in 'xyz'})
    return result


def zone_points(zone, up):
    axes=[k for k in 'xyz' if k != up]
    if zone.shape == 'circle':
        if not zone.points: raise ValueError('Place the zone centre first')
        centre=zone.points[0]
        points=[]
        for i in range(64):
            p=dict(centre);p[axes[0]]+=zone.radius*math.cos(i*math.tau/64);p[axes[1]]+=zone.radius*math.sin(i*math.tau/64)
            points.append(p)
    else: points=[dict(p) for p in zone.points]
    for p in points: p[up]=zone.elevation
    return points


def footprint(item):
    points=sample_path(item)
    if len(points)>1 and points[0]==points[-1]: points.pop()
    axes=[k for k in 'xyz' if k != item['up_axis']]
    if len(points)<3: raise ValueError('The shape needs at least three different points')
    if max(p[item['up_axis']] for p in points)-min(p[item['up_axis']] for p in points)>.001:
        raise ValueError('Set a common elevation on the source before creating a flat shape or scatter zone')
    def cross(a,b,c): return (b[axes[0]]-a[axes[0]])*(c[axes[1]]-a[axes[1]])-(b[axes[1]]-a[axes[1]])*(c[axes[0]]-a[axes[0]])
    edges=list(zip(points,points[1:]+points[:1]))
    for i,(a,b) in enumerate(edges):
        if math.dist([a[k] for k in axes],[b[k] for k in axes])<1e-7: raise ValueError('Remove repeated boundary points')
        for j in range(i+2,len(edges)):
            if i==0 and j==len(edges)-1: continue
            c,d=edges[j]
            if cross(a,b,c)*cross(a,b,d)<=0 and cross(c,d,a)*cross(c,d,b)<=0 and all(max(min(a[k],b[k]),min(c[k],d[k]))<=min(max(a[k],b[k]),max(c[k],d[k])) for k in axes):
                raise ValueError('The boundary intersects itself')
    area=sum(a[axes[0]]*b[axes[1]]-b[axes[0]]*a[axes[1]] for a,b in edges)/2
    if abs(area)<1e-6: raise ValueError('The boundary has no usable area')
    return points


def generated_layout(item):
    kind=item['kind'];up=item['up_axis'];axes=[k for k in 'xyz' if k!=up]
    points=footprint(item) if kind in ('shape','scatter') else sample_path(item)
    if kind=='shape': return {'footprint':points}
    placements=[]
    if kind=='array':
        route=points+([points[0]] if item['closed'] else [])
        lengths=[math.dist([a[k] for k in 'xyz'],[b[k] for k in 'xyz']) for a,b in zip(route,route[1:])]
        total=sum(lengths)
        if total<.001: raise ValueError('The path has no usable length')
        count=math.ceil(total/item['spacing']) if item['closed'] else math.floor(total/item['spacing'])+1
        if count>200: raise ValueError('Increase spacing: a placement group is limited to 200 objects')
        segment=0;start=0
        for i in range(count):
            distance=i*item['spacing']
            while segment<len(lengths)-1 and start+lengths[segment]<distance:
                start+=lengths[segment];segment+=1
            a,b=route[segment:segment+2];t=(distance-start)/lengths[segment] if lengths[segment]>0 else 0
            point={k:a[k]+(b[k]-a[k])*t for k in 'xyz'}
            # Local +X follows the path; local Z is -world Y when Z is up.
            yaw=math.degrees(math.atan2(-(b[axes[1]]-a[axes[1]]) if up=='y' else b[axes[1]]-a[axes[1]],b['x']-a['x']))
            placements.append({'position':point,'yaw':yaw if item.get('align_to_path',True) else 0})
    else:
        rng=random.Random(item['seed']);x,y=axes
        lo=[min(p[k] for p in points) for k in axes];hi=[max(p[k] for p in points) for k in axes]
        def inside(a,b):
            hit=False
            for p,q in zip(points,points[1:]+points[:1]):
                if (p[y]>b)!=(q[y]>b) and a<(q[x]-p[x])*(b-p[y])/(q[y]-p[y])+p[x]: hit=not hit
            return hit
        for _ in range(item['count']*500):
            a=rng.uniform(lo[0],hi[0]);b=rng.uniform(lo[1],hi[1])
            if not inside(a,b): continue
            if any(math.hypot(a-p['position'][x],b-p['position'][y])<item['spacing'] for p in placements): continue
            placements.append({'position':{x:a,y:b,up:points[0][up]},'yaw':rng.uniform(-180,180) if item.get('random_rotation',True) else 0})
            if len(placements)==item['count']: break
        if len(placements)<item['count']: raise ValueError(f'Only {len(placements)} objects fit at this spacing. Reduce count or minimum spacing.')
    return {'placements':placements,'count':len(placements)}
