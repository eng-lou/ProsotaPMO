import { useMemo } from 'react'
import type { Activity } from './types'

// Row height must match the data grid's row height exactly (Scheduling.tsx) so the
// two panes stay visually aligned under the shared scroll-sync — see the "Gantt Chart
// — Rendering Plan" section of docs/SCHEDULING_MODULE_PLAN.md. Fidelity (dependency
// arrows, critical-path colour, baseline ghost bars) is added in later phases; this is
// deliberately just plain bars + a milestone diamond for Phase 1.
export const GANTT_ROW_HEIGHT = 40
const DAY_WIDTH = 14
// Must match the data grid's <thead> row height (Scheduling.tsx) so week labels and
// activity rows line up between the two panes.
const HEADER_HEIGHT = 36

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

export function GanttChart({ activities }: { activities: Activity[] }) {
  const { rangeStart, totalDays, weekMarks } = useMemo(() => {
    const dates = activities
      .flatMap(a => [parseDate(a.start), parseDate(a.finish)])
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
      <div className="relative" style={{ width, height: activities.length * GANTT_ROW_HEIGHT }}>
        {activities.map((a, i) => {
          const top = i * GANTT_ROW_HEIGHT
          const start = parseDate(a.start)
          const finish = parseDate(a.finish)

          if (a.activity_type === 'milestone') {
            const at = start ?? finish
            if (!at) return null
            const left = daysBetween(rangeStart, at) * DAY_WIDTH
            return (
              <div
                key={a.id}
                className="absolute h-3 w-3 rotate-45 bg-purple-500"
                style={{ top: top + GANTT_ROW_HEIGHT / 2 - 6, left: left - 6 }}
                title={`${a.task_name} — ${a.start ?? a.finish}`}
              />
            )
          }

          if (!start || !finish) return null
          const left = daysBetween(rangeStart, start) * DAY_WIDTH
          const barWidth = Math.max(daysBetween(start, finish) * DAY_WIDTH, 6)
          const pct = a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0

          return (
            <div
              key={a.id}
              className="absolute overflow-hidden rounded bg-blue-100"
              style={{ top: top + 7, left, width: barWidth, height: GANTT_ROW_HEIGHT - 14 }}
              title={`${a.task_name}: ${a.start} → ${a.finish} (${pct}% complete)`}
            >
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
