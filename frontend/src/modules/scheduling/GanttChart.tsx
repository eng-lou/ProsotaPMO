import { useMemo } from 'react'
import type { Activity, ActivityRelationship } from './types'

// Row height must match the data grid's row height exactly (Scheduling.tsx) so the
// two panes stay visually aligned under the shared scroll-sync — see the "Gantt Chart
// — Rendering Plan" section of docs/SCHEDULING_MODULE_PLAN.md. Dependency arrows
// (Phase 3), critical-path colouring (Phase 5), and baseline ghost bars (Phase 6,
// once bl_start/bl_finish are captured via "Set Baseline") are all in place.
export const GANTT_ROW_HEIGHT = 40
const DAY_WIDTH = 14
// Must match the data grid's <thead> row height (Scheduling.tsx) so week labels and
// activity rows line up between the two panes.
const HEADER_HEIGHT = 36
const BAR_INSET = 7

function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function formatWeekLabel(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function mondayOnOrBefore(d: Date): Date {
  const result = new Date(d)
  const day = result.getDay()
  const diff = day === 0 ? 6 : day - 1
  result.setDate(result.getDate() - diff)
  return result
}

interface BarGeometry {
  top: number
  centerY: number
  left: number
  right: number
}

// Elbow-routed dependency line, MS Project style: out from the source connection
// point, across, then into the target connection point.
function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  const stub = 10
  if (x2 >= x1 + stub || (y1 === y2 && x2 >= x1)) {
    const midX = Math.min(x1 + stub, Math.max(x1, x2 - stub))
    return `M ${x1},${y1} H ${midX} V ${y2} H ${x2}`
  }
  const outX = x1 + stub
  const inX = x2 - stub
  const midY = (y1 + y2) / 2
  return `M ${x1},${y1} H ${outX} V ${midY} H ${inX} V ${y2} H ${x2}`
}

export function GanttChart({
  activities,
  relationships = [],
}: {
  activities: Activity[]
  relationships?: ActivityRelationship[]
}) {
  const { rangeStart, totalDays, weekMarks } = useMemo(() => {
    const dates = activities
      .flatMap(a => [parseDate(a.start), parseDate(a.finish), parseDate(a.bl_start), parseDate(a.bl_finish)])
      .filter((d): d is Date => d !== null)

    const today = new Date()
    const min = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : today
    const max = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : today
    min.setDate(min.getDate() - 7)
    max.setDate(max.getDate() + 7)

    const total = Math.max(daysBetween(min, max), 42)
    const marks: { offset: number; label: string }[] = []
    const cursor = mondayOnOrBefore(min)
    while (daysBetween(min, cursor) < total) {
      marks.push({ offset: daysBetween(min, cursor), label: formatWeekLabel(cursor) })
      cursor.setDate(cursor.getDate() + 7)
    }

    return { rangeStart: min, totalDays: total, weekMarks: marks }
  }, [activities])

  const width = totalDays * DAY_WIDTH
  const height = activities.length * GANTT_ROW_HEIGHT

  const geometry = useMemo(() => {
    const map = new Map<string, BarGeometry>()
    activities.forEach((a, i) => {
      const top = i * GANTT_ROW_HEIGHT
      const centerY = top + GANTT_ROW_HEIGHT / 2
      const start = parseDate(a.start)
      const finish = parseDate(a.finish)

      if (a.activity_type === 'milestone') {
        const at = start ?? finish
        if (!at) return
        const x = daysBetween(rangeStart, at) * DAY_WIDTH
        map.set(a.id, { top, centerY, left: x, right: x })
        return
      }
      if (!start || !finish) return
      const left = daysBetween(rangeStart, start) * DAY_WIDTH
      const right = left + Math.max(daysBetween(start, finish) * DAY_WIDTH, 6)
      map.set(a.id, { top, centerY, left, right })
    })
    return map
  }, [activities, rangeStart])

  const criticalById = useMemo(() => new Map(activities.map(a => [a.id, a.is_critical === true])), [activities])

  const baselineGeometry = useMemo(() => {
    const map = new Map<string, { top: number; left: number; right: number }>()
    activities.forEach((a, i) => {
      const start = parseDate(a.bl_start)
      const finish = parseDate(a.bl_finish)
      if (!start || !finish) return
      const top = i * GANTT_ROW_HEIGHT
      const left = daysBetween(rangeStart, start) * DAY_WIDTH
      const right = left + Math.max(daysBetween(start, finish) * DAY_WIDTH, 6)
      map.set(a.id, { top, left, right })
    })
    return map
  }, [activities, rangeStart])

  return (
    <div style={{ width, minWidth: '100%' }}>
      <div className="relative border-b border-gray-200 bg-gray-50" style={{ height: HEADER_HEIGHT, width }}>
        {weekMarks.map(m => (
          <div
            key={m.offset}
            className="absolute top-0 border-l border-gray-200 pl-1 text-[10px] text-gray-400"
            style={{ left: m.offset * DAY_WIDTH, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px` }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="relative" style={{ width, height }}>
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          <defs>
            <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
            </marker>
            <marker id="gantt-arrow-critical" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" fill="#ef4444" />
            </marker>
          </defs>
          {relationships.map(r => {
            const pred = geometry.get(r.predecessor_id)
            const succ = geometry.get(r.successor_id)
            if (!pred || !succ) return null
            const x1 = r.relationship_type === 'SS' || r.relationship_type === 'SF' ? pred.left : pred.right
            const x2 = r.relationship_type === 'FF' || r.relationship_type === 'SF' ? succ.right : succ.left
            const critical = criticalById.get(r.predecessor_id) && criticalById.get(r.successor_id)
            return (
              <path
                key={r.id}
                d={elbowPath(x1, pred.centerY, x2, succ.centerY)}
                fill="none"
                stroke={critical ? '#ef4444' : '#94a3b8'}
                strokeWidth={1.5}
                markerEnd={critical ? 'url(#gantt-arrow-critical)' : 'url(#gantt-arrow)'}
              />
            )
          })}
        </svg>
        {activities.map(a => {
          const bl = baselineGeometry.get(a.id)
          if (!bl) return null
          return (
            <div
              key={`bl-${a.id}`}
              className="absolute rounded-sm border border-gray-400 bg-gray-200/60"
              style={{ top: bl.top + GANTT_ROW_HEIGHT - 8, left: bl.left, width: Math.max(bl.right - bl.left, 4), height: 4 }}
              title={`Baseline: ${a.bl_start} → ${a.bl_finish}`}
            />
          )
        })}
        {activities.map(a => {
          const geo = geometry.get(a.id)
          if (!geo) return null
          const critical = a.is_critical === true

          if (a.activity_type === 'milestone') {
            return (
              <div
                key={a.id}
                className={`absolute h-3 w-3 rotate-45 ${critical ? 'bg-red-500' : 'bg-purple-500'}`}
                style={{ top: geo.centerY - 6, left: geo.left - 6 }}
                title={`${a.task_name} — ${a.start ?? a.finish}${critical ? ' (critical)' : ''}`}
              />
            )
          }

          const pct = a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0
          return (
            <div
              key={a.id}
              className={`absolute overflow-hidden rounded ${critical ? 'bg-red-100' : 'bg-blue-100'}`}
              style={{ top: geo.top + BAR_INSET, left: geo.left, width: geo.right - geo.left, height: GANTT_ROW_HEIGHT - BAR_INSET * 2 }}
              title={`${a.task_name}: ${a.start} → ${a.finish} (${pct}% complete)${critical ? ' — critical path' : ''}`}
            >
              <div className={`h-full ${critical ? 'bg-red-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
