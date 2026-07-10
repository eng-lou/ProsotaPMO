import { useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { ModelElementLink } from './modelElementLinks'

interface Props {
  scheduleStart: Date | null
  scheduleEnd: Date | null
  // Shared with Viewport3D's TimelinePlayback (2026-07-11) — this component
  // owns the play/pause/speed UI and the requestAnimationFrame loop that
  // advances it, Viewport3D reads the same ref independently every render
  // frame. See Viewport3D.tsx's own Props comment for why this is a ref and
  // not lifted React state.
  dateRef: React.MutableRefObject<Date | null>
  // Only used to draw the task-bar strip (2026-07-11, per Maro) — which
  // linked activities' start/finish fall where along the scrubber, so
  // scrubbing isn't blind to what's about to trigger.
  activities: Activity[]
  links: ModelElementLink[]
  // Diamond markers (2026-07-08, per Maro's confirmed scoping answer:
  // "Track markers on the Timeline window's scrubber") — every date the
  // currently-selected object is keyed on, across all its fields. Empty
  // when nothing's selected or the selection isn't keyframeable (IFC).
  keyframeDates: Date[]
}

const SPEED_OPTIONS = [
  { label: '1 day/sec', daysPerSecond: 1 },
  { label: '1 week/sec', daysPerSecond: 7 },
  { label: '1 month/sec', daysPerSecond: 30 },
  { label: '1 quarter/sec', daysPerSecond: 90 },
]

const SLIDER_MAX = 1000
const STEP_DAYS = 1
const DAY_MS = 86_400_000

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function clampToRange(d: Date, start: Date, end: Date): Date {
  if (d.getTime() < start.getTime()) return start
  if (d.getTime() > end.getTime()) return end
  return d
}

// The 4D timeline (2026-07-11, per Maro — see animationProfiles.ts and
// timelinePlayback.ts's own headers for the Bonsai/Blender-add-on reference
// this was scoped against). A real-time scrubber, not Blender's baked-
// keyframe/frame-number model — there's no frame-rate/speed-mapping
// settings entity here, so "speed" is expressed directly as calendar days
// per real second, continuously advanced via requestAnimationFrame while
// playing rather than pre-baking discrete keyframes onto each object.
export function TimelineWindow({ scheduleStart, scheduleEnd, dateRef, activities, links, keyframeDates }: Props) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [speedDaysPerSecond, setSpeedDaysPerSecond] = useState(7)
  const [displayDate, setDisplayDate] = useState<Date | null>(dateRef.current)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)

  // Seeds the shared date once a schedule range becomes available, if
  // nothing's set it yet (e.g. the very first time this window opens).
  useEffect(() => {
    if (scheduleStart && dateRef.current === null) {
      dateRef.current = scheduleStart
      setDisplayDate(scheduleStart)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleStart])

  useEffect(() => {
    if (!isPlaying || !scheduleStart || !scheduleEnd) return
    lastTimeRef.current = null
    const tick = (t: number) => {
      const dtSeconds = lastTimeRef.current === null ? 0 : (t - lastTimeRef.current) / 1000
      lastTimeRef.current = t
      const current = dateRef.current ?? scheduleStart
      let next = new Date(current.getTime() + dtSeconds * speedDaysPerSecond * DAY_MS)
      let stop = false
      if (next.getTime() >= scheduleEnd.getTime()) {
        if (loop) { next = scheduleStart; lastTimeRef.current = t }
        else { next = scheduleEnd; stop = true }
      }
      dateRef.current = next
      setDisplayDate(next)
      if (stop) { setIsPlaying(false); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [isPlaying, scheduleStart, scheduleEnd, speedDaysPerSecond, loop, dateRef])

  // Task-bar strip data — only activities actually linked to something in
  // the viewport, deduped, so this stays focused on what the timeline can
  // actually show rather than the whole (possibly 100+ row) schedule.
  const linkedActivities = useMemo(() => {
    const linkedIds = new Set(links.map(l => l.activity_id))
    return activities.filter(a => linkedIds.has(a.id) && a.start && a.finish)
  }, [activities, links])

  if (!scheduleStart || !scheduleEnd) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-gray-400 text-center max-w-xs">
          No dated activities yet — the timeline needs at least one activity with a start and finish to scrub through.
        </p>
      </div>
    )
  }

  const totalMs = scheduleEnd.getTime() - scheduleStart.getTime()
  const current = displayDate ?? scheduleStart
  const sliderValue = totalMs > 0 ? Math.round(((current.getTime() - scheduleStart.getTime()) / totalMs) * SLIDER_MAX) : 0

  const setCurrent = (next: Date) => {
    const clamped = clampToRange(next, scheduleStart, scheduleEnd)
    dateRef.current = clamped
    setDisplayDate(clamped)
  }

  const handleScrub = (value: number) => {
    setIsPlaying(false)
    setCurrent(new Date(scheduleStart.getTime() + (value / SLIDER_MAX) * totalMs))
  }
  const step = (days: number) => { setIsPlaying(false); setCurrent(new Date(current.getTime() + days * DAY_MS)) }
  const jumpToToday = () => { setIsPlaying(false); setCurrent(new Date()) }
  const handleDateInput = (value: string) => {
    if (!value) return
    setIsPlaying(false)
    const [y, m, d] = value.split('-').map(Number)
    setCurrent(new Date(y, m - 1, d))
  }

  return (
    <div className="h-full flex flex-col p-3 gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => step(-STEP_DAYS)} title="Step back 1 day" className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">◀</button>
        <button
          onClick={() => setIsPlaying(p => !p)}
          className="text-xs px-3 py-1 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 font-medium"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => step(STEP_DAYS)} title="Step forward 1 day" className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">▶</button>
        <button onClick={jumpToToday} title="Jump to today" className="text-xs px-2 py-1 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">Today</button>
        <label className="flex items-center gap-1 text-xs text-gray-600 px-1">
          <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
          Loop
        </label>
        <select
          value={speedDaysPerSecond}
          onChange={e => setSpeedDaysPerSecond(Number(e.target.value))}
          className="text-xs border border-gray-300 rounded px-1.5 py-1"
        >
          {SPEED_OPTIONS.map(o => <option key={o.daysPerSecond} value={o.daysPerSecond}>{o.label}</option>)}
        </select>
        <input
          type="date"
          value={toDateInputValue(current)}
          onChange={e => handleDateInput(e.target.value)}
          className="text-xs border border-gray-300 rounded px-1.5 py-1 ml-auto"
        />
      </div>

      <div className="relative">
        {linkedActivities.length > 0 && (
          <div className="relative h-3 mb-0.5">
            {linkedActivities.map(a => {
              const s = new Date(a.start!).getTime()
              const f = new Date(a.finish!).getTime()
              const left = totalMs > 0 ? ((s - scheduleStart.getTime()) / totalMs) * 100 : 0
              const width = totalMs > 0 ? Math.max(0.5, ((f - s) / totalMs) * 100) : 0
              return (
                <div
                  key={a.id}
                  title={`${a.code}: ${a.task_name}`}
                  className="absolute top-0 h-2.5 rounded-sm bg-blue-400/70"
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              )
            })}
          </div>
        )}
        <input
          type="range" min={0} max={SLIDER_MAX} value={sliderValue}
          onChange={e => handleScrub(Number(e.target.value))}
          className="w-full"
        />
        {keyframeDates.length > 0 && (
          <div className="relative h-2 mt-0.5 pointer-events-none">
            {keyframeDates.map(d => {
              const left = totalMs > 0 ? ((d.getTime() - scheduleStart.getTime()) / totalMs) * 100 : 0
              if (left < 0 || left > 100) return null
              return (
                <div
                  key={d.getTime()}
                  title={`Keyframed — ${formatDate(d)}`}
                  onClick={() => { setIsPlaying(false); setCurrent(d) }}
                  className="absolute top-0 w-2 h-2 bg-amber-500 border border-amber-600 rotate-45 -translate-x-1/2 pointer-events-auto cursor-pointer"
                  style={{ left: `${left}%` }}
                />
              )
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-400">
        <span>{formatDate(scheduleStart)}</span>
        <span className="text-xs text-gray-700 font-medium">{formatDate(current)}</span>
        <span>{formatDate(scheduleEnd)}</span>
      </div>
    </div>
  )
}
