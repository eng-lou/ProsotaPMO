import type { Activity } from '@/modules/scheduling/types'

export type GanttDetail = number | 'activities'
export interface RenderGanttRow {
  activity: Activity
  level: GanttDetail
  depth: number
  start: number
  finish: number
}
export interface GanttOutline {
  rows: RenderGanttRow[]
  levels: number[]
}

// Use the same parent links and sibling order as the schedule. Roll up the
// simulated children's dates so a changed scenario also moves its WBS bars.
export function buildGanttOutline(activities: Activity[]): GanttOutline {
  const children = new Map<string | null, Activity[]>()
  const ids = new Set(activities.map(a => a.id))
  for (const a of activities) {
    const parent = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null
    const siblings = children.get(parent)
    if (siblings) siblings.push(a)
    else children.set(parent, [a])
  }
  for (const siblings of children.values()) siblings.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const ordered: RenderGanttRow[] = []
  const levels = new Set<number>()
  const visited = new Set<string>()
  function visit(activity: Activity, depth: number, parentVisible: boolean): RenderGanttRow | undefined {
    if (visited.has(activity.id)) return
    visited.add(activity.id)
    const summary = activity.activity_type === 'wbs_summary'
    const row: RenderGanttRow = { activity, depth, level: summary ? depth : 'activities',
      start: Date.parse(activity.start ?? ''), finish: Date.parse(activity.finish ?? '') }
    const visible = parentVisible && activity.viewable_4d !== false
    if (visible && (!summary || depth > 0)) ordered.push(row)
    let first = Infinity, last = -Infinity
    for (const child of children.get(activity.id) ?? []) {
      const dates = visit(child, depth + 1, visible)
      if (!dates) continue
      first = Math.min(first, dates.start)
      last = Math.max(last, dates.finish)
    }
    if (summary && first <= last) {
      row.start = first
      row.finish = last
    }
    if (row.start <= row.finish) {
      if (summary && depth > 0) levels.add(depth)
      return row
    }
  }
  for (const root of children.get(null) ?? []) {
    const depth = root.parent_id ? Math.max(1, (root.wbs_path?.split('.').length ?? 2) - 1) : 0
    visit(root, depth, true)
  }
  const rows = ordered.filter(row => row.start <= row.finish)
  // Hiding every row at a level must not switch a saved WBS export to activities.
  return { rows, levels: [...levels].sort((a, b) => a - b) }
}

export function availableGanttDetail(saved: GanttDetail[], levels: number[]): GanttDetail[] {
  const available = saved.filter(level => level === 'activities' || levels.includes(level))
  return available.length ? available : ['activities']
}

export function filterGanttRows(outline: GanttOutline, detail: GanttDetail[]): RenderGanttRow[] {
  const rows = outline.rows.filter(row => detail.includes(row.level))
  if (detail.length === 1 && detail[0] === 'activities') rows.sort((a,b) => a.start-b.start)
  return rows.map(row => ({...row, depth: detail.filter(level => typeof level === 'number' && level < row.depth).length}))
}

// Inclusive intervals match the render playhead. Starts sort before finishes
// at the same instant so milestones and handovers both count for that frame.
export function peakGanttOverlap(rows: RenderGanttRow[], from: Date | null, to: Date | null): number {
  const first = from?.getTime() ?? -Infinity
  const last = to?.getTime() ?? Infinity
  if (first === last) return rows.filter(row => row.start <= first && first <= row.finish).length
  const events: {date: number; change: number}[] = []
  for (const row of rows) {
    if (row.start > last || row.finish < first) continue
    events.push({date: Math.max(first, row.start), change: 1}, {date: Math.min(last, row.finish), change: -1})
  }
  events.sort((a,b) => a.date - b.date || b.change - a.change)
  let active = 0, peak = 0
  for (const event of events) {
    active += event.change
    peak = Math.max(peak, active)
  }
  return peak
}

export function ganttWindow(rows: RenderGanttRow[], now: Date | null, capacity: number) {
  const contextSize = Math.min(5, capacity)
  if (!now) return {rows: rows.slice(0, contextSize), hiddenActive: 0}
  const time = now.getTime()
  const active: RenderGanttRow[] = []
  const nearby: {row: RenderGanttRow; distance: number}[] = []
  for (const row of rows) {
    const distance = Math.max(row.start - time, time - row.finish)
    if (distance <= 0) {
      active.push(row)
    } else if (active.length < contextSize && (nearby.length < contextSize || distance < nearby[nearby.length - 1].distance)) {
      nearby.push({row, distance})
      nearby.sort((a,b) => a.distance - b.distance)
      if (nearby.length > contextSize) nearby.pop()
    }
  }
  const hiddenActive = Math.max(0, active.length - capacity)
  if (hiddenActive) {
    // A later start cannot evict an earlier ongoing WBS, even on a crowded frame.
    active.sort((a,b) => Number(a.level === 'activities') - Number(b.level === 'activities') || a.start - b.start)
  }
  const chosen = new Set(active.slice(0, capacity))
  for (const {row} of nearby) {
    if (chosen.size >= contextSize) break
    chosen.add(row)
  }
  return {rows: rows.filter(row => chosen.has(row)), hiddenActive}
}
