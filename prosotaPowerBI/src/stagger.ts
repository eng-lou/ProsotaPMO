import type { Group } from 'three';
import type { Link } from './types';
export function assignStagger(links: Link[], elements: Map<string, Group>) {
    // Stable stagger ordering, resolved once per activity/profile group.
    const groups = new Map<string, typeof links>();
    for (const l of links) {
        const key = l.taskId + JSON.stringify(l.profile);
        const list = groups.get(key) ?? [];
        list.push(l);
        groups.set(key, list);
    }
    for (const ordered of groups.values()) {
        const p = ordered[0].profile, axis = p.stagger_order === 'along_x' ? 'x' : p.stagger_order === 'along_y' ? 'z' : 'y';
        const key = (l: Link) => { const v = elements.get(l.element)?.position; if (!v)
            return 0; if (p.stagger_order === 'random') {
            const h = Math.sin(v.x * 12.9898 - v.z * 78.233 + v.y * 37.719) * 43758.5453;
            return h - Math.floor(h);
        } return axis === 'z' ? -v.z : v[axis]; };
        ordered.sort((a, b) => key(a) - key(b));
        if (p.stagger_reverse)
            ordered.reverse();
        ordered.forEach((l, i) => l.staggerFraction = ordered.length > 1 ? i / (ordered.length - 1) : 0);
    }
}
