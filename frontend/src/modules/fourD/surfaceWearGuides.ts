import { Vector3 } from 'three';
import { samplePathCurve } from './pathCurve';
import type { Path } from './paths';
import type { Zone } from './zones';
export interface WearGuide {
    id: string;
    name: string;
    points: Vector3[];
    closed: boolean;
    isPath: boolean;
}
// Attached only to the renderer's mapping. Project data stores the IDs.
export const WEAR_GUIDES = Symbol('surface wear guides');
export function makeWearGuides(paths: Path[], zones: Zone[], up: 'y' | 'z') {
    const map = new Map<string, WearGuide>();
    for (const path of paths) {
        if (path.points.length < 2)
            continue;
        const id = 'path:' + path.id;
        map.set(id, { id, name: path.name, isPath: true, closed: path.closed && path.points.length >= 3,
            points: samplePathCurve(path.points, path.closed, path.curve_mode) });
    }
    for (const zone of zones) {
        if (zone.points.length < (zone.shape === 'circle' ? 1 : 3))
            continue;
        const id = 'zone:' + zone.id;
        const points = zone.points.map(p => { const v = new Vector3(p.x, p.y, p.z); v[up] = zone.elevation; return v; });
        if (zone.shape === 'circle') {
            const centre = points[0], side = up === 'z' ? 'y' : 'z';
            points.length = 0;
            for (let i = 0; i < 64; i++) {
                const angle = i * Math.PI / 32, p = centre.clone();
                p.x += zone.radius * Math.cos(angle);
                p[side] += zone.radius * Math.sin(angle);
                points.push(p);
            }
        }
        map.set(id, { id, name: zone.name, points, closed: true, isPath: false });
    }
    return map;
}
