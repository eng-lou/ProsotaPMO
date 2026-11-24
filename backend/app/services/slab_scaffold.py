"""Fit scaffold bays to horizontal slab faces in canonical X/Z metres."""
import math
from collections import defaultdict

from shapely import Polygon, box, union_all
from shapely.geometry.polygon import orient


def _floors(slabs):
    floors = defaultdict(list)
    for slab in slabs:
        face = Polygon()
        for ring in slab["rings"]:
            if len(ring) < 3 or len(ring) > 4096:
                raise ValueError("Choose a slab with a closed, usable boundary.")
            part = Polygon(ring)
            if not part.is_valid or part.area < 1e-6:
                raise ValueError(f'Check the boundary of {slab["name"]}.')
            face = face.symmetric_difference(part)
        floors[round(slab["elevation"], 3)].append(face)
    return [(z, union_all(parts, grid_size=.0001)) for z, parts in sorted(floors.items())]


def _perimeters(face, gap):
    offset = face.buffer(gap, join_style="mitre") if gap else face
    shapes = offset.geoms if offset.geom_type == "MultiPolygon" else [offset]
    for shape in shapes:
        if shape.geom_type != "Polygon" or shape.is_empty:
            raise ValueError("The slab outline cannot define a perimeter.")
        # In the renderer positive local Z points outside a clockwise X/Z loop.
        coords = list(orient(shape.simplify(.0001, preserve_topology=True), sign=-1).exterior.coords)
        yield list(zip(coords, coords[1:]))


def slab_scaffold_layout(item):
    sc = item["enclosure"]["scaffold"]
    floors = _floors(sc["slabs"])
    base = sc.get("base_elevation")
    if base is None or base > floors[0][0] + .001:
        raise ValueError("Set the scaffold base at or below the lowest selected slab.")
    if len(floors) < 2 and abs(floors[0][0] - base) < .01:
        raise ValueError("Add an upper slab or set a lower scaffold base.")
    panel_length, width = item["module_length"], sc["width"]
    if panel_length <= 0 or item["height"] <= 0:
        raise ValueError("Enter a positive bay length and lift height.")
    edits = sc.get("bay_edits", {})
    bays, panels, corners = [], [], []
    previous_feet = set()
    previous_face = None
    length = 0
    flights = 0
    budget = 0

    def world(p, height):
        return (dict(x=p[0], y=height, z=p[1]) if item["up_axis"] == "y"
                else dict(x=p[0], y=-p[1], z=height))

    def foot_key(p):
        return tuple(round(x, 3) for x in p)

    for elevation, face in floors:
        delta = elevation - base
        datum = abs(delta) <= .001
        lifts = max(1, math.ceil(delta / item["height"] - 1e-8))
        if lifts > 30:
            raise ValueError("Check the scaffold base and missing intermediate slabs.")
        feet = set()
        for perimeter in _perimeters(face, sc.get("facade_gap", .18)):
            completed = []
            for a, b in perimeter:
                span = math.dist(a, b)
                n = max(1, math.ceil(span / panel_length - 1e-8))
                budget += n * lifts
                if budget > 6000:
                    raise ValueError("Split this selection into smaller scaffold runs.")
                dx, dz = (b[0]-a[0])/span, (b[1]-a[1])/span

                def at(station, side=0):
                    return (a[0]+dx*station-dz*side, a[1]+dz*station+dx*side)

                edge_ends = [False, False]
                for i in range(n):
                    lo, hi = span*i/n, span*(i+1)/n
                    p, q = at(lo), at(hi)
                    key = f"{elevation:.3f}/" + "/".join(f"{v:.3f}" for v in (*p,*q))
                    mode = edits.get(key)
                    stair = mode == "stairs"
                    # Compare every standard with the bearing surface or a standard immediately below.
                    required = [at(station, side) for station in (lo+.022,hi-.022)
                                for side in ([0,width,width+.9] if stair else [0,width])]
                    reason = ""
                    if stair and hi-lo < 1.8:
                        reason = "Stair bay is shorter than 1.8 m"
                    elif previous_face is not None and any(
                        foot_key(pt) not in previous_feet and
                        not previous_face.covers(box(pt[0]-.08,pt[1]-.08,pt[0]+.08,pt[1]+.08))
                        for pt in required
                    ):
                        reason = "No slab or aligned standard below a foot"
                    if datum:
                        # This plane represents the user-specified ground at the lowest perimeter.
                        feet.update(foot_key(pt) for pt in required)
                        feet.update(foot_key(at(s,width+.9)) for s in (lo+.022,hi-.022))
                        continue
                    status = "gap" if mode == "gap" else "review" if reason else "supported"
                    bays.append(dict(key=key, elevation=elevation, a=p, b=q, status=status, reason=reason, stairs=stair))
                    if status != "supported":
                        continue
                    feet.update(foot_key(pt) for pt in required)
                    length += hi-lo
                    ident = f"{item['id']}:panel:{key}"
                    panels.append(dict(id=ident, a=world(p,base), b=world(q,base), rise=delta/lifts,
                                       lifts=lifts, stairs=stair, flight_offset=flights))
                    if i == 0:
                        edge_ends[0] = ident
                    if i == n-1:
                        edge_ends[1] = ident
                completed.append((a,b,dx,dz,edge_ends))
            # Fill the outside corner only where both adjacent decks are present.
            for j,(a,b,dx,dz,ends) in enumerate(completed):
                _,_,nx,nz,next_ends = completed[(j+1)%len(completed)]
                dot = dx*nx+dz*nz
                if not ends[1] or not next_ends[0] or dx*nz-dz*nx >= -1e-6 or 1+dot < .1:
                    continue
                prev = (b[0]-dz*width,b[1]+dx*width)
                after = (b[0]-nz*width,b[1]+nx*width)
                outer = (b[0]-(dz+nz)*width/(1+dot),b[1]+(dx+nx)*width/(1+dot))
                for lift in range(1,lifts+1):
                    corners.append(dict(id=ends[1], points=[world(p,base+delta*lift/lifts) for p in (b,prev,outer,after)]))
        previous_face, previous_feet, base = face, feet, elevation
        if not datum:
            flights += lifts
    return dict(panels=panels, reference_bays=bays, scaffold_corners=corners, length=length,
                panel_count=len(panels), gate_width=0, openings=[],
                unmatched_edits=len(set(edits)-{b['key'] for b in bays}))
