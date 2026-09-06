import { useEffect, useRef, useState } from 'react'
import type { MilestoneTimelineItem } from './types'

function formatDate(value: string | null) {
  if (value === null) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatTick(t: number) {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
}

// Delayed (variance_days > 0) beats critical, same bucket precedence
// Dashboard.tsx/dashboard.py already use for Schedule Performance — a
// milestone that's both late and on the critical path reads as "late," not
// "at risk of becoming late."
function statusColor(m: MilestoneTimelineItem): string {
  if (m.variance_days !== null && m.variance_days > 0) return '#dc2626'
  if (m.is_critical) return '#d97706'
  return '#16a34a'
}

interface MilestoneTrackProps {
  milestones: MilestoneTimelineItem[]
  // Cross-widget "click to filter" source wiring (2026-09-06) — optional so
  // every other MilestoneTrack caller (none currently pass these) keeps
  // working unchanged.
  onMilestoneClick?: (id: string) => void
  selectedId?: string | null
}

const TICK_COUNT = 6
// Base offsets (px above the axis) for row 0 — the dot sits a clear 12px
// above the line, the label a further clear gap above the dot (2026-08-28
// fix for "milestone points and texts are close to the line").
const DOT_BOTTOM_PX = 12
const LABEL_BOTTOM_PX = 36
// How far apart each stacked row sits — tall enough that row N's label
// clears row N-1's dot+label block entirely, not just its dot.
const ROW_STEP_PX = 62
// A milestone's on-screen footprint for collision purposes — the label's
// own max-width (140px) plus a little breathing room, so two labels that
// would otherwise touch still count as "colliding" and get stacked.
const LABEL_FOOTPRINT_PX = 150
const BASE_MIN_HEIGHT = 190

// A real interval timeline — a dated axis with regular tick marks running
// underneath (per Maro: "single line is stupid, timeline intervalled with
// points is better"), not just a bare line connecting two dots. Milestones
// sit above the axis, positioned by real date; calendar ticks sit below it,
// so the two never collide regardless of how few milestones there are.
export function MilestoneTrack({ milestones, onMilestoneClick, selectedId }: MilestoneTrackProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Needed to convert each milestone's percentage position into real pixels
  // for the row-stacking collision check below — a fixed fallback (a typical
  // dashboard-widget width) until the first real measurement lands, so
  // nothing crashes or divides by zero on the very first render.
  const [width, setWidth] = useState(500)

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const update = () => {
      const w = node.getBoundingClientRect().width
      if (w > 0) setWidth(w)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const dated = milestones.filter(m => m.finish !== null)

  if (dated.length === 0) {
    return <div className="text-xs text-gray-400 dark:text-prosota-muted py-8 text-center">No milestones yet.</div>
  }

  const times = dated.map(m => new Date(m.finish!).getTime())
  const rawMin = Math.min(...times)
  const rawMax = Math.max(...times)
  const rawSpan = rawMax - rawMin || 1000 * 60 * 60 * 24 * 30 // a single milestone gets a fake 30-day span to sit inside

  // Pad 8% either side so a milestone never sits exactly on the axis's own edge.
  const pad = rawSpan * 0.08
  const minTime = rawMin - pad
  const maxTime = rawMax + pad
  const span = maxTime - minTime

  const positionOf = (t: number) => ((t - minTime) / span) * 100

  const ticks = Array.from({ length: TICK_COUNT }, (_, i) => minTime + (span * i) / (TICK_COUNT - 1))

  // Stack milestones vertically wherever two or more land close enough
  // together that their labels would otherwise overlap (2026-08-28, per
  // Maro: "where there's more than one on the same point, space
  // vertically"). Greedy left-to-right placement: each milestone takes the
  // lowest row whose last-placed item doesn't horizontally collide with it,
  // using the real measured width to convert its %-position into a pixel
  // footprint rather than guessing a date-based threshold.
  const positioned = dated
    .map(m => ({ m, left: positionOf(new Date(m.finish!).getTime()) }))
    .sort((a, b) => a.left - b.left)

  const rowRightEdgePx: number[] = []
  const rows = positioned.map(({ m, left }) => {
    const centerPx = (left / 100) * width
    let row = 0
    while (rowRightEdgePx[row] !== undefined && centerPx - LABEL_FOOTPRINT_PX / 2 < rowRightEdgePx[row]) {
      row++
    }
    rowRightEdgePx[row] = centerPx + LABEL_FOOTPRINT_PX / 2
    return { m, left, row }
  })

  const maxRow = rows.reduce((max, r) => Math.max(max, r.row), 0)

  return (
    <div
      ref={containerRef}
      className="relative pb-12"
      style={{ minHeight: BASE_MIN_HEIGHT + maxRow * ROW_STEP_PX, paddingTop: 64 + maxRow * ROW_STEP_PX }}
    >
      <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-200" />

      {/* Calendar interval ticks — below the axis, purely a scale reference.
          Anchored at the axis's own vertical centre (top-1/2, zero-height
          wrapper) rather than translated onto it, same "position by anchor,
          not by straddling the line" fix as the milestones below. */}
      {ticks.map((t, i) => (
        <div key={i} className="absolute top-1/2" style={{ left: `${positionOf(t)}%` }}>
          <span className="absolute top-2 left-1/2 -translate-x-1/2 block w-px h-3 bg-gray-300" />
          <div className="absolute top-7 left-1/2 -translate-x-1/2 text-[10px] text-gray-400 dark:text-prosota-muted whitespace-nowrap">
            {formatTick(t)}
          </div>
        </div>
      ))}

      {/* Milestones — above the axis, positioned by real date. Anchored at
          the axis's own vertical centre (a zero-height wrapper, same trick
          as the ticks above) with bottom-offset children stacking upward
          from there; a milestone in a colliding cluster gets pushed up a
          further row * ROW_STEP_PX so its dot+label sit clear of the
          cluster below it instead of overlapping into unreadable text. */}
      {rows.map(({ m, left, row }) => (
        <div
          key={m.id}
          className={`absolute top-1/2 ${onMilestoneClick ? 'cursor-pointer' : ''}`}
          style={{ left: `${left}%`, transform: 'translateX(-50%)' }}
          onClick={onMilestoneClick ? () => onMilestoneClick(m.id) : undefined}
        >
          <span
            className={`absolute left-1/2 -translate-x-1/2 block w-3 h-3 rounded-full ring-2 ${selectedId === m.id ? 'ring-prosota-amber' : 'ring-white'}`}
            style={{ backgroundColor: statusColor(m), bottom: DOT_BOTTOM_PX + row * ROW_STEP_PX }}
            title={m.task_name}
          />
          <div
            className="absolute w-max max-w-[140px] text-center left-1/2 -translate-x-1/2 text-xs"
            style={{ bottom: LABEL_BOTTOM_PX + row * ROW_STEP_PX }}
          >
            <div className={`font-medium leading-tight ${selectedId === m.id ? 'text-prosota-amber' : 'text-gray-700 dark:text-prosota-muted'}`}>{m.task_name}</div>
            <div className="text-gray-400 dark:text-prosota-muted mt-0.5">{formatDate(m.finish)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
