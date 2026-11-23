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
  const visited = new Set<string>()
  function visit(activity: Activity, depth: number): RenderGanttRow | undefined {
    if (visited.has(activity.id)) return
    visited.add(activity.id)
    const summary = activity.activity_type === 'wbs_summary'
    const row: RenderGanttRow = { activity, depth, level: summary ? depth : 'activities',
      start: Date.parse(activity.start ?? ''), finish: Date.parse(activity.finish ?? '') }
    if (!summary || depth > 0) ordered.push(row)
    let first = Infinity, last = -Infinity
    for (const child of children.get(activity.id) ?? []) {
      const dates = visit(child, depth + 1)
      if (!dates) continue
      first = Math.min(first, dates.start)
      last = Math.max(last, dates.finish)
    }
    if (summary && first <= last) {
      row.start = first
      row.finish = last
    }
    if (row.start <= row.finish) return row
  }
  for (const root of children.get(null) ?? []) {
    const depth = root.parent_id ? Math.max(1, (root.wbs_path?.split('.').length ?? 2) - 1) : 0
    visit(root, depth)
  }
  const rows = ordered.filter(row => row.start <= row.finish)
  const levels = [...new Set(rows.flatMap(row => typeof row.level === 'number' ? [row.level] : []))].sort((a,b) => a-b)
  return {rows, levels}
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

// The export band has a fixed height. Centre it on current work, favouring a
// selected child over its longer-running parent, including on backward scrubs.
export function ganttWindow(rows: RenderGanttRow[], now: Date | null, maxRows: number): RenderGanttRow[] {
  if (rows.length <= maxRows) return rows
  if (!now) return rows.slice(0, maxRows)
  const time = now.getTime()
  let active = -1, upcoming = -1, complete = -1
  rows.forEach((row, i) => {
    if (row.start > time) {
      if (upcoming < 0 || row.start < rows[upcoming].start) upcoming = i
    } else if (row.finish < time) {
      if (complete < 0 || row.finish > rows[complete].finish) complete = i
    } else if (active < 0 || row.depth > rows[active].depth ||
      (row.depth === rows[active].depth && row.start > rows[active].start)) {
      active = i
    }
  })
  const focus = active >= 0 ? active : upcoming >= 0 ? upcoming : complete
  const first = Math.max(0, Math.min(rows.length - maxRows, focus - Math.floor(maxRows / 2)))
  return rows.slice(first, first + maxRows)
}
