import { DEFAULT_ANIMATION_CONFIG } from './generated/animation';
import { Profile } from './types';
/** Accept partial saved recipes; reject invalid values rather than corrupting transforms. */
export function readProfile(value: unknown): Profile {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Profile must be a JSON object.');
    const p = { ...DEFAULT_ANIMATION_CONFIG, ...value } as Profile;
    const enums: Record<string, readonly unknown[]> = { trigger: ['on_start', 'on_finish', 'over_duration'], transform_kind: ['none', 'translate', 'scale', 'rotate', 'pop', 'spiral', 'fall', 'grow'], axis: ['x', 'y', 'z'], direction: [1, -1], interpolation: ['linear', 'ease_in', 'ease_out', 'ease_in_out', 'bounce'], stagger_order: ['along_x', 'along_y', 'vertical', 'random'] };
    for (const [key, values] of Object.entries(enums))
        if (!values.includes(p[key as keyof Profile]))
            throw new Error(`Invalid profile ${key}.`);
    for (const key of ['distance', 'opacity_from', 'opacity_to', 'stagger'] as const)
        if (typeof p[key] !== 'number' || !Number.isFinite(p[key]))
            throw new Error(`Invalid profile ${key}.`);
    if (p.opacity_from < 0 || p.opacity_from > 1 || p.opacity_to < 0 || p.opacity_to > 1 || (p.stagger ?? 0) < 0 || (p.stagger ?? 0) > .95)
        throw new Error('Profile opacity or stagger is outside its range.');
    if (p.duration_frames !== null && (!Number.isFinite(p.duration_frames) || p.duration_frames <= 0))
        throw new Error('Invalid profile duration.');
    for (const key of ['color_from', 'color_to'] as const)
        if (p[key] !== null && !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(String(p[key])))
            throw new Error(`Invalid profile ${key}.`);
    return p;
}
