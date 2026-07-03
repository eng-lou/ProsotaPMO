import { useMemo, useRef } from 'react'
import { DEFAULT_GANTT_STYLE, wbsLevelColor, withAlpha, type GanttStyle } from '@/lib/ganttLayout'
import { formatDateTime } from './dateTime'
import { computeTimeMarks, DAY_WIDTH_BY_ZOOM, ZOOM_OPTIONS, type GanttZoom } from './ganttZoom'
import type { Activity, ActivityRelationship } from './types'

const ZOOM_ORDER = ZOOM_OPTIONS.map(o => o.value)
// Pixels of horizontal drag needed to cross one zoom level — tuned so a
// deliberate drag across the header steps through 2-3 levels, not a hair-
// trigger jump on the first pixel of movement.
const PX_PER_ZOOM_STEP = 80

// Row height must match the data grid's row height exactly (Scheduling.tsx) so the
// two panes stay visually aligned under the shared scroll-sync — see the "Gantt Chart
// — Rendering Plan" section of docs/SCHEDULING_MODULE_PLAN.md. Dependency arrows
// (Phase 3), critical-path colouring (Phase 5), and baseline ghost bars (Phase 6,
// once bl_start/bl_finish are captured via "Set Baseline") are all in place.
//
// A row is split into two vertical zones so the main bar/milestone/WBS-line and
// their baseline counterparts never overlap (2026-07-03, per Maro — the bars sat
// too close together at the old 40px row height): a BAR zone for the live plan,
// and a shorter BASELINE zone underneath for the ghost/comparison marks.
export const GANTT_ROW_HEIGHT = 46
// Must match the data grid's <thead> row height (Scheduling.tsx) so week labels and
// activity rows line up between the two panes. Exported so SchedulingPrintView.tsx
// can match its own printed table's header height the same way.
export const HEADER_HEIGHT = 36

const BAR_ZONE_TOP = 5
const BAR_ZONE_HEIGHT = 22
const BAR_CENTER_Y = BAR_ZONE_TOP + BAR_ZONE_HEIGHT / 2 // 16
const MILESTONE_SIZE = 14

const BASELINE_ZONE_TOP = 30
const BASELINE_CENTER_Y = 38
const BASELINE_MILESTONE_SIZE = 10

// Phase 10: start/finish/bl_start/bl_finish are full ISO datetimes, not date-only
// strings — parsed directly rather than forced to midnight.
function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function depthOf(a: Activity): number {
  return a.wbs_path ? a.wbs_path.split('.').length - 1 : 0
}

// Unrounded — a bar's pixel position/width should reflect its actual hour-of-day
// span (e.g. a task starting at noon shouldn't render as starting at day-start),
// even though dayWidth is coarse enough that sub-day differences are subtle.
function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000
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

// The classic P6/MS Project "WBS summary" bar: a bracket-shaped jagged line
// (not a filled bar — see GanttLegend.tsx) rather than the usual rounded
// task/critical bar, so a rollup row reads as structure rather than work.
// Reused for both the live plan (centerY = BAR_CENTER_Y) and the baseline
// ghost version (centerY = BASELINE_CENTER_Y, colour = baseline_color).
export function WbsSummaryBar({
  left, right, top, centerY, color,
}: { left: number; right: number; top: number; centerY: number; color: string }) {
  const w = Math.max(right - left, 1)
  const capW = Math.min(7, Math.max(3, w / 4))
  return (
    <svg
      className="absolute overflow-visible pointer-events-none"
      style={{ left, top, width: w, height: GANTT_ROW_HEIGHT }}
    >
      <path
        d={`M0,${centerY - 6} L0,${centerY + 2} L${capW},${centerY - 6} M${capW},${centerY - 6} L${w - capW},${centerY - 6} L${w},${centerY + 2} L${w},${centerY - 6} M${w - capW},${centerY - 6}`}
        fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round"
      />
    </svg>
  )
}

