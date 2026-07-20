import { forwardRef, memo, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_GANTT_STYLE, FONT_FAMILY_CSS, wbsLevelColor, withAlpha, type GanttStyle } from '@/lib/ganttLayout'
import { groupAssignmentsByActivityId } from '@/lib/resourceLabel'
import { formatDateTime } from './dateTime'
import { computeTimeMarks, DAY_WIDTH_BY_ZOOM, ZOOM_OPTIONS, type GanttZoom } from './ganttZoom'
import { isMilestoneType, type Activity, type ActivityRelationship, type ResourceAssignment } from './types'

// The bar-label trio (2026-07-05, per Maro: "show/hide specific fields...
// by the right side of the relevant task, milestone") — joins whichever of
// name/resources/finish are individually switched on in GanttStyle into one
// string, rather than three separately-positioned labels that would need
// their own collision/stacking logic.
//
// resourceAssignments accepts either the raw array (SchedulingPrintView.tsx's
// own direct call, a lower-frequency print path) or a pre-grouped Map from
// groupAssignmentsByActivityId (2026-07-15 — what this file's own render
// loop below now builds once and reuses per bar, instead of this function
// re-filtering the *entire* assignments list on every single bar/activity —
// see resourceLabel.ts's own header on why that's a real O(activities ×
// assignments) freeze on a generate-schedule-sized project).
export function buildBarLabel(a: Activity, style: GanttStyle, resourceAssignments: ResourceAssignment[] | Map<string, ResourceAssignment[]>): string {
  const parts: string[] = []
  if (style.show_label_name) parts.push(a.task_name)
  if (style.show_label_resource) {
    const matches = Array.isArray(resourceAssignments)
      ? resourceAssignments.filter(ra => ra.activity_id === a.id)
      : resourceAssignments.get(a.id) ?? []
    const names = matches.map(ra => ra.resource_name)
    if (names.length > 0) parts.push(names.join(', '))
  }
  if (style.show_label_finish) parts.push(formatDateTime(a.finish, style.show_time_of_day))
  return parts.join('   ·   ')
}

// Connector lines (elbowPath below) always leave a bar horizontally for at
// least this many pixels before turning — a label starting any closer than
// that sits right on top of that departing stub (2026-07-06, per Maro).
// Kept as one constant so the label gap and the connector's own stub can
// never drift back out of sync with each other.
export const CONNECTOR_STUB = 10
export const LABEL_GAP = CONNECTOR_STUB + 6

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

// The live bar is centered on the FULL row height (matching the data grid's
// own vertically-centered text — table cells default to vertical-align:
// middle), with the baseline "ghost" zone squeezed into what's left below it
// (2026-07-05, per Maro: the live bar previously sat in a fixed upper zone
// regardless of row height, reading as slightly off-center against the text).
const BAR_ZONE_HEIGHT = 22
const BAR_CENTER_Y = GANTT_ROW_HEIGHT / 2 // 23
const BAR_ZONE_TOP = BAR_CENTER_Y - BAR_ZONE_HEIGHT / 2 // 12
const MILESTONE_SIZE = 14

const BASELINE_ZONE_TOP = BAR_ZONE_TOP + BAR_ZONE_HEIGHT // 34
const BASELINE_CENTER_Y = BASELINE_ZONE_TOP + (GANTT_ROW_HEIGHT - BASELINE_ZONE_TOP) / 2 // 40
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
  const stub = CONNECTOR_STUB
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

export interface GanttChartHandle {
  // Shifts the row/bar body by -scrollTop via a direct DOM mutation, bypassing
  // React state/re-render entirely (2026-07-05, per Maro: driving this through
  // React state made the Gantt visibly lag behind the data grid while
  // scrolling — a full ~140-row re-render + reconcile on every scroll tick is
  // too slow to track a native scroll gesture smoothly). The grid's onScroll
  // handler (Scheduling.tsx) calls this directly with its own live scrollTop,
  // same principle as before (github.com/pekingstyle/OnlineGantt derives a bar's
  // Y from the grid's real, current scroll state) — just applied without
  // going through a React render this time.
  setScrollTop: (scrollTop: number) => void
}

