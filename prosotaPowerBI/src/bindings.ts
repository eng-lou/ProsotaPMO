import type powerbi from 'powerbi-visuals-api';
import { DEFAULT_ANIMATION_CONFIG } from './generated/animation';
import { readProfile } from './profile';
import { Link, parseTask, Task } from './types';
export function readTable(table: powerbi.DataViewTable) {
    const tasks = new Map<string, Task>(), links: Link[] = [];
    const seen = new Set<string>();
    for (const row of table.rows ?? []) {
        const v: Record<string, unknown> = {};
        table.columns.forEach((c, i) => { for (const role of Object.keys(c.roles ?? {}))
            if (c.roles?.[role])
                v[role] = row[i]; });
        const task = parseTask({ id: v.taskId, name: v.taskName, start: v.start, finish: v.finish, budget: v.budget, actual: v.actual, earned: v.earned, planned: v.planned, progress: v.progress, level: v.level, discipline: v.discipline });
        if (!task)
            throw new Error('Each activity needs an ID and valid Start / Finish dates.');
        const previous = tasks.get(task.id);
        if (previous && JSON.stringify(previous) !== JSON.stringify(task))
            throw new Error(`Activity ${task.id} has conflicting rows. Repeat the same activity totals for each linked element.`);
        tasks.set(task.id, task);
        const profile = v.profile ? readProfile(JSON.parse(String(v.profile))) : { ...DEFAULT_ANIMATION_CONFIG };
        if (v.elementGuid) {
            const element = String(v.elementGuid), key = JSON.stringify([task.id, element]);
            if (seen.has(key))
                continue;
            seen.add(key);
            links.push({ useImportedProfile: !v.profile, taskId: task.id, element, startMs: task.start, finishMs: task.finish, profile, axis: profile.axis });
        }
    }
    return { tasks: [...tasks.values()], links };
}
