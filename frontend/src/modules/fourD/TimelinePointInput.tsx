import { useEffect, useState } from 'react'
import { dateFromTimelineValue, type TimeDisplayMode } from './timelinePlayback'

export interface TimelineFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

const DAY_MS = 24 * 60 * 60 * 1000

// A point on the 4D timeline, typed in whatever unit the Animation Timeline
// is currently showing (2026-10-02, per Maro: "capture at a particular
// sec/date/frame ... capture video at a particular start ... to particular
// finish"): a date picker in Date mode, a number in Seconds/Frames mode
// (converted with the timeline's own speed/fps, the same
// dateFromTimelineValue its own scrubber entry uses). Always stores a real
// schedule Date, so a picked moment stays put even if the timeline's speed
// or unit changes later. Empty = null = the caller's default (current
// position / schedule start / schedule finish).
//
// `dayEdge` decides which instant a Date-mode pick means: 'end' (default)
// is the state at the end of that day — work finishing that day counts as
// done, the usual "progress as of" reading — and 'start' is the beginning
// of the day, for a video's From.
export function TimelinePointInput({ value, onChange, format, placeholder, dayEdge = 'end' }: {
  value: Date | null
  onChange: (value: Date | null) => void
  format: TimelineFormat
  placeholder: string
  dayEdge?: 'start' | 'end'
}) {
  const mode = format.timeDisplayMode
  const toNumber = (d: Date) => {
    const seconds = format.speedDaysPerSecond > 0 ? (d.getTime() - format.scheduleStart.getTime()) / DAY_MS / format.speedDaysPerSecond : 0
    return mode === 'frames' ? String(Math.round(seconds * format.fps)) : seconds.toFixed(1)
  }
  const [draft, setDraft] = useState(value && mode !== 'date' ? toNumber(value) : '')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setDraft(value && mode !== 'date' ? toNumber(value) : '') }, [value, mode, format.speedDaysPerSecond, format.fps, format.scheduleStart])

  const className = 'w-28 text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5'

  if (mode === 'date') {
    const pad = (n: number) => String(n).padStart(2, '0')
    const asInput = value ? `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}` : ''
    return (
      <input
        type="date"
        value={asInput}
        onChange={e => {
          if (!e.target.value) { onChange(null); return }
          const [y, m, d] = e.target.value.split('-').map(Number)
          onChange(dayEdge === 'start' ? new Date(y, m - 1, d, 0, 0, 0) : new Date(y, m - 1, d, 23, 59, 59))
        }}
        className={className}
      />
    )
  }

  const commit = () => {
    if (draft.trim() === '') { onChange(null); return }
    const n = Number(draft)
    if (!Number.isFinite(n)) { setDraft(value ? toNumber(value) : ''); return }
    onChange(dateFromTimelineValue(n, format.scheduleStart, mode, format.speedDaysPerSecond, format.fps))
  }
  return (
    <div className="flex items-center gap-1">
      <input
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit() } }}
        placeholder={placeholder}
        inputMode="decimal"
        className={`${className} !w-20 text-right`}
      />
      <span className="text-[10px] text-gray-400 dark:text-prosota-muted w-8">{mode === 'frames' ? 'frame' : 'sec'}</span>
    </div>
  )
}
