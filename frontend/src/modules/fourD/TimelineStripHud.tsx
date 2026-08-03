import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import { computeScheduleRange } from './timelinePlayback'
import type { TimelineStrip } from './timelineStrips'

interface Props {
  strip: TimelineStrip
  activities: Activity[]
  matchingIds: Set<string>
  // Same "read a ref every animation frame, never a React prop" reasoning
  // FourD.tsx's own timelineDateRef header documents — see
  // RadialChartHud.tsx's matching prop for the full rationale.
  timelineDateRef: React.MutableRefObject<Date | null>
  containerRef: React.RefObject<HTMLDivElement>
  onCommitPosition: (positionXPct: number, positionYPct: number) => void
}

// Exported (2026-08-03) so exportOverlays.ts's own drawTimelineStrip can
// build the exact same cell layout for a captured still/video frame — one
// implementation of the layout math for both, same "no second copy of the
// same logic" precedent this module's other drawXxx export functions
// already follow for Gantt/Table/etc.
export const MONTH_LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']

export interface MonthCell {
  year: number
  month: number // 0-11
}

export function buildMonthCells(start: Date, end: Date): MonthCell[] {
  const cells: MonthCell[] = []
  let y = start.getFullYear()
  let m = start.getMonth()
  const endY = end.getFullYear()
  const endM = end.getMonth()
  // Same runaway-loop guard spirit as elsewhere in this module — a
  // corrupted/absurd date range (centuries apart) shouldn't hang the tab.
  let guard = 0
  while ((y < endY || (y === endY && m <= endM)) && guard < 5000) {
    cells.push({ year: y, month: m })
    m++
    if (m > 11) { m = 0; y++ }
    guard++
  }
  return cells
}

export interface YearGroup {
  year: number
  startIndex: number
  count: number
}

export function groupByYear(cells: MonthCell[]): YearGroup[] {
  const groups: YearGroup[] = []
  for (let i = 0; i < cells.length; i++) {
    const last = groups[groups.length - 1]
    if (last && last.year === cells[i].year) last.count++
    else groups.push({ year: cells[i].year, startIndex: i, count: 1 })
  }
  return groups
}

// Live, draggable year/month timeline strip HUD (2026-08-03) — see
// timeline_strip.py's own docstring for the full "why". Renders as a plain
// absolutely-positioned <div> sibling to Viewport3D's <Canvas>, same
// convention RadialChartHud.tsx already established.
export function TimelineStripHud({ strip, activities, matchingIds, timelineDateRef, containerRef, onCommitPosition }: Props) {
  const [playheadDate, setPlayheadDate] = useState<Date | null>(null)
  const [localPos, setLocalPos] = useState({ x: strip.position_x_pct, y: strip.position_y_pct })
  const isDraggingRef = useRef(false)

  const domain = useMemo(() => {
    const scoped = activities.filter(a => matchingIds.has(a.id))
    return computeScheduleRange(scoped)
  }, [activities, matchingIds])

  const cells = useMemo(() => (domain ? buildMonthCells(domain.start, domain.end) : []), [domain])
  const yearGroups = useMemo(() => groupByYear(cells), [cells])

  // Own rAF tick loop, same isolated-per-widget pattern as
  // RadialChartHud.tsx — a scrub frame only re-renders this strip, not the
  // whole tree.
  useEffect(() => {
    let raf: number
    const tick = () => {
      setPlayheadDate(timelineDateRef.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [timelineDateRef])

  useEffect(() => {
    if (!isDraggingRef.current) setLocalPos({ x: strip.position_x_pct, y: strip.position_y_pct })
  }, [strip.position_x_pct, strip.position_y_pct])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    isDraggingRef.current = true

    const onMove = (moveEvent: MouseEvent) => {
      const xPct = Math.min(100, Math.max(0, ((moveEvent.clientX - rect.left) / rect.width) * 100))
      const yPct = Math.min(100, Math.max(0, ((moveEvent.clientY - rect.top) / rect.height) * 100))
      setLocalPos({ x: xPct, y: yPct })
    }
    const onUp = (upEvent: MouseEvent) => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      isDraggingRef.current = false
      const xPct = Math.min(100, Math.max(0, ((upEvent.clientX - rect.left) / rect.width) * 100))
      const yPct = Math.min(100, Math.max(0, ((upEvent.clientY - rect.top) / rect.height) * 100))
      onCommitPosition(xPct, yPct)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!strip.visible) return null

  const playheadIndex = playheadDate && cells.length > 0
    ? cells.findIndex(c => c.year === playheadDate.getFullYear() && c.month === playheadDate.getMonth())
    : -1
  const cellWidthPct = cells.length > 0 ? 100 / cells.length : 0

  return (
    <div
      className="absolute z-10 cursor-grab active:cursor-grabbing select-none"
      style={{ left: `${localPos.x}%`, top: `${localPos.y}%` }}
      onMouseDown={startDrag}
    >
      <div
        style={{
          position: 'relative', width: strip.width_px, height: strip.height_px, overflow: 'hidden',
          backgroundColor: strip.background_color, border: `1px solid ${strip.band_border_color}`, borderRadius: 4,
        }}
      >
        {cells.length === 0 ? (
          <div
            className="w-full h-full flex items-center justify-center"
            style={{ color: strip.text_color, fontSize: strip.font_size }}
          >
            No scheduled activities in scope
          </div>
        ) : (
          <>
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: strip.height_px / 2, display: 'flex' }}>
              {yearGroups.map(g => (
                <div
                  key={`${g.year}-${g.startIndex}`}
                  style={{
                    width: `${(g.count / cells.length) * 100}%`, textAlign: 'center',
                    color: strip.text_color, fontSize: strip.font_size, fontWeight: 700,
                    borderBottom: `1px solid ${strip.band_border_color}`, boxSizing: 'border-box',
                    overflow: 'hidden', whiteSpace: 'nowrap',
                  }}
                >
                  {g.year}
                </div>
              ))}
            </div>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: strip.height_px / 2, display: 'flex' }}>
              {cells.map((c, i) => (
                <div
                  key={i}
                  style={{
                    width: `${cellWidthPct}%`, textAlign: 'center',
                    color: strip.text_color, fontSize: strip.font_size,
                    borderLeft: i > 0 ? `1px solid ${strip.band_border_color}33` : undefined,
                    boxSizing: 'border-box',
                  }}
                >
                  {MONTH_LETTERS[c.month]}
                </div>
              ))}
            </div>
            {playheadIndex >= 0 && (
              <div
                className="pointer-events-none"
                style={{
                  position: 'absolute', top: 0, bottom: 0, left: `${playheadIndex * cellWidthPct}%`, width: `${cellWidthPct}%`,
                  backgroundColor: strip.playhead_color, opacity: 0.55,
                  border: `2px solid ${strip.playhead_color}`, boxSizing: 'border-box',
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
