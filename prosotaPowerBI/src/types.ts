export interface Profile {
    trigger: 'on_start' | 'on_finish' | 'over_duration';
    transform_kind: 'none' | 'translate' | 'scale' | 'rotate' | 'pop' | 'spiral' | 'fall' | 'grow';
    axis: 'x' | 'y' | 'z';
    direction: 1 | -1;
    distance: number;
    bounce: boolean;
    twist: boolean;
    opacity_from: number;
    opacity_to: number;
    color_from: string | null;
    color_to: string | null;
    interpolation: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'bounce';
    duration_frames: number | null;
    stagger?: number;
    stagger_order?: string;
    stagger_reverse?: boolean;
}
export interface Task {
    id: string;
    code: string;
    name: string;
    start: number;
    finish: number;
    planned: number | null;
    budget: number | null;
    actual: number | null;
    earned: number | null;
    progress: number | null;
    profileId?: string;
    level?: string;
    discipline?: string;
}
export interface Link {
    useImportedProfile?: boolean;
    taskId: string;
    element: string;
    startMs: number;
    finishMs: number;
    profile: Profile;
    axis: 'x' | 'y' | 'z';
    staggerFraction?: number;
}
export interface ResourceRow {
    id: string;
    taskId: string;
    name: string;
    hours: number | null;
    cost: number | null;
}
export interface Snapshot {
    name: string;
    currency: string;
    tasks: Task[];
    profiles: Map<string, Profile>;
    links: Link[];
    resources: ResourceRow[];
    warnings: string[];
}
export const numberOrNull = (v: unknown): number | null => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
export function parseTask(v: Record<string, unknown>): Task | null {
    const start = Date.parse(String(v.start ?? '')), finish = Date.parse(String(v.finish ?? v.start ?? ''));
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start || !v.id)
        return null;
    return { id: String(v.id), code: String(v.code ?? v.id), name: String(v.task_name ?? v.name ?? v.id), start, finish,
        planned: numberOrNull(v.pv ?? v.planned), budget: numberOrNull(v.bac ?? v.budget), actual: numberOrNull(v.ac ?? v.actual), earned: numberOrNull(v.ev ?? v.earned),
        progress: numberOrNull(v.pct_complete ?? v.progress), profileId: v.animation_profile_id ? String(v.animation_profile_id) : undefined,
        level: String(v.level ?? ''), discipline: String(v.discipline ?? '') };
}
export function total(tasks: Task[], key: 'budget' | 'actual' | 'earned' | 'planned'): number | null {
    const values = tasks.map(t => t[key]).filter((v): v is number => v !== null);
    return values.length && values.length === tasks.length ? values.reduce((a, b) => a + b, 0) : null;
}
