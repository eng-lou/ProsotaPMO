import { useEffect, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { RadialChart } from './radialCharts'
import { fetchRadialChartIconBlob } from './radialCharts'
import { computeRadialChartProgress } from './radialChartProgress'

interface Props {
  chart: RadialChart
  activities: Activity[]
  matchingIds: Set<string>
  // Same "read a ref every animation frame, never a React prop" reasoning
  // FourD.tsx's own timelineDateRef header already documents — a plain
  // `Date` prop here would force this ring (and every other one) to
  // re-render on literally every scrub frame.
  timelineDateRef: React.MutableRefObject<Date | null>
  containerRef: React.RefObject<HTMLDivElement>
  onCommitPosition: (id: string, positionXPct: number, positionYPct: number) => void
}

// Live, draggable progress-ring HUD overlay (2026-07-31) — see
// radial_chart.py's own docstring for the full "why". Rendered as a sibling
// of Viewport3D's <Canvas>, inside its same relatively-positioned
// containerRef wrapper, so `left/top` percentages land in the same visual
// spot the reference screenshot's own fixed corner badges already use.
export function RadialChartHud({ chart, activities, matchingIds, timelineDateRef, containerRef, onCommitPosition }: Props) {
  const [progress, setProgress] = useState(0)
  const [localPos, setLocalPos] = useState({ x: chart.position_x_pct, y: chart.position_y_pct })
  const isDraggingRef = useRef(false)
  const [iconUrl, setIconUrl] = useState<string | null>(null)

  // Own rAF tick loop (same shape as TimelineWindow.tsx's own displayDate
  // loop) — reads timelineDateRef.current every frame and recomputes just
  // this ring's own progress, so a scrub doesn't force FourD.tsx's whole
  // tree to re-render.
  useEffect(() => {
    let raf: number
    const tick = () => {
      const date = timelineDateRef.current
      if (date) setProgress(computeRadialChartProgress(activities, matchingIds, date))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [activities, matchingIds, timelineDateRef])

  useEffect(() => {
    if (!isDraggingRef.current) setLocalPos({ x: chart.position_x_pct, y: chart.position_y_pct })
  }, [chart.position_x_pct, chart.position_y_pct])

  useEffect(() => {
    if (chart.center_mode !== 'icon' || !chart.icon_storage_filename) {
      setIconUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    fetchRadialChartIconBlob(chart.id).then(blob => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob)
      setIconUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [chart.id, chart.center_mode, chart.icon_storage_filename])

  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
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
      onCommitPosition(chart.id, xPct, yPct)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  if (!chart.visible) return null

  const size = chart.radius_px * 2
  const r = chart.radius_px - chart.thickness_px / 2
  const circumference = 2 * Math.PI * r
  const dashOffset = circumference * (1 - progress)
  const innerInset = chart.thickness_px + 3

  return (
    <div
      className="absolute z-10 flex flex-col items-center cursor-grab active:cursor-grabbing select-none"
      style={{ left: `${localPos.x}%`, top: `${localPos.y}%` }}
      onMouseDown={startDrag}
    >
      <div
        className="px-2 py-0.5 mb-1 text-xs font-semibold rounded-sm whitespace-nowrap shadow"
        style={{ backgroundColor: '#000000', color: chart.text_color }}
      >
        {chart.title}
      </div>
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={chart.track_color} strokeWidth={chart.thickness_px} />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={chart.progress_color} strokeWidth={chart.thickness_px}
            strokeDasharray={circumference} strokeDashoffset={dashOffset} strokeLinecap="butt"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div
          className="absolute flex items-center justify-center rounded-full overflow-hidden"
          style={{
            inset: innerInset, backgroundColor: chart.fill_color,
            border: `2px solid ${chart.border_color}`,
          }}
        >
          {chart.center_mode === 'icon' && iconUrl ? (
            <img src={iconUrl} alt="" className="w-3/4 h-3/4 object-contain" />
          ) : (
            <span className="text-sm font-semibold" style={{ color: chart.text_color }}>
              {Math.round(progress * 100)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
