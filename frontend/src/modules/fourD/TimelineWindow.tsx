import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation } from './annotations'
import { AnimationActorsList } from './AnimationActorsList'
import type { AnimationProfile } from './animationProfiles'
import type { Camera } from './cameras'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { dateFromTimelineValue, formatTimelineValue, FPS_OPTIONS, type TimeDisplayMode } from './timelinePlayback'
import type { Zone } from './zones'

interface Props {
  scheduleStart: Date | null
  scheduleEnd: Date | null
  // Shared with Viewport3D's TimelinePlayback (2026-07-11) — this component
  // owns the play/pause/speed UI and the requestAnimationFrame loop that
  // advances it, Viewport3D reads the same ref independently every render
  // frame. See Viewport3D.tsx's own Props comment for why this is a ref and
  // not lifted React state.
  dateRef: React.MutableRefObject<Date | null>
  // Fired alongside every dateRef mutation below (2026-08-29) — lets
  // FourD.tsx notify the docked Gantt/Activity Table windows of the new
  // playhead without itself re-rendering on every play tick/scrub drag; see
  // FourD.tsx's own subscribeTimelineFocus header for the full mechanism.
  onDateChange?: (d: Date) => void
  // Only used to draw the task-bar strip (2026-07-11, per Maro) — which
  // linked activities' start/finish fall where along the scrubber, so
  // scrubbing isn't blind to what's about to trigger. Also project-wide
  // input to AnimationActorsList's own Preset sub-tracks below.
  activities: Activity[]
  links: ModelElementLink[]
  // Diamond markers (2026-07-08, per Maro's confirmed scoping answer:
  // "Track markers on the Timeline window's scrubber") — every date the
  // currently-selected object is keyed on, across all its fields, grouped by
  // day (several fields sharing one date is the common case). Empty when
  // nothing's selected or the selection isn't keyframeable (IFC). Movable/
  // deletable as a group (2026-07-12, per Maro) — see onMoveKeyframes/
  // onDeleteKeyframes below and FourD.tsx's own header on why a whole day's
  // keyframes move or delete together rather than one field at a time.
  keyframesByDay: { date: Date; keyframes: ElementKeyframe[] }[]
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
  // Box-select/copy/paste/reverse (2026-07-23, per Maro: "allow me to drag
  // and select all keyframe and delete or copy and paste"/"reverse too")
  // — see AnimationActorsList.tsx's own header for the full interaction;
  // onDeleteKeyframes above is reused as-is for a multi-select delete (it
  // already just loops whatever list it's given), these two are new.
  onCreateKeyframes: (rows: { sourceKind: ElementKeyframe['source_kind']; elementRef: string; field: KeyframeField; date: Date; value: number }[]) => void
  onReverseKeyframes: (keyframes: ElementKeyframe[]) => void
  // Project-wide "dope sheet" (2026-07-12, per Maro: "underneath, the
  // animation timeline... actors with a sub line with keyframes on
  // those") — see AnimationActorsList.tsx's own header for the full
  // rationale. Not scoped to keyframesByDay's current-selection-only view
  // above; both coexist (the diamond markers on the main scrubber stay as
  // a quick glance at *the current selection*, this is everything).
  elementKeyframes: ElementKeyframe[]
  pathFollowers: PathFollower[]
  annotations: Annotation[]
  animationProfiles: AnimationProfile[]
  paths: Path[]
  zones: Zone[]
  cameras: Camera[]
  onSelectActor: (sourceKind: 'mesh' | 'ifc' | 'annotation' | 'path' | 'zone' | 'camera', elementRef: string) => void
  // Keyframe-click-to-seek (2026-08-03, per Maro: "clicking it doesnt take
  // me to the time/frame") — CamerasPanel.tsx is a sibling panel with no
  // access to this component's own setCurrent, so FourD.tsx hands it this
  // instead: a fresh {date, token} object each time it wants the scrubber
  // moved. token (not just date) is what the effect below actually keys
  // off, so seeking to the *same* date twice in a row (e.g. two clicks on
  // the same keyframe) still fires — a raw Date dependency wouldn't retrigger
  // for an equal-but-not-identical value in some cases, and comparing by
  // getTime() adds a footgun-prone extra step for no benefit over a counter.
  seekRequest: { date: Date; token: number } | null
  // Lifted to FourD.tsx (2026-07-30) — see that file's own header on these
  // three for the full "why" (PathsPanel.tsx/ZonesPanel.tsx need the same
  // shared speed/mode/fps for their own Start/End keyframe fields to read
  // meaningfully alongside this scrubber). Was local useState here before;
  // every internal use below is unchanged, just sourced from props now.
  speedDaysPerSecond: number
  onSpeedChange: (value: number) => void
  timeDisplayMode: TimeDisplayMode
  onTimeDisplayModeChange: (mode: TimeDisplayMode) => void
  fps: number
  onFpsChange: (value: number) => void
  // Mesh imports whose own raw embedded animation loop couldn't be baked
  // to keyframes (2026-08-22, per Maro's real Blender particle-VFX
  // export, "Water Spray.glb", then his own follow-up: "I need to be
  // able to keyframe the pause/play of the loop... yes like that" — "that"
  // being Path/Zone/Annotation's own existing anim_start/anim_end Reveal
  // window). Threaded straight through to AnimationActorsList — see that
  // component's own rawAnimationMeshNames header for the rest of this
  // feature; Viewport3D.tsx's EmbeddedAnimationLoop reads the same
  // resolved anim_start/anim_end window (FourD.tsx's own meshAnimWindows)
  // to gate whether the clip advances or holds its pose.
  rawAnimationMeshNames: Set<string>
  onKeyAnimStart: (elementRef: string) => void
  onKeyAnimEnd: (elementRef: string) => void
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
export function TimelineWindow({
  scheduleStart, scheduleEnd, dateRef, onDateChange, activities, links, keyframesByDay, onMoveKeyframes, onDeleteKeyframes,
  onCreateKeyframes, onReverseKeyframes,
  elementKeyframes, pathFollowers, annotations, animationProfiles, paths, zones, cameras, onSelectActor, seekRequest,
  speedDaysPerSecond, onSpeedChange, timeDisplayMode, onTimeDisplayModeChange, fps, onFpsChange,
  rawAnimationMeshNames, onKeyAnimStart, onKeyAnimEnd,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [loop, setLoop] = useState(false)
  const [displayDate, setDisplayDate] = useState<Date | null>(dateRef.current)
  // changeTimeDisplayMode/changeFps (2026-07-12, per Maro: "I want to
  // choose to see as date or time... so i can be precise and also adjust
  // frame rate") — thin local wrappers around the lifted onTimeDisplayModeChange/
  // onFpsChange props (2026-07-30 — see FourD.tsx's own header on why
  // these moved out of local useState here), kept as wrappers rather than
  // calling the props directly at each call site below purely for the one
  // bit of local-only behaviour a mode switch still needs: clearing the
  // End field's own in-progress typing buffer (endInputText, below), whose
  // raw text is unit-specific (seconds vs. frames) and would otherwise
  // show stale digits in the new unit until the user happened to blur it.
  const changeTimeDisplayMode = (mode: TimeDisplayMode) => {
    onTimeDisplayModeChange(mode)
    setEndInputText(null)
  }
  const changeFps = (value: number) => onFpsChange(value)
  const rafRef = useRef<number | null>(null)
  const lastTimeRef = useRef<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  // Drag-to-reschedule a keyframe marker (2026-07-12, per Maro: "the
  // keyframes on the timeline need to be movable, editable, deletable") —
  // dayKey identifies which marker's being dragged so its dot can preview at
  // previewDate while the pointer moves, committed via onMoveKeyframes only
  // on release. moved distinguishes a real drag from a plain click (which
  // still just jumps the scrubber there, the marker's original behaviour) —
  // without it, even a single-pixel jitter on mousedown would wrongly skip
  // the click-to-jump path.
  const [dragState, setDragState] = useState<{ dayKey: string; previewDate: Date; moved: boolean } | null>(null)

  // Raw text the user is actively typing into the End field (2026-07-24
  // fix, per Maro: "unable to freely change the end frames or values") —
  // that field used to be fully controlled straight off effectiveEnd, so
  // handleEndOverride's own "extends only" floor check ran on *every
  // keystroke*: typing "30" digit-by-digit, the moment "3" alone parsed to
  // a value at-or-below the real computed end, the override reset to null
  // and the field snapped back to showing the real end before the user
  // could ever type the "0" — same problem editing an existing override
  // down to a smaller-but-still-valid number. null here means "not
  // currently being typed into" (show the real derived value); a string
  // means "show exactly what the user just typed, unvalidated" — the
  // floor check only actually runs once, on blur/Enter, via
  // commitEndInput below.
  const [endInputText, setEndInputText] = useState<string | null>(null)

  // Manual upper-limit override (2026-07-23, per Maro: "unable to set the
  // upper limit of animation") — scheduleEnd is otherwise entirely computed
  // (latest activity finish / keyframe date, see timelinePlayback.ts), so
  // there was no way to scrub or play past the last real keyframe, e.g. to
  // let a moving object sit at rest for a while after its last move. Extends
  // only, never shrinks below the real computed scheduleEnd (Maro's explicit
  // choice) — re-derived from the live `scheduleEnd` prop every render
  // rather than reset by an effect, so it also transparently stops applying
  // the moment real activity/keyframe data grows past it on its own.
  //
  // Memoized (2026-07-26 fix, per Maro: "not playing when i click play
  // unless i scrub" — a regression of the *exact* bug class FourD.tsx's own
  // timelineRange comment already documents fixing back on 2026-07-11: this
  // used to build a plain `new Date(endOverrideMs)` inline in the render
  // body whenever an override was active, a fresh Date identity on every
  // render. The play effect below depends on effectiveScheduleEnd by
  // identity to keep accumulating real elapsed time across frames — and
  // every rAF tick calls setDisplayDate, which re-renders this component,
  // which built a brand-new effectiveScheduleEnd object, which the effect
  // saw as "changed" and tore itself down for, resetting lastTimeRef to null
  // before any meaningful delta could ever accumulate. Play looked like it
  // did nothing; a manual scrub (self-contained local state, untouched by
  // this) worked fine — reproducing the 2026-07-11 symptom exactly. Keyed on
  // the override's own primitive ms value and scheduleEnd's own timestamp,
  // not the Date objects themselves, so this only ever produces a new
  // identity when the real value actually changes.
  const [endOverrideMs, setEndOverrideMs] = useState<number | null>(null)
  const effectiveScheduleEnd = useMemo(
    () => (scheduleEnd && endOverrideMs !== null && endOverrideMs > scheduleEnd.getTime() ? new Date(endOverrideMs) : scheduleEnd),
    [scheduleEnd, endOverrideMs],
  )

  // Seeds the shared date once a schedule range becomes available, if
  // nothing's set it yet (e.g. the very first time this window opens).
  useEffect(() => {
    if (scheduleStart && dateRef.current === null) {
      dateRef.current = scheduleStart
      setDisplayDate(scheduleStart)
      onDateChange?.(scheduleStart)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scheduleStart])

  useEffect(() => {
    if (!isPlaying || !scheduleStart || !effectiveScheduleEnd) return
    lastTimeRef.current = null
    const tick = (t: number) => {
      const dtSeconds = lastTimeRef.current === null ? 0 : (t - lastTimeRef.current) / 1000
      lastTimeRef.current = t
      const current = dateRef.current ?? scheduleStart
      let next = new Date(current.getTime() + dtSeconds * speedDaysPerSecond * DAY_MS)
      let stop = false
      if (next.getTime() >= effectiveScheduleEnd.getTime()) {
        if (loop) { next = scheduleStart; lastTimeRef.current = t }
        else { next = effectiveScheduleEnd; stop = true }
      }
      dateRef.current = next
      setDisplayDate(next)
      onDateChange?.(next)
      if (stop) { setIsPlaying(false); return }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, scheduleStart, effectiveScheduleEnd, speedDaysPerSecond, loop, dateRef])

  // Task-bar strip data — only activities actually linked to something in
  // the viewport, deduped, so this stays focused on what the timeline can
  // actually show rather than the whole (possibly 100+ row) schedule.
  const linkedActivities = useMemo(() => {
    const linkedIds = new Set(links.map(l => l.activity_id))
    return activities.filter(a => linkedIds.has(a.id) && a.start && a.finish)
  }, [activities, links])

  // Stable across the per-frame `displayDate` updates that drive Play
  // (2026-07-21 perf fix, per Maro: "the animation timeline is still
  // dragging" — see AnimationActorsList.tsx's own header for the full
  // mechanism). Defined here, before the early return below, specifically
  // so it's a hook call made unconditionally on every render (Rules of
  // Hooks) — the null check inside covers the same "not ready yet" case
  // the early return handles, just without skipping the hook itself.
  // Every other setCurrent call site in this component (handleScrub, step,
  // jumpToToday, ...) is a direct user click/drag, not a per-frame update,
  // so reusing this same stable function costs them nothing.
  const setCurrent = useCallback((next: Date) => {
    if (!scheduleStart || !effectiveScheduleEnd) return
    const clamped = clampToRange(next, scheduleStart, effectiveScheduleEnd)
    dateRef.current = clamped
    setDisplayDate(clamped)
    onDateChange?.(clamped)
  }, [scheduleStart, effectiveScheduleEnd, dateRef, onDateChange])

  // Keyframe-click-to-seek (2026-08-03) — see this component's own
  // seekRequest prop comment for why a {date, token} pair rather than a
  // bare Date. Keyed on seekRequest?.token alone (not the whole object) so
  // this only fires on an actual new request, not every render.
  useEffect(() => {
    if (!seekRequest) return
    setIsPlaying(false)
    setCurrent(seekRequest.date)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest?.token])

  // Passed to AnimationActorsList as onJumpTo — has to be its own stable
  // reference too (not just an inline `date => {...}` at the JSX call
  // site below, which would be a fresh function every render regardless of
  // setCurrent's own stability) for that component's React.memo to
  // actually hold across Play's per-frame re-renders.
  const onActorJumpTo = useCallback((date: Date) => {
    setIsPlaying(false)
    setCurrent(date)
  }, [setCurrent])

  if (!scheduleStart || !scheduleEnd) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <p className="text-sm text-gray-400 dark:text-prosota-muted text-center max-w-xs">
          No dated activities yet — the timeline needs at least one activity with a start and finish to scrub through.
        </p>
      </div>
    )
  }

  // Non-null past the guard above (effectiveScheduleEnd is only ever null
  // when the real scheduleEnd prop is), used everywhere below in place of
  // the raw prop so the manual override actually extends what's scrubbable.
  const effectiveEnd = effectiveScheduleEnd ?? scheduleEnd
  const totalMs = effectiveEnd.getTime() - scheduleStart.getTime()
  const current = displayDate ?? scheduleStart
  const sliderValue = totalMs > 0 ? Math.round(((current.getTime() - scheduleStart.getTime()) / totalMs) * SLIDER_MAX) : 0
  // Elapsed seconds at the current Play speed, from scheduleStart to
  // `current` — the numeric basis for both the Seconds/Frames display mode
  // toolbar input below and formatTimelineValue's own identical maths, kept
  // as one plain number here rather than parsed back out of the formatted
  // display string (fragile the moment that format ever changes).
  const elapsedSeconds = speedDaysPerSecond > 0 ? (current.getTime() - scheduleStart.getTime()) / DAY_MS / speedDaysPerSecond : 0
  // Same maths for the End field's own displayed value (2026-07-23) — the
  // manual-override input shows/edits effectiveEnd's elapsed value, exactly
  // like the existing current-position input does for `current`.
  const endElapsedSeconds = speedDaysPerSecond > 0 ? (effectiveEnd.getTime() - scheduleStart.getTime()) / DAY_MS / speedDaysPerSecond : 0
  // Extends the manual override, never shrinks it below the real computed
  // scheduleEnd (Maro's explicit choice) — see endOverrideMs's own header
  // above for why that floor check is against the live prop, not the
  // previous override. Only ever called on commit (blur/Enter — see
  // endInputText's own header for why not on every keystroke).
  const commitEndOverride = (next: Date) => {
    setEndOverrideMs(next.getTime() > scheduleEnd.getTime() ? next.getTime() : null)
    setEndInputText(null)
  }
  const handleEndDateInput = (value: string) => {
    if (!value) { setEndInputText(null); return }
    const [y, m, d] = value.split('-').map(Number)
    commitEndOverride(new Date(y, m - 1, d))
  }
  // Parses whatever's currently in the End field's own typing buffer and
  // commits it — shared by onBlur and Enter (2026-07-24). Leaves the
  // override untouched (just clears the buffer, reverting the display back
  // to the real value) on an empty/unparseable value rather than treating
  // that as "set the end to right now," same forgiving-on-blur behaviour
  // every other numeric field in this app already has.
  const commitEndInputText = () => {
    if (endInputText === null) return
    if (endInputText.trim() === '') { setEndInputText(null); return }
    const parsed = Number(endInputText)
    if (Number.isNaN(parsed)) { setEndInputText(null); return }
    commitEndOverride(dateFromTimelineValue(parsed, scheduleStart, timeDisplayMode === 'date' ? 'seconds' : timeDisplayMode, speedDaysPerSecond, fps))
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

  // Same clientX -> date math as handleScrub's own slider, just driven by
  // the marker track's own bounding rect instead of the <input type=range>'s
  // built-in percentage, since a diamond isn't a native range control.
  const dateFromClientX = (clientX: number): Date => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return current
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return clampToRange(new Date(scheduleStart.getTime() + pct * totalMs), scheduleStart, effectiveEnd)
  }

  // Lets the linked-activity task-bar strip above the real <input
  // type=range> also scrub (2026-07-25, per Maro: "when i try to scrub the
  // animation, i'm restricted and see a stop icon" — that strip visually
  // sits flush against the slider and reads as part of one combined scrub
  // control, but it's a plain non-interactive div with only a `title`
  // tooltip; a click/drag landing on it (very easy given the slider itself
  // is only ~16px tall) did nothing at all. Worse, it — and the elapsed-
  // time readout row just below the slider — had default `user-select:
  // auto`, so a drag starting there could be interpreted as a native
  // text-selection drag instead, which is exactly what shows Chrome's
  // "not-allowed"/stop cursor for the rest of the drag and never scrubs).
  // Reuses dateFromClientX, same as the keyframe-marker drag just below.
  const handleTrackPointerDown = (e: React.PointerEvent) => {
    setIsPlaying(false)
    setCurrent(dateFromClientX(e.clientX))
    const handleMove = (ev: PointerEvent) => setCurrent(dateFromClientX(ev.clientX))
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const handleMarkerPointerDown = (group: { date: Date; keyframes: ElementKeyframe[] }) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const dayKey = String(group.date.getTime())
    const startX = e.clientX
    setIsPlaying(false)
    setDragState({ dayKey, previewDate: group.date, moved: false })

    const handleMove = (ev: PointerEvent) => {
      setDragState({ dayKey, previewDate: dateFromClientX(ev.clientX), moved: Math.abs(ev.clientX - startX) > 3 })
    }
    const handleUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      const moved = Math.abs(ev.clientX - startX) > 3
      if (moved) {
        onMoveKeyframes(group.keyframes, dateFromClientX(ev.clientX))
      } else {
        setCurrent(group.date)
      }
      setDragState(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const handleMarkerContextMenu = (group: { date: Date; keyframes: ElementKeyframe[] }) => (e: React.MouseEvent) => {
    e.preventDefault()
    onDeleteKeyframes(group.keyframes)
  }

  return (
    <div className="h-full flex flex-col p-3 gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => step(-STEP_DAYS)} title="Step back 1 day" className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">◀</button>
        <button
          onClick={() => {
            // Auto-rewind on Play if already sitting at (or past) the end
            // (2026-07-24 fix, per Maro: "why isnt it playing now") — the
            // play loop below stops itself the instant `next >= effectiveEnd`,
            // which is true on frame 1 if playback starts already there, so
            // hitting Play looked like it silently did nothing. Only when
            // not already playing — toggling Pause off mid-scrub shouldn't
            // ever jump the playhead.
            if (!isPlaying && current.getTime() >= effectiveEnd.getTime()) setCurrent(scheduleStart)
            setIsPlaying(p => !p)
          }}
          className="text-xs px-3 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-700 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2 font-medium"
        >
          {isPlaying ? '⏸ Pause' : '▶ Play'}
        </button>
        <button onClick={() => step(STEP_DAYS)} title="Step forward 1 day" className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">▶</button>
        <button onClick={jumpToToday} title="Jump to today" className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-prosota-line bg-white dark:bg-prosota-panel text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">Today</button>
        <label className="flex items-center gap-1 text-xs text-gray-600 dark:text-prosota-muted px-1">
          <input type="checkbox" checked={loop} onChange={e => setLoop(e.target.checked)} />
          Loop
        </label>
        <select
          value={speedDaysPerSecond}
          onChange={e => onSpeedChange(Number(e.target.value))}
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
        >
          {SPEED_OPTIONS.map(o => <option key={o.daysPerSecond} value={o.daysPerSecond}>{o.label}</option>)}
        </select>
        <select
          value={timeDisplayMode}
          onChange={e => changeTimeDisplayMode(e.target.value as TimeDisplayMode)}
          title="How dates are shown/entered on this timeline"
          className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
        >
          <option value="date">Date</option>
          <option value="seconds">Seconds</option>
          <option value="frames">Frames</option>
        </select>
        {timeDisplayMode === 'frames' && (
          <select
            value={fps}
            onChange={e => changeFps(Number(e.target.value))}
            title="Frames per second"
            className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
          >
            {FPS_OPTIONS.map(f => <option key={f} value={f}>{f} fps</option>)}
          </select>
        )}
        <div className="flex items-center gap-1 ml-auto">
          <label
            className="text-[10px] text-gray-500 dark:text-prosota-muted"
            title="Manually extend the timeline's upper limit past the last activity/keyframe (e.g. to hold on the last pose for a while) — can't go below that real end"
          >
            End
          </label>
          {timeDisplayMode === 'date' ? (
            <input
              type="date"
              value={toDateInputValue(effectiveEnd)}
              onChange={e => handleEndDateInput(e.target.value)}
              className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
            />
          ) : (
            <input
              type="number"
              step={timeDisplayMode === 'seconds' ? 0.1 : 1}
              value={endInputText ?? (timeDisplayMode === 'seconds' ? Number(endElapsedSeconds.toFixed(1)) : Math.round(endElapsedSeconds * fps))}
              onChange={e => setEndInputText(e.target.value)}
              onBlur={commitEndInputText}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
              title="Manually extend the timeline's upper limit — can't go below the real computed end"
              className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 w-20"
            />
          )}
          {timeDisplayMode === 'date' ? (
            <input
              type="date"
              value={toDateInputValue(current)}
              onChange={e => handleDateInput(e.target.value)}
              className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1"
            />
          ) : (
            <input
              type="number"
              step={timeDisplayMode === 'seconds' ? 0.1 : 1}
              value={timeDisplayMode === 'seconds' ? Number(elapsedSeconds.toFixed(1)) : Math.round(elapsedSeconds * fps)}
              onChange={e => {
                if (e.target.value === '') return
                setIsPlaying(false)
                setCurrent(dateFromTimelineValue(Number(e.target.value), scheduleStart, timeDisplayMode, speedDaysPerSecond, fps))
              }}
              title={timeDisplayMode === 'seconds' ? 'Elapsed seconds from schedule start, at the current speed' : 'Frame number, at the current speed and fps'}
              className="text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-1 w-24"
            />
          )}
        </div>
      </div>

      <div className="relative select-none" ref={trackRef}>
        {linkedActivities.length > 0 && (
          <div className="relative h-3 mb-0.5 cursor-pointer touch-none" onPointerDown={handleTrackPointerDown}>
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
        {keyframesByDay.length > 0 && (
          <div className="relative h-2 mt-0.5 pointer-events-none">
            {keyframesByDay.map(group => {
              const dayKey = String(group.date.getTime())
              const dragging = dragState?.dayKey === dayKey
              const shownDate = dragging ? dragState.previewDate : group.date
              // Clamped, not filtered out (2026-07-12 fix, per Maro: "you
              // dont show keyframes at 0 secs") — see AnimationActorsList.tsx's
              // own identical fix for the full explanation: a day-group's
              // date is midnight UTC, but scheduleStart keeps the earliest
              // keyframe's real (non-midnight) timestamp, so day-zero
              // keyframes computed as genuinely before scheduleStart and a
              // raw `left < 0` filter dropped them instead of pinning them
              // to the start.
              const rawLeft = totalMs > 0 ? ((shownDate.getTime() - scheduleStart.getTime()) / totalMs) * 100 : 0
              const left = Math.max(0, Math.min(100, rawLeft))
              return (
                <div
                  key={dayKey}
                  title={`Keyframed — ${formatTimelineValue(shownDate, scheduleStart, timeDisplayMode, speedDaysPerSecond, fps)} (drag to move, right-click to delete)`}
                  onPointerDown={handleMarkerPointerDown(group)}
                  onContextMenu={handleMarkerContextMenu(group)}
                  className={`absolute top-0 w-2 h-2 bg-amber-500 border border-amber-600 rotate-45 -translate-x-1/2 pointer-events-auto cursor-grab active:cursor-grabbing ${dragging ? 'ring-2 ring-amber-300' : ''}`}
                  style={{ left: `${left}%` }}
                />
              )
            })}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] text-gray-400 dark:text-prosota-muted select-none">
        <span>{formatTimelineValue(scheduleStart, scheduleStart, timeDisplayMode, speedDaysPerSecond, fps)}</span>
        <span className="text-xs text-gray-700 dark:text-prosota-muted font-medium">{formatTimelineValue(current, scheduleStart, timeDisplayMode, speedDaysPerSecond, fps)}</span>
        <span>{formatTimelineValue(effectiveEnd, scheduleStart, timeDisplayMode, speedDaysPerSecond, fps)}</span>
      </div>
      <AnimationActorsList
        scheduleStart={scheduleStart}
        scheduleEnd={effectiveEnd}
        currentDate={current}
        activities={activities}
        modelElementLinks={links}
        elementKeyframes={elementKeyframes}
        pathFollowers={pathFollowers}
        annotations={annotations}
        animationProfiles={animationProfiles}
        paths={paths}
        zones={zones}
        cameras={cameras}
        rawAnimationMeshNames={rawAnimationMeshNames}
        timeDisplayMode={timeDisplayMode}
        speedDaysPerSecond={speedDaysPerSecond}
        fps={fps}
        onJumpTo={onActorJumpTo}
        onMoveKeyframes={onMoveKeyframes}
        onDeleteKeyframes={onDeleteKeyframes}
        onCreateKeyframes={onCreateKeyframes}
        onReverseKeyframes={onReverseKeyframes}
        onSelectActor={onSelectActor}
        onKeyAnimStart={onKeyAnimStart}
        onKeyAnimEnd={onKeyAnimEnd}
      />
    </div>
  )
}