export function GanttChart({
  activities,
  relationships = [],
  style = DEFAULT_GANTT_STYLE,
  zoom = 'week',
  onZoomChange,
}: {
  activities: Activity[]
  relationships?: ActivityRelationship[]
  style?: GanttStyle
  zoom?: GanttZoom
  // Lets the timescale header itself be click-dragged to zoom (Maro,
  // 2026-07-03: "the zoom widgets ... can stay but what i really wanted was
  // to ... drag with my mouse") — optional since print's static GanttChart
  // has no interactive zoom to change.
  onZoomChange?: (zoom: GanttZoom) => void
}) {
  const dayWidth = DAY_WIDTH_BY_ZOOM[zoom]

  // mousedown on the header starts tracking; every PX_PER_ZOOM_STEP of
  // horizontal drag crosses one zoom level (drag right = more detail/toward
  // "day", drag left = less detail/toward "year"). Dragging is purely a
  // convenience alias for the same discrete levels the Zoom buttons set —
  // it's not continuous/arbitrary zoom.
  const dragState = useRef<{ startX: number; startIndex: number; lastIndex: number } | null>(null)
  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if (!onZoomChange) return
    e.preventDefault()
    const startIndex = ZOOM_ORDER.indexOf(zoom)
    dragState.current = { startX: e.clientX, startIndex, lastIndex: startIndex }
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!dragState.current) return
      const delta = moveEvent.clientX - dragState.current.startX
      const steps = Math.round(delta / PX_PER_ZOOM_STEP)
      const newIndex = Math.min(ZOOM_ORDER.length - 1, Math.max(0, dragState.current.startIndex - steps))
      if (newIndex !== dragState.current.lastIndex) {
        dragState.current.lastIndex = newIndex
        onZoomChange(ZOOM_ORDER[newIndex])
      }
    }
    const onMouseUp = () => {
      dragState.current = null
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }

  const { rangeStart, totalDays } = useMemo(() => {
    const dates = activities
      .flatMap(a => [parseDate(a.start), parseDate(a.finish), parseDate(a.bl_start), parseDate(a.bl_finish)])
      .filter((d): d is Date => d !== null)

    const today = new Date()
    const min = dates.length ? new Date(Math.min(...dates.map(d => d.getTime()))) : today
    const max = dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : today
    min.setDate(min.getDate() - 7)
    max.setDate(max.getDate() + 7)

    return { rangeStart: min, totalDays: Math.max(daysBetween(min, max), 42) }
  }, [activities])

  const timeMarks = useMemo(() => computeTimeMarks(rangeStart, totalDays, zoom), [rangeStart, totalDays, zoom])

  const width = totalDays * dayWidth
  const height = activities.length * GANTT_ROW_HEIGHT

  // A "today" marker gives the chart a real anchor point — null (not drawn) if
  // today falls outside the currently-rendered date range.
  const todayOffset = useMemo(() => {
    const offset = daysBetween(rangeStart, new Date()) * dayWidth
    return offset >= 0 && offset <= width ? offset : null
  }, [rangeStart, width, dayWidth])

  const geometry = useMemo(() => {
    const map = new Map<string, BarGeometry>()
    activities.forEach((a, i) => {
      const top = i * GANTT_ROW_HEIGHT
      const centerY = top + BAR_CENTER_Y
      const start = parseDate(a.start)
      const finish = parseDate(a.finish)

      if (a.activity_type === 'milestone') {
        const at = start ?? finish
        if (!at) return
        const x = daysBetween(rangeStart, at) * dayWidth
        map.set(a.id, { top, centerY, left: x, right: x })
        return
      }
      if (!start || !finish) return
      const left = daysBetween(rangeStart, start) * dayWidth
      const right = left + Math.max(daysBetween(start, finish) * dayWidth, 6)
      map.set(a.id, { top, centerY, left, right })
    })
    return map
  }, [activities, rangeStart, dayWidth])

  const criticalById = useMemo(() => new Map(activities.map(a => [a.id, a.is_critical === true])), [activities])

  const baselineGeometry = useMemo(() => {
    const map = new Map<string, { top: number; left: number; right: number }>()
    activities.forEach((a, i) => {
      const start = parseDate(a.bl_start)
      const finish = parseDate(a.bl_finish)
      if (!start || !finish) return
      const top = i * GANTT_ROW_HEIGHT
      const left = daysBetween(rangeStart, start) * dayWidth
      const right = left + Math.max(daysBetween(start, finish) * dayWidth, 6)
      map.set(a.id, { top, left, right })
    })
    return map
  }, [activities, rangeStart, dayWidth])

  return (
    <div style={{ width, minWidth: '100%' }}>
      <div
        className="relative border-b border-gray-200 bg-gray-50"
        style={{ height: HEADER_HEIGHT, width, cursor: onZoomChange ? 'ew-resize' : undefined }}
        onMouseDown={handleHeaderMouseDown}
        title={onZoomChange ? 'Drag to zoom the timescale' : undefined}
      >
        {timeMarks.map(m => (
          <div
            key={m.offset}
            className="absolute top-0 border-l border-gray-200 pl-1 text-[10px] text-gray-400"
            style={{ left: m.offset * dayWidth, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px` }}
          >
            {m.label}
          </div>
        ))}
      </div>
      <div className="relative" style={{ width, height }}>
        {activities.map((a, i) => (
          i % 2 === 1 && (
            <div
              key={`stripe-${a.id}`}
              className="absolute bg-gray-50/70"
              style={{ top: i * GANTT_ROW_HEIGHT, left: 0, width, height: GANTT_ROW_HEIGHT }}
            />
          )
        ))}
        <svg className="absolute inset-0 pointer-events-none" width={width} height={height}>
          <defs>
            <marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" fill="#94a3b8" />
            </marker>
            <marker id="gantt-arrow-critical" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 Z" fill={style.critical_color} />
            </marker>
          </defs>
          {timeMarks.map(m => (
            <line
              key={`grid-${m.offset}`}
              x1={m.offset * dayWidth} y1={0} x2={m.offset * dayWidth} y2={height}
              stroke="#e5e7eb" strokeWidth={1}
            />
          ))}
          {todayOffset !== null && (
            <line x1={todayOffset} y1={0} x2={todayOffset} y2={height} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" />
          )}
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
                stroke={critical ? style.critical_color : '#94a3b8'}
                strokeWidth={1.5}
                markerEnd={critical ? 'url(#gantt-arrow-critical)' : 'url(#gantt-arrow)'}
              />
            )
          })}
        </svg>
        {activities.map(a => {
          const bl = baselineGeometry.get(a.id)
          if (!bl) return null
          const title = `Baseline: ${formatDateTime(a.bl_start)} → ${formatDateTime(a.bl_finish)}`

          // Baseline milestones get their own small outlined diamond (in
          // baseline_color) instead of the near-zero-width bar a zero-duration
          // milestone would otherwise produce.
          if (a.activity_type === 'milestone') {
            return (
              <div
                key={`bl-${a.id}`}
                className="absolute rotate-45 border-2 bg-white"
                style={{
                  top: bl.top + BASELINE_CENTER_Y - BASELINE_MILESTONE_SIZE / 2,
                  left: bl.left - BASELINE_MILESTONE_SIZE / 2,
                  width: BASELINE_MILESTONE_SIZE, height: BASELINE_MILESTONE_SIZE,
                  borderColor: style.baseline_color,
                }}
                title={title}
              />
            )
          }

          // Baseline WBS summary — same bracket shape as the live one, in
          // baseline_color, sitting in the baseline zone underneath.
          if (a.activity_type === 'wbs_summary') {
            return (
              <div key={`bl-${a.id}`} title={title}>
                <WbsSummaryBar left={bl.left} right={bl.right} top={bl.top} centerY={BASELINE_CENTER_Y} color={style.baseline_color} />
              </div>
            )
          }

          const thickness = style.baseline_thickness
          return (
            <div
              key={`bl-${a.id}`}
              className="absolute rounded-sm border"
              style={{
                top: bl.top + Math.max(BASELINE_ZONE_TOP, BASELINE_CENTER_Y - thickness / 2),
                left: bl.left, width: Math.max(bl.right - bl.left, 4), height: thickness,
                backgroundColor: withAlpha(style.baseline_color, 0.55), borderColor: style.baseline_color,
              }}
              title={title}
            />
          )
        })}
        {activities.map(a => {
          const geo = geometry.get(a.id)
          if (!geo) return null
          const critical = a.is_critical === true

          if (a.activity_type === 'milestone') {
            const color = critical ? style.milestone_critical_color : style.milestone_noncritical_color
            return (
              <div
                key={a.id}
                className="absolute rotate-45 border"
                style={{
                  top: geo.centerY - MILESTONE_SIZE / 2, left: geo.left - MILESTONE_SIZE / 2,
                  width: MILESTONE_SIZE, height: MILESTONE_SIZE,
                  backgroundColor: color, borderColor: withAlpha(color, 0.7),
                }}
                title={`${a.task_name} — ${formatDateTime(a.start ?? a.finish)}${critical ? ' (critical)' : ''}`}
              />
            )
          }

          if (a.activity_type === 'wbs_summary') {
            const color = wbsLevelColor(style, depthOf(a))
            return (
              <div key={a.id} title={`${a.task_name}: ${formatDateTime(a.start)} → ${formatDateTime(a.finish)}`}>
                <WbsSummaryBar left={geo.left} right={geo.right} top={geo.top} centerY={BAR_CENTER_Y} color={color} />
              </div>
            )
          }

          const pct = a.pct_complete ? Math.min(Number(a.pct_complete), 100) : 0
          const color = critical ? style.critical_color : style.non_critical_color
          // Pale fills with no outline barely register against the pane's white
          // background, especially at 0% progress where the darker inner fill
          // is invisible too — a solid border makes the bar's extent legible
          // at a glance regardless of progress.
          return (
            <div
              key={a.id}
              className="absolute overflow-hidden rounded border-2"
              style={{
                top: geo.top + BAR_ZONE_TOP, left: geo.left, width: geo.right - geo.left, height: BAR_ZONE_HEIGHT,
                backgroundColor: withAlpha(color, 0.25), borderColor: color,
              }}
              title={`${a.task_name}: ${formatDateTime(a.start)} → ${formatDateTime(a.finish)} (${pct}% complete)${critical ? ' — critical path' : ''}`}
            >
              <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
