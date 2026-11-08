/** Static wheel wear in footprint texels. Thin the footprint to routes first so
 * tyre pairs continue along bends, open ends and through junctions. */
export interface RoadWear {
    mode: 'tracks' | 'rough' | 'off';
    pairs: number;
    wander: number;
    depthCm: number;
    potholes: number;
    colour: string;
    roughness: number;
    guides: string[];
    area: string;
}
export const DEFAULT_ROAD_WEAR: RoadWear = { mode: 'tracks', pairs: 1, wander: .23, depthCm: 3, potholes: .15, colour: '#70533d', roughness: .55, guides: [], area: '' };
interface Grid {
    w: number;
    h: number;
    pitch: number;
    depth: Float32Array;
}
export type WearPoint = {
    x: number;
    y: number;
};
type Point = WearPoint;
type Route = {
    points: Point[];
    start: number;
    end: number;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
function mix(a: Point, b: Point, t: number): Point { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
function clearance(g: Grid, p: Point) {
    const x = Math.round(p.x), y = Math.round(p.y);
    return x >= 0 && x < g.w && y >= 0 && y < g.h ? g.depth[y * g.w + x] : 0;
}
function smooth(points: Point[], span: number) {
    const result = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        if (distance(result[result.length - 1], points[i]) >= span)
            result.push(points[i]);
    }
    result.push(points[points.length - 1]);
    const curve = [result[0]];
    for (let i = 0; i < result.length - 1; i++)
        curve.push(mix(result[i], result[i + 1], .25), mix(result[i], result[i + 1], .75));
    curve.push(result[result.length - 1]);
    return curve;
}
// Zhang–Suen thinning preserves branches and closed loops. Only the route
// graph uses this coarser raster; tread and the edge fade use the full field.
export function roadRoutes(g: Grid): Point[][] {
    const step = Math.max(1, Math.ceil(Math.max(g.w, g.h) / 288));
    const w = Math.ceil(g.w / step) + 2, h = Math.ceil(g.h / step) + 2;
    const n = w * h, bits = new Uint8Array(n), remove = new Int32Array(n);
    const off = [-w, 1 - w, 1, 1 + w, w, w - 1, -1, -1 - w];
    const point = (i: number): Point => ({ x: ((i % w) - 1) * step + Math.floor(step / 2), y: (Math.floor(i / w) - 1) * step + Math.floor(step / 2) });
    for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++)
            bits[y * w + x] = Number(clearance(g, point(y * w + x)) > 0);
    let changed = true;
    while (changed) {
        changed = false;
        for (let pass = 0; pass < 2; pass++) {
            let count = 0;
            for (let i = w + 1; i < n - w - 1; i++) {
                if (!bits[i])
                    continue;
                const a = bits[i - w], c = bits[i + 1], e = bits[i + w], f = bits[i - 1];
                if (pass ? (a * c * f || a * e * f) : (a * c * e || c * e * f))
                    continue;
                let neighbours = 0, runs = 0, prev = bits[i + off[7]];
                for (const d of off) {
                    const b = bits[i + d];
                    neighbours += b;
                    if (b && !prev)
                        runs++;
                    prev = b;
                }
                if (neighbours >= 2 && neighbours <= 6 && runs === 1)
                    remove[count++] = i;
            }
            for (let j = 0; j < count; j++)
                bits[remove[j]] = 0;
            changed ||= count > 0;
        }
    }
    const neighbours = (i: number) => {
        const out: number[] = [];
        for (let k = 0; k < 8; k++) {
            const j = i + off[k];
            if (bits[j] && (!(k % 2) || !(bits[i + off[k - 1]] || bits[i + off[(k + 1) % 8]])))
                out.push(j);
        }
        return out;
    };
    const pixels: number[] = [], adj = new Map<number, number[]>();
    for (let i = 0; i < n; i++)
        if (bits[i]) {
            pixels.push(i);
            adj.set(i, neighbours(i));
        }
    const nodes = new Map<number, number>(), centres: Point[] = [], ends: boolean[] = [];
    for (const i of pixels) {
        const degree = adj.get(i)!.length;
        if (degree === 2 || nodes.has(i))
            continue;
        const id = centres.length, cluster = [i], centre = { x: 0, y: 0 };
        nodes.set(i, id);
        for (let j = 0; j < cluster.length; j++) {
            const p = cluster[j], pos = point(p);
            centre.x += pos.x;
            centre.y += pos.y;
            if (degree > 2)
                for (const k of adj.get(p)!)
                    if (adj.get(k)!.length > 2 && !nodes.has(k)) {
                        nodes.set(k, id);
                        cluster.push(k);
                    }
        }
        centres.push({ x: centre.x / cluster.length, y: centre.y / cluster.length });
        ends.push(degree <= 1);
    }
    const visited = new Set<number>(), routes: Route[] = [], loops: Point[][] = [];
    const edge = (a: number, b: number) => Math.min(a, b) * n + Math.max(a, b);
    function trace(first: number, next: number) {
        const start = nodes.get(first), pts = [start === undefined ? point(first) : centres[start]];
        let prev = first, here = next;
        while (true) {
            visited.add(edge(prev, here));
            const end = nodes.get(here);
            if (end !== undefined) {
                pts.push(centres[end]);
                if (start !== undefined && (start !== end || pts.length > 3))
                    routes.push({ points: pts, start, end });
                return;
            }
            pts.push(point(here));
            if (here === first) {
                loops.push(pts);
                return;
            }
            const following = adj.get(here)!.find(k => k !== prev);
            if (following === undefined || visited.has(edge(here, following)))
                return;
            prev = here;
            here = following;
        }
    }
    for (const [i, id] of nodes)
        for (const j of adj.get(i)!)
            if (nodes.get(j) !== id && !visited.has(edge(i, j)))
                trace(i, j);
    for (const i of pixels)
        for (const j of adj.get(i)!)
            if (!nodes.has(i) && !nodes.has(j) && !visited.has(edge(i, j)))
                trace(i, j);
    const output: Point[][] = [], junctions = new Map<number, Point[]>();
    function trimOrExtend(pts: Point[], node: number) {
        const tip = pts[0], d = clearance(g, tip);
        if (ends[node]) {
            // Continue from the thinned centreline to the open end of the slab.
            const ref = pts.find(p => distance(p, tip) >= Math.max(step, d * .7)) ?? pts[pts.length - 1];
            const len = distance(tip, ref);
            if (len > 0) {
                let last = tip;
                for (let t = step; t <= d * 2 + step; t += step) {
                    const p = mix(tip, ref, -t / len);
                    if (!clearance(g, p))
                        break;
                    last = p;
                }
                pts.unshift(last);
            }
        }
        else {
            const index = pts.findIndex(p => distance(tip, p) >= Math.max(2 * step, d * 1.15));
            const k = index < 0 ? Math.floor((pts.length - 1) / 3) : Math.min(index, Math.floor((pts.length - 1) / 2));
            pts.splice(0, k);
            const arms = junctions.get(node) ?? [];
            arms.push(pts[0]);
            junctions.set(node, arms);
        }
    }
    for (const { points, start, end } of routes) {
        const pts = smooth(points, Math.max(step * 1.6, 1 / g.pitch));
        trimOrExtend(pts, start);
        pts.reverse();
        trimOrExtend(pts, end);
        output.push(pts);
    }
    for (const [node, arms] of junctions)
        for (let i = 0; i < arms.length; i++)
            for (let j = i + 1; j < arms.length; j++) {
                const a = arms[i], b = arms[j], control = centres[node], pts: Point[] = [];
                for (let k = 0; k <= 16; k++) {
                    const t = k / 16;
                    pts.push(mix(mix(a, control, t), mix(control, b, t), t));
                }
                output.push(pts);
            }
    for (const pts of loops) {
        const curve = smooth(pts, Math.max(step * 1.6, 1 / g.pitch));
        output.push(curve);
    }
    // A square pad thins to one pixel. Provide a single crossing there too.
    for (const [i, id] of nodes)
        if (!adj.get(i)!.length) {
            const p = centres[id], pts = [p];
            for (const sign of [-1, 1]) {
                let end = p;
                for (let x = p.x + sign; clearance(g, { x, y: p.y }); x += sign)
                    end = { x, y: p.y };
                if (sign < 0)
                    pts.unshift(end);
                else
                    pts.push(end);
            }
            output.push(pts);
        }
    return output;
}
function hash(x: number, y: number, salt: number) {
    let h = Math.imul(x + salt, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise(x: number, y: number, scale: number, salt: number) {
    const u = x / scale, v = y / scale, i = Math.floor(u), j = Math.floor(v);
    const ease = (t: number) => t * t * (3 - 2 * t);
    const fx = ease(u - i), fy = ease(v - j);
    return (hash(i, j, salt) * (1 - fx) + hash(i + 1, j, salt) * fx) * (1 - fy)
        + (hash(i, j + 1, salt) * (1 - fx) + hash(i + 1, j + 1, salt) * fx) * fy;
}
function clipWear(g: Grid, area: Point[], pixels: Uint8Array) {
    // Scanline fill uses the same texel-centre coordinates as the routes.
    const crosses: number[] = [];
    for (let y = 0; y < g.h; y++) {
        crosses.length = 0;
        for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
            const a = area[j], b = area[i];
            if ((a.y > y) !== (b.y > y))
                crosses.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
        }
        crosses.sort((a, b) => a - b);
        let k = 0;
        for (let x = 0; x < g.w; x++) {
            while (k < crosses.length && crosses[k] <= x)
                k++;
            if (!(k % 2)) {
                const offset = (y * g.w + x) * 4;
                pixels[offset + 1] = pixels[offset + 2] = pixels[offset + 3] = 0;
            }
        }
    }
}
// A project route may run for kilometres before reaching the selected slab.
// Clip before sampling at wheel-scale intervals and keep separate crossings.
export function clipGuideToField(points: Point[], g: Grid): Point[][] {
    const paths: Point[][] = [], margin = 8 / g.pitch;
    let path: Point[] = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1], b = points[i];
        let first = 0, last = 1;
        for (const axis of ['x', 'y'] as const) {
            const d = b[axis] - a[axis], low = -margin, high = (axis === 'x' ? g.w : g.h) + margin;
            if (Math.abs(d) < 1e-8) {
                if (a[axis] < low || a[axis] > high)
                    first = 2;
            }
            else {
                const p = (low - a[axis]) / d, q = (high - a[axis]) / d;
                first = Math.max(first, Math.min(p, q));
                last = Math.min(last, Math.max(p, q));
            }
        }
        if (first >= last) {
            path = [];
            continue;
        }
        const start = mix(a, b, first), end = mix(a, b, last);
        if (!path.length || distance(path[path.length - 1], start) > .01) {
            path = [start];
            paths.push(path);
        }
        path.push(end);
    }
    return paths;
}
// Green holds compacted wheel wear, blue the tyre impressions, alpha the
// pothole profile. Red belongs to the independent footprint fade.
export function paintRoadWear(g: Grid, routes: Point[][], settings: RoadWear, rgba: Uint8Array, area?: Point[]) {
    const { pitch, w, h } = g;
    function stroke(a: Point, b: Point, start: number, width: number) {
        const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
        if (len < .001)
            return;
        for (let y = Math.max(0, Math.floor(Math.min(a.y, b.y) - width)); y <= Math.min(h - 1, Math.ceil(Math.max(a.y, b.y) + width)); y++)
            for (let x = Math.max(0, Math.floor(Math.min(a.x, b.x) - width)); x <= Math.min(w - 1, Math.ceil(Math.max(a.x, b.x) + width)); x++) {
                const i = y * w + x;
                if (!g.depth[i])
                    continue;
                const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (len * len)));
                const edge = Math.hypot(x - a.x - t * dx, y - a.y - t * dy) / width;
                if (edge >= 1)
                    continue;
                const across = ((x - a.x) * dy - (y - a.y) * dx) / len / width;
                const wear = (1 - edge * edge) ** 2;
                const phase = (start + t * len) * pitch / .36 - Math.abs(across) * .68;
                // Filter narrow lug spacing when the footprint raster cannot resolve it.
                const lug = .5 + .5 * Math.cos(2 * Math.PI * phase) * Math.max(0, 1 - pitch / .22);
                const u = x * pitch, v = y * pitch;
                const broken = .42 + .58 * noise(u, v, 2.1, 43);
                const grit = .84 + .16 * noise(u, v, .17, 53);
                const k = i * 4;
                rgba[k + 1] = Math.max(rgba[k + 1], Math.round(255 * wear * broken * grit * (.72 + .28 * lug)));
                rgba[k + 2] = Math.max(rgba[k + 2], Math.round(255 * wear * lug * broken));
            }
    }
    for (const route of routes) {
        if (route.length < 2)
            continue;
        // Sample by real distance so a straight or a gentle bend can wander too.
        const pts: Point[] = [route[0]];
        for (let i = 1; i < route.length; i++) {
            const a = route[i - 1], b = route[i], len = distance(a, b);
            if (len < .01)
                continue;
            const steps = Math.max(1, Math.ceil(len * pitch / .55));
            for (let j = 1; j <= steps; j++)
                pts.push(mix(a, b, j / steps));
        }
        const previous: Point[] = [], lengths: number[] = [];
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
            const len = distance(a, b);
            if (len < .001)
                continue;
            const nx = (a.y - b.y) / len, ny = (b.x - a.x) / len;
            // Probe sideways: clearance to a cut end says nothing about lane width.
            const limit = Math.ceil(8 / pitch), sides = [0, 0];
            for (let s = 0; s < 2; s++)
                for (let d = 1; d <= limit; d++) {
                    const sign = s ? 1 : -1;
                    if (!clearance(g, { x: p.x + nx * d * sign, y: p.y + ny * d * sign }))
                        break;
                    sides[s] = d;
                }
            // At an oblique cut end one ray can immediately leave the footprint.
            // Keep the wheel gauge there; the geometry clips the track at the end.
            const half = Math.max(.9 / pitch, Math.min(...sides));
            const laneWidth = Math.min(3.6 / pitch, 2 * half / (settings.pairs + .12));
            const gauge = Math.min(.90 / pitch, laneWidth * .28);
            const width = Math.max(.8, Math.min(.37 / pitch, laneWidth * .16));
            const metresX = p.x * pitch, metresY = p.y * pitch;
            const sway = settings.wander * (nx * Math.sin(metresY * .58 + metresX * .19) + ny * Math.sin(metresX * .42 - metresY * .23)) * .43 / pitch;
            for (let lane = 0; lane < settings.pairs; lane++)
                for (let side = 0; side < 2; side++) {
                    const k = 2 * lane + side;
                    const offset = (lane - (settings.pairs - 1) * .5) * laneWidth + (side ? gauge : -gauge) + sway;
                    const here = { x: p.x + nx * offset, y: p.y + ny * offset };
                    if (previous[k]) {
                        stroke(previous[k], here, lengths[k], width);
                        lengths[k] += distance(previous[k], here);
                    }
                    else
                        lengths[k] = 0;
                    previous[k] = here;
                }
        }
    }
    if (settings.mode === 'rough' && settings.roughness > 0) {
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const i = y * w + x;
                if (!g.depth[i])
                    continue;
                const u = x * pitch, v = y * pitch;
                const broad = noise(u, v, 2.7, 112), angular = noise(u + .32 * broad, v - .27 * broad, .53, 182);
                const fines = noise(u, v, .14, 151);
                const height = .46 * broad + .38 * angular + .16 * fines;
                rgba[4 * i + 1] = Math.round(255 * settings.roughness * Math.min(1, Math.max(0, (height - .24) * 1.65)));
                // Loose clods have sharper shoulders than the hollows around
                // them. Jitter each centre and vary the exposed face and size.
                const cellX = Math.floor(u / .44), cellY = Math.floor(v / .44);
                const cx = (cellX + .26 + .48 * hash(cellX,cellY,102)) * .44;
                const cy = (cellY + .26 + .48 * hash(cellX,cellY,105)) * .44;
                const radius = .05 + .10 * hash(cellX,cellY,107);
                const face = Math.max(0, 1 - (Math.abs(u-cx) + 1.3 * Math.abs(v-cy)) / radius);
                rgba[4 * i + 2] = Math.round(255 * settings.roughness * (.26 * angular + .74 * face));
            }
    }
    const cell = 3.6 / pitch;
    for (let y = 0; settings.potholes > 0 && y * cell < h; y++)
        for (let x = 0; x * cell < w; x++) {
            if (hash(x, y, 27) > settings.potholes * .65)
                continue;
            const cx = (x + .16 + .68 * hash(x, y, 31)) * cell, cy = (y + .16 + .68 * hash(x, y, 59)) * cell;
            const rx = (.21 + .46 * hash(x, y, 73)) / pitch, ry = rx * (.52 + .42 * hash(x, y, 87));
            if (clearance(g, { x: cx, y: cy }) < rx)
                continue;
            for (let py = Math.max(0, Math.floor(cy - ry)); py < Math.min(h, cy + ry); py++)
                for (let px = Math.max(0, Math.floor(cx - rx)); px < Math.min(w, cx + rx); px++) {
                    const r = ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2;
                    if (r < 1)
                        rgba[(py * w + px) * 4 + 3] = Math.round(255 * (1 - r) ** 2);
                }
        }
    if (area)
        clipWear(g, area, rgba);
}