// memo()'d (2026-07-15, per Maro: "its very laggy") — Scheduling.tsx is one
// large component managing dozens of independent pieces of state (column
// widths, dialogs, editing state, ...); without a memo boundary here, any of
// those unrelated state changes re-executes this component's *entire* body
// (activities.map() over every bar/milestone/connector/baseline shape, no
// windowing) even when none of its own props actually changed. Internal
// geometry/baselineGeometry/criticalById were already useMemo'd, but that
// only skips recomputing the *data* those loops read — the loops (and their
// JSX) still re-ran every time. Safe as a pure bail-out: forwardRef's own
// ref identity is unaffected by wrapping in memo.
export const GanttChart = memo(forwardRef<GanttChartHandle, {
  activities: Activity[]
  relationships?: ActivityRelationship[]
  // Only needed for the show_label_resource toggle — omitted entirely
  // renders as if that toggle were off, regardless of its actual setting.
  resourceAssignments?: ResourceAssignment[]
  style?: GanttStyle
  zoom?: GanttZoom
  // Lets the timescale header itself be click-dragged to zoom (Maro,
  // 2026-07-03: "the zoom widgets ... can stay but what i really wanted was
  // to ... drag with my mouse") — optional since print's static GanttChart
  // has no interactive zoom to change.
  onZoomChange?: (zoom: GanttZoom) => void
  // The row/bar body is clipped to this height — paired with the ref handle
  // above for the live split-pane view. Omit for the static print view, which
  // renders the whole chart unclipped in normal page flow.
  viewportHeight?: number
  // Click-to-select on bars/milestones/WBS-summary shapes (2026-07-09, per
  // Maro: "the gantt in the 4d doesnt interact with the schedule in the
  // 4d") — both optional and both omitted by Scheduling.tsx's own usage
  // (that page drives selection from its own data-grid checkboxes instead,
  // see Scheduling.tsx's selectedActivityIds), so this has zero effect
  // there. Plain click replaces the selection; Ctrl/Cmd+click toggles
  // membership, matching this session's other multi-select controls.
  selectedActivityIds?: Set<string>
  onSelectActivity?: (id: string, additive: boolean) => void
}>(function GanttChart({
  activities,
  relationships = [],
  resourceAssignments = [],
  style = DEFAULT_GANTT_STYLE,
  zoom = 'week',
  onZoomChange,
  viewportHeight,
  selectedActivityIds,
  onSelectActivity,
}, ref) {
  const bodyWrapperRef = useRef<HTMLDivElement>(null)

  // Row virtualization (2026-07-17 perf fix) — see this file's own
  // 2026-07-15 memo() header above: memo only stopped *unrelated*
  // Scheduling.tsx re-renders from re-running this component's whole body;
  // it never addressed the actual "activities.map() over every bar/
  // milestone/connector/baseline shape, no windowing" problem that comment
  // itself flags. scrollTopRef/activitiesLengthRef/viewportHeightRef exist
  // so recomputeVisibleRowRange only ever reads refs, never render-scoped
  // closures — that's what lets the imperative setScrollTop handle below
  // keep a `[]` dependency array (its very first-render closure stays
  // functionally correct forever) while still always computing against the
  // CURRENT scroll position/activity count/viewport height.
  const scrollTopRef = useRef(0)
  const activitiesLengthRef = useRef(activities.length)
  const viewportHeightRef = useRef(viewportHeight)
  const ROW_BUFFER_PX = 600
  const [visibleRowRange, setVisibleRowRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(activities.length, 60) })

  const recomputeVisibleRowRange = () => {
    const vh = viewportHeightRef.current
    // undefined viewportHeight = the static print view, rendered whole and
    // unclipped in normal page flow (see this component's own render below)
    // — nothing to window there, every activity is "visible" by definition.
    if (vh === undefined) return
    const length = activitiesLengthRef.current
    const top = scrollTopRef.current - ROW_BUFFER_PX
    const bottom = scrollTopRef.current + vh + ROW_BUFFER_PX
    const start = Math.max(0, Math.floor(top / GANTT_ROW_HEIGHT))
    const end = Math.min(length, Math.ceil(bottom / GANTT_ROW_HEIGHT))
    setVisibleRowRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  // useLayoutEffect, not useEffect — syncs the refs and corrects the window
  // before paint whenever activities or viewportHeight change (a fresh
  // schedule loading, or the split-pane being resized), so a stale window
  // against brand new data never paints first.
  useLayoutEffect(() => {
    activitiesLengthRef.current = activities.length
    viewportHeightRef.current = viewportHeight
    recomputeVisibleRowRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, viewportHeight])

  const rowDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useImperativeHandle(ref, () => ({
    setScrollTop: (scrollTop: number) => {
      // Immediate DOM mutation, unchanged from before this fix — zero-lag
      // visual tracking during an active scroll (see this handle's own
      // header comment on why this bypasses React state entirely).
      scrollTopRef.current = scrollTop
      if (bodyWrapperRef.current) bodyWrapperRef.current.style.transform = `translateY(${-scrollTop}px)`
      // Debounced, not per-scroll-tick — same "recompute once the gesture
      // pauses, not on every tick" reasoning as every other virtualized
      // table's own scroll handler in this app (e.g. Scheduling.tsx's
      // handleGridScroll).
      if (rowDebounceRef.current !== null) clearTimeout(rowDebounceRef.current)
      rowDebounceRef.current = setTimeout(() => {
        rowDebounceRef.current = null
        recomputeVisibleRowRange()
      }, 150)
    },
  }), [])

  // Clamped to activities.length for the same reason every other virtualized
  // table's window is — activities can shrink (a filter, or a fresh smaller
  // dataset) before this render's own layout effect has corrected the range.
  const clampedRowEnd = Math.min(visibleRowRange.end, activities.length)
  const clampedRowStart = Math.min(visibleRowRange.start, clampedRowEnd)
  const visibleRowIndices = useMemo(
    () => viewportHeight === undefined
      ? activities.map((_, i) => i)
      : Array.from({ length: Math.max(0, clampedRowEnd - clampedRowStart) }, (_, k) => clampedRowStart + k),
    [viewportHeight, activities, clampedRowStart, clampedRowEnd]
  )

  // Built once per resourceAssignments change, not once per bar — see
  // buildBarLabel's own 2026-07-15 header.
  const assignmentsByActivityId = useMemo(() => groupAssignmentsByActivityId(resourceAssignments), [resourceAssignments])

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

      if (isMilestoneType(a.activity_type)) {
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

  const header = (
    <div
      className="relative border-b border-gray-200 bg-gray-50"
      style={{ height: HEADER_HEIGHT, width, cursor: onZoomChange ? 'ew-resize' : undefined }}
      onMouseDown={handleHeaderMouseDown}
      title={onZoomChange ? 'Drag to zoom the timescale' : undefined}
    >
      {timeMarks.map(m => (
        <div
          key={m.offset}
          className="absolute top-0 border-l border-gray-200 pl-1 text-gray-400"
          style={{ left: m.offset * dayWidth, height: HEADER_HEIGHT, lineHeight: `${HEADER_HEIGHT}px`, fontSize: style.gantt_font_size }}
        >
          {m.label}
        </div>
      ))}
    </div>
  )

  const body = (
      <div className="relative" style={{ width, height }}>
        {visibleRowIndices.map(i => {
          const a = activities[i]
          return i % 2 === 1 && (
            <div
              key={`stripe-${a.id}`}
              className="absolute bg-gray-50/70"
              style={{ top: i * GANTT_ROW_HEIGHT, left: 0, width, height: GANTT_ROW_HEIGHT }}
            />
          )
        })}
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
          {style.show_connectors && relationships.map(r => {
            const pred = geometry.get(r.predecessor_id)
            const succ = geometry.get(r.successor_id)
            if (!pred || !succ) return null
            // Windowing check (2026-07-17) — geometry/pred/succ stay full-
            // schedule (relationships can span any distance, no adjacency
            // constraint), only whether this <path> actually mounts gets
            // windowed. A span-overlap check, not an endpoint-only one — a
            // connector between two off-window activities whose line still
            // *passes through* the visible band must still draw.
            if (viewportHeight !== undefined) {
              const bandTop = clampedRowStart * GANTT_ROW_HEIGHT
              const bandBottom = clampedRowEnd * GANTT_ROW_HEIGHT
              const spanTop = Math.min(pred.centerY, succ.centerY)
              const spanBottom = Math.max(pred.centerY, succ.centerY)
              if (spanBottom < bandTop || spanTop > bandBottom) return null
            }
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
        {visibleRowIndices.map(i => {
          const a = activities[i]
          const bl = baselineGeometry.get(a.id)
          if (!bl) return null
          const title = `Baseline: ${formatDateTime(a.bl_start)} → ${formatDateTime(a.bl_finish)}`

          // Baseline milestones get their own small outlined diamond (in
          // baseline_color) instead of the near-zero-width bar a zero-duration
          // milestone would otherwise produce.
          if (isMilestoneType(a.activity_type)) {
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
        {visibleRowIndices.map(i => {
          const a = activities[i]
          const geo = geometry.get(a.id)
          if (!geo) return null
          const critical = a.is_critical === true
          // Secondary indicator (docs/SUBPROJECT_FLOAT_PLAN.md §G, 2026-07-06) —
          // only shown when this activity is critical *within its own tagged
          // sub-project* but not already on the master critical path; if it's
          // already master-critical, that's already the more prominent signal
          // and a second ring would just be redundant noise on top of it.
          const subCritical = style.show_sub_critical && a.sub_is_critical === true && !critical
          const label = buildBarLabel(a, style, assignmentsByActivityId)
          const isSelected = selectedActivityIds?.has(a.id) ?? false
          const selectionRing = isSelected ? `0 0 0 2px #2563eb` : undefined
          const handleBarClick = onSelectActivity
            ? (e: React.MouseEvent) => onSelectActivity(a.id, e.ctrlKey || e.metaKey)
            : undefined
          // className="contents" — an invisible wrapper for layout purposes
          // only, so the bar/milestone shape and its optional label stay
          // two independent absolutely-positioned siblings (both still
          // positioned against this same relative body div) rather than one
          // nested inside the other.
          const labelEl = label && (
            <div
              className="absolute text-gray-500 whitespace-nowrap pointer-events-none"
              style={{ top: geo.centerY - 7, left: geo.right + LABEL_GAP, fontSize: style.gantt_font_size }}
            >
              {label}
            </div>
          )

          if (isMilestoneType(a.activity_type)) {
            const color = critical ? style.milestone_critical_color : style.milestone_noncritical_color
            return (
              <div key={a.id} className="contents">
                <div
                  className={`absolute rotate-45 border ${onSelectActivity ? 'cursor-pointer' : ''}`}
                  onClick={handleBarClick}
                  style={{
                    top: geo.centerY - MILESTONE_SIZE / 2, left: geo.left - MILESTONE_SIZE / 2,
                    width: MILESTONE_SIZE, height: MILESTONE_SIZE,
                    backgroundColor: color, borderColor: withAlpha(color, 0.7),
                    boxShadow: selectionRing ?? (subCritical ? `0 0 0 2px ${style.sub_critical_color}` : undefined),
                  }}
                  title={`${a.task_name} — ${formatDateTime(a.start ?? a.finish)}${critical ? ' (critical)' : ''}${subCritical ? ' (critical within its sub-project)' : ''}`}
                />
                {labelEl}
              </div>
            )
          }

          if (a.activity_type === 'wbs_summary') {
            const color = wbsLevelColor(style, depthOf(a))
            return (
              <div key={a.id} className="contents">
                {/* WbsSummaryBar's own <svg> is pointer-events-none (it's a
                    decorative bracket shape, not normally clickable) — this
                    wrapper is given the exact same absolute bounds so a click
                    on that area still lands on *something* (the wrapper's own
                    box, which the SVG's pointer-events-none lets through to). */}
                <div
                  onClick={handleBarClick}
                  className={`absolute ${onSelectActivity ? 'cursor-pointer' : ''}`}
                  style={{
                    left: geo.left, top: geo.top, width: Math.max(geo.right - geo.left, 1), height: GANTT_ROW_HEIGHT,
                    boxShadow: selectionRing,
                  }}
                  title={`${a.task_name}: ${formatDateTime(a.start)} → ${formatDateTime(a.finish)}`}
                >
                  <WbsSummaryBar left={0} right={geo.right - geo.left} top={0} centerY={BAR_CENTER_Y} color={color} />
                </div>
                {labelEl}
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
            <div key={a.id} className="contents">
              <div
                onClick={handleBarClick}
                className={`absolute overflow-hidden rounded border-2 ${onSelectActivity ? 'cursor-pointer' : ''}`}
                style={{
                  top: geo.top + BAR_ZONE_TOP, left: geo.left, width: geo.right - geo.left, height: BAR_ZONE_HEIGHT,
                  backgroundColor: withAlpha(color, 0.25), borderColor: color,
                  boxShadow: selectionRing ?? (subCritical ? `0 0 0 2px ${style.sub_critical_color}` : undefined),
                }}
                title={`${a.task_name}: ${formatDateTime(a.start)} → ${formatDateTime(a.finish)} (${pct}% complete)${critical ? ' — critical path' : ''}${subCritical ? ' — critical within its sub-project' : ''}`}
              >
                <div className="h-full" style={{ width: `${pct}%`, backgroundColor: color }} />
              </div>
              {labelEl}
            </div>
          )
        })}
      </div>
  )

  return (
    <div style={{ width, minWidth: '100%', fontFamily: FONT_FAMILY_CSS[style.gantt_font_family] }}>
      {header}
      {viewportHeight !== undefined ? (
        <div style={{ height: viewportHeight, overflow: 'hidden', position: 'relative' }}>
          <div ref={bodyWrapperRef}>
            {body}
          </div>
        </div>
      ) : body}
    </div>
  )
}))
