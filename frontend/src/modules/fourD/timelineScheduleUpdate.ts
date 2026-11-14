import type { Activity } from '@/modules/scheduling/types'
import type { ModelElementLink } from './modelElementLinks'
import type { ResolvedTimelineLink } from './timelinePlayback'

export function scheduleBindingKey(activities: Activity[], links: ModelElementLink[], baseline: boolean) {
  const byId = new Map(activities.map(a => [a.id, a]))
  return JSON.stringify(links.map(link => {
    const a = byId.get(link.activity_id)
    const start = baseline ? a?.bl_start : a?.start
    const finish = baseline ? a?.bl_finish : a?.finish
    return [link.activity_id, !!(start && finish), link.animation_profile_id ?? a?.animation_profile_id ?? null]
  }))
}

// Date changes preserve object/material bindings, rest poses and stagger order.
export function updateResolvedSchedule(targets: Iterable<{ links: ResolvedTimelineLink[] }>, activities: Activity[], baseline: boolean) {
  const windows = new Map(activities.map(a => {
    const start = baseline ? a.bl_start : a.start
    const finish = baseline ? a.bl_finish : a.finish
    return [a.id, start && finish ? { activity: { start, finish }, startMs: new Date(start).getTime(), finishMs: new Date(finish).getTime() } : null] as const
  }))
  for (const target of targets) for (const link of target.links) {
    const window = link.activityId ? windows.get(link.activityId) : null
    if (!window) continue
    link.activity = window.activity
    link.startMs = window.startMs
    link.finishMs = window.finishMs
  }
}
