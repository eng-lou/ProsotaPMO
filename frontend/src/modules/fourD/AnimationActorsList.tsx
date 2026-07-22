import { memo, useMemo, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation } from './annotations'
import type { AnimationProfile } from './animationProfiles'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import type { ModelElementLink } from './modelElementLinks'
import type { PathFollower } from './pathFollowers'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'

type ActorSourceKind = 'mesh' | 'ifc' | 'annotation'

interface Actor {
  sourceKind: ActorSourceKind
  elementRef: string
  label: string
}

interface DayGroup {
  date: Date
  keyframes: ElementKeyframe[]
}

// Threaded down to every sub-track so tooltips read in whichever of
// Date/Seconds/Frames TimelineWindow.tsx's own toolbar toggle is set to
// (2026-07-12, per Maro: "I want to choose to see as date or time") —
// bundled into one object rather than three separate props repeated
// through every sub-component below.
interface DisplayFormat {
  scheduleStart: Date
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
}

function clampToRange(d: Date, start: Date, end: Date): Date {
  if (d.getTime() < start.getTime()) return start
  if (d.getTime() > end.getTime()) return end
  return d
}

function groupByDay(keyframes: ElementKeyframe[], fields: readonly KeyframeField[]): DayGroup[] {
  const byDay = new Map<string, ElementKeyframe[]>()
  for (const k of keyframes) {
    if (!fields.includes(k.field)) continue
    const day = k.date.slice(0, 10)
    const group = byDay.get(day) ?? []
    group.push(k)
    byDay.set(day, group)
  }
  return [...byDay.entries()].map(([day, group]) => ({ date: new Date(day), keyframes: group }))
}

const LOCATION_FIELDS = ['pos_x', 'pos_y', 'pos_z'] as const
const ROTATION_FIELDS = ['rot_x', 'rot_y', 'rot_z'] as const
const SCALE_FIELDS = ['scale_x', 'scale_y', 'scale_z'] as const
const PATH_FIELDS = ['path_progress'] as const

// One editable sub-track row (2026-07-12, per Maro: "underneath, the
// animation timeline... actors with a sub line with keyframes on those")
// — reuses TimelineWindow.tsx's own single-actor marker drag/delete
// interaction verbatim, just generalized to whichever day-grouped list a
// given actor+field-group resolves to, instead of always the current
// viewport selection. Each instance owns its own local drag state — rows
// are fully independent, no shared state needed across sub-tracks.
function KeyframeTrack({
  dayGroups, scheduleStart, totalMs, format, onJumpTo, onMoveKeyframes, onDeleteKeyframes,
}: {
  dayGroups: DayGroup[]
  scheduleStart: Date
  scheduleEnd: Date
  totalMs: number
  format: DisplayFormat
  onJumpTo: (date: Date) => void
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{ dayKey: string; previewDate: Date; moved: boolean } | null>(null)

  const dateFromClientX = (clientX: number): Date => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return scheduleStart
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return clampToRange(new Date(scheduleStart.getTime() + pct * totalMs), scheduleStart, new Date(scheduleStart.getTime() + totalMs))
  }

  const handlePointerDown = (group: DayGroup) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const dayKey = String(group.date.getTime())
    const startX = e.clientX
    setDragState({ dayKey, previewDate: group.date, moved: false })

    const handleMove = (ev: PointerEvent) => {
      setDragState({ dayKey, previewDate: dateFromClientX(ev.clientX), moved: Math.abs(ev.clientX - startX) > 3 })
    }
    const handleUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      const moved = Math.abs(ev.clientX - startX) > 3
      if (moved) onMoveKeyframes(group.keyframes, dateFromClientX(ev.clientX))
      else onJumpTo(group.date)
      setDragState(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  return (
    <div className="relative h-3" ref={trackRef}>
      {dayGroups.map(group => {
        const dayKey = String(group.date.getTime())
        const dragging = dragState?.dayKey === dayKey
        const shownDate = dragging ? dragState.previewDate : group.date
        // Clamped, not filtered out (2026-07-12 fix, per Maro: "you dont
        // show keyframes at 0 secs") — a day-group's own date is always
        // midnight UTC (new Date("2026-07-14")), but scheduleStart keeps
        // whichever keyframe was actually earliest *at its real, non-
        // midnight timestamp* (whenever it was actually keyed). A
        // keyframe on that very first day therefore computes as slightly
        // *before* scheduleStart — real hours-early, not a rounding
        // artifact — and a raw `left < 0` filter silently dropped it
        // instead of pinning it to the start where it visually belongs.
        const rawLeft = totalMs > 0 ? ((shownDate.getTime() - scheduleStart.getTime()) / totalMs) * 100 : 0
        const left = Math.max(0, Math.min(100, rawLeft))
        return (
          <div
            key={dayKey}
            title={`${formatTimelineValue(shownDate, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps)} — drag to move, right-click to delete`}
            onPointerDown={handlePointerDown(group)}
            onContextMenu={e => { e.preventDefault(); onDeleteKeyframes(group.keyframes) }}
            className={`absolute top-0.5 w-2 h-2 bg-amber-500 border border-amber-600 rotate-45 -translate-x-1/2 cursor-grab active:cursor-grabbing ${dragging ? 'ring-2 ring-amber-300' : ''}`}
            style={{ left: `${left}%` }}
          />
        )
      })}
    </div>
  )
}

// Preset (Activity+AnimationProfile) sub-track — deliberately read-only
// (2026-07-12, confirmed scoping answer): a bar per linked Activity's own
// start/finish, click jumps the playhead there. No drag/delete — dragging
// a bar's edges would mean rescheduling the underlying Activity itself,
// which belongs to ElementLinkFields' own unlink/reassign flow, not this
// view.
function PresetTrack({
  links, activityById, profileById, scheduleStart, totalMs, onJumpTo,
}: {
  links: ModelElementLink[]
  activityById: Map<string, Activity>
  profileById: Map<string, AnimationProfile>
  scheduleStart: Date
  totalMs: number
  onJumpTo: (date: Date) => void
}) {
  const bars = links
    .map(link => ({ link, activity: activityById.get(link.activity_id) }))
    .filter((x): x is { link: ModelElementLink; activity: Activity } => !!x.activity?.start && !!x.activity?.finish)

  return (
    <div className="relative h-3">
      {bars.map(({ link, activity }) => {
        const s = new Date(activity.start!).getTime()
        const f = new Date(activity.finish!).getTime()
        const left = totalMs > 0 ? ((s - scheduleStart.getTime()) / totalMs) * 100 : 0
        const width = totalMs > 0 ? Math.max(0.5, ((f - s) / totalMs) * 100) : 0
        const profileName = link.animation_profile_id ? profileById.get(link.animation_profile_id)?.name : null
        return (
          <div
            key={link.id}
            title={`${activity.code}: ${activity.task_name}${profileName ? ` — ${profileName}` : ' — (default)'}`}
            onClick={() => onJumpTo(new Date(activity.start!))}
            className="absolute top-0 h-3 rounded-sm bg-violet-400/70 hover:bg-violet-400 cursor-pointer"
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        )
      })}
    </div>
  )
}

interface SubTrackDef {
  label: string
  content: React.ReactNode
}

function ActorRow({
  actor, links, keyframes, isPathBound, activityById, profileById, scheduleStart, scheduleEnd, totalMs, format,
  onJumpTo, onMoveKeyframes, onDeleteKeyframes, onSelect,
}: {
  actor: Actor
  links: ModelElementLink[]
  keyframes: ElementKeyframe[]
  isPathBound: boolean
  activityById: Map<string, Activity>
  profileById: Map<string, AnimationProfile>
  scheduleStart: Date
  scheduleEnd: Date
  totalMs: number
  format: DisplayFormat
  onJumpTo: (date: Date) => void
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
  onSelect: (() => void) | null
}) {
  const [collapsed, setCollapsed] = useState(false)

  const pathGroups = useMemo(() => groupByDay(keyframes, PATH_FIELDS), [keyframes])
  const locationGroups = useMemo(() => groupByDay(keyframes, LOCATION_FIELDS), [keyframes])
  const rotationGroups = useMemo(() => groupByDay(keyframes, ROTATION_FIELDS), [keyframes])
  const scaleGroups = useMemo(() => groupByDay(keyframes, SCALE_FIELDS), [keyframes])
  // A PathFollower binding (2026-07-12 fix, per Maro: "where's my
  // keyframes?" — a path-bound object sitting right on its curve in the
  // viewport, with no "3D Path" row at all) shows this sub-track even
  // before any path_progress keyframe has ever been set — Follow Path
  // still actively drives the object at its default progress (0) the
  // moment it's bound, exactly like PathFollower/AnnotationMarker's own
  // "binding alone is immediately visible" behaviour already documented
  // elsewhere. Gating this on pathGroups.length alone (keyframes only)
  // was the bug — a fresh binding has nothing to show there yet, but is
  // very much an animated actor.
  const hasPath = isPathBound || pathGroups.length > 0

  const trackProps = { scheduleStart, scheduleEnd, totalMs, format, onJumpTo, onMoveKeyframes, onDeleteKeyframes }

  const subTracks: SubTrackDef[] = []
  if (links.length > 0) {
    subTracks.push({ label: 'Preset', content: <PresetTrack links={links} activityById={activityById} profileById={profileById} scheduleStart={scheduleStart} totalMs={totalMs} onJumpTo={onJumpTo} /> })
  }
  if (hasPath) {
    subTracks.push({ label: '3D Path', content: <KeyframeTrack dayGroups={pathGroups} {...trackProps} /> })
  }
  if (locationGroups.length > 0) {
    subTracks.push({ label: 'Location', content: <KeyframeTrack dayGroups={locationGroups} {...trackProps} /> })
  }
  if (rotationGroups.length > 0) {
    subTracks.push({ label: 'Rotation', content: <KeyframeTrack dayGroups={rotationGroups} {...trackProps} /> })
  }
  if (scaleGroups.length > 0) {
    subTracks.push({ label: 'Scale', content: <KeyframeTrack dayGroups={scaleGroups} {...trackProps} /> })
  }

  return (
    <div className="border-b border-gray-100">
      <div className="flex items-center gap-1 px-2 py-1 bg-gray-50">
        <button onClick={() => setCollapsed(c => !c)} className="text-[10px] text-gray-400 w-3 shrink-0">
          {collapsed ? '▸' : '▾'}
        </button>
        <span
          onClick={onSelect ?? undefined}
          className={`text-xs text-gray-700 truncate ${onSelect ? 'cursor-pointer hover:text-sky-600' : ''}`}
          title={onSelect ? 'Click to select in viewport' : undefined}
        >
          {actor.label}
        </span>
      </div>
      {!collapsed && (
        <div className="pl-4 pr-2 py-1 space-y-1">
          {subTracks.map(t => (
            <div key={t.label} className="flex items-center gap-2">
              <span className="text-[10px] text-gray-400 w-14 shrink-0">{t.label}</span>
              <div className="flex-1 min-w-0">{t.content}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// The Animation Timeline's own multi-track "dope sheet" (2026-07-12, per
// Maro: "underneath, the animation timeline... instead of keyframes on the
// line [only for the current selection]... actors with a sub line with
// keyframes on those, so the preset, and 3d path and the transform ones
// (location, rotation, scale) so we know the animation actors at all times
// and can edit as needed"). Project-wide, not scoped to whatever's
// currently selected in the viewport — every mesh/IFC/Annotation actor
// that carries a Preset link, a Follow Path binding, or any Transform
// keyframe gets its own row here, confirmed scoping answer covering all
// three kinds together.
// Memoized (2026-07-21 perf fix, per Maro: "the animation timeline is
// still dragging"/"zero motion" during Play, even after every fix so far
// to the 3D rendering pipeline itself — this component is a completely
// separate DOM-based dope-sheet, not part of that pipeline at all, and
// turned out to be the real bottleneck. Every one of its props
// (modelElementLinks, elementKeyframes, pathFollowers, ...) comes from
// FourD.tsx/TimelineWindow.tsx and is stable across an ordinary re-render —
// none of them depend on the current playhead date — but TimelineWindow.tsx
// updates its own `displayDate` React state on every single
// requestAnimationFrame tick while playing, and this component sat
// unmemoized as its child, so it re-rendered 60 times a second regardless.
// Combined with the O(actors × links) work this used to redo from scratch
// per render (see the grouping useMemo below, added the same fix), a real
// six-combined-discipline schedule (tens of thousands of links) turned
// every rAF tick into multiple seconds of synchronous main-thread work —
// blocking not just this DOM tree but the WebGL canvas's own render loop,
// which shares the same single JS thread. That's the actual mechanism
// behind "keeps the 3D in a static empty state... then goes back to
// empty... zero motion": the browser was mostly frozen re-computing this
// list, occasionally unblocking just long enough to paint whichever date
// the (still-advancing, wall-clock-driven) playhead had reached by then.
export const AnimationActorsList = memo(function AnimationActorsList({
  scheduleStart, scheduleEnd, activities, modelElementLinks, elementKeyframes, pathFollowers, annotations, animationProfiles,
  timeDisplayMode, speedDaysPerSecond, fps,
  onJumpTo, onMoveKeyframes, onDeleteKeyframes, onSelectActor,
}: {
  scheduleStart: Date
  scheduleEnd: Date
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  elementKeyframes: ElementKeyframe[]
  pathFollowers: PathFollower[]
  annotations: Annotation[]
  animationProfiles: AnimationProfile[]
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
  onJumpTo: (date: Date) => void
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
  onSelectActor: (sourceKind: ActorSourceKind, elementRef: string) => void
}) {
  const totalMs = scheduleEnd.getTime() - scheduleStart.getTime()
  const format: DisplayFormat = { scheduleStart, timeDisplayMode, speedDaysPerSecond, fps }

  // One O(n) grouping pass, not an O(links)/O(keyframes) filter *per actor*
  // (2026-07-21 perf fix — see this component's own header). At real
  // schedule scale that per-actor `.filter()`/`.some()` in the render body
  // below used to be O(actors × links) + O(actors × keyframes), redone on
  // every render (and, per this component's own memo above, that used to
  // mean every single animation frame). Grouped once here, keyed the same
  // way `actors` itself is deduped (`${sourceKind}:${elementRef}`), so the
  // render below becomes a plain O(1) Map lookup per actor instead.
  const { actors, linksByActor, keyframesByActor, pathBoundActors } = useMemo(() => {
    const byKey = new Map<string, Actor>()
    const annotationById = new Map(annotations.map(a => [a.id, a]))
    const linksByActor_ = new Map<string, ModelElementLink[]>()
    const keyframesByActor_ = new Map<string, ElementKeyframe[]>()
    const pathBoundActors_ = new Set<string>()

    const labelFor = (sourceKind: ActorSourceKind, elementRef: string): string => {
      if (sourceKind === 'mesh') return elementRef
      const a = annotationById.get(elementRef)
      return a ? `[${a.kind}] ${a.text || '(no note)'}` : elementRef
    }
    const add = (sourceKind: ActorSourceKind, elementRef: string) => {
      const key = `${sourceKind}:${elementRef}`
      if (!byKey.has(key)) byKey.set(key, { sourceKind, elementRef, label: '' })
      return key
    }
    // ifc-kind excluded entirely (2026-07-21, per Maro: "we can do without
    // showing this list [for IFC]... if I want to see activity progression
    // I can bring the Activities/Gantt widgets in") — confirmed against
    // Viewport3D.tsx's own Mode B/C resolution (both explicitly mesh-kind
    // only, see their own "v1 scope" comments) that a real IFC element can
    // *never* actually reach the Location/Rotation/Scale/3D Path sub-tracks
    // below, whatever ElementKeyframe/PathFollower rows might technically
    // exist for one — the only sub-track an ifc actor could ever show is
    // Preset, and PresetTrack is deliberately read-only (its own header:
    // editing belongs to ElementLinkFields' unlink/reassign flow, not
    // here), so it was always just redundant read-only bars duplicating
    // what Activities/Gantt already shows — while also being by far the
    // largest share of rows (one per schedule-linked element, thousands on
    // a real multi-discipline schedule) and therefore this list's dominant
    // cost. Mesh/annotation actors are unaffected — Mode B/C (the actually
    // editable sub-tracks) are exactly the reason this list exists for
    // them.
    for (const link of modelElementLinks) {
      if (link.source_kind !== 'mesh' && link.source_kind !== 'annotation') continue
      const key = add(link.source_kind, link.element_ref)
      const group = linksByActor_.get(key)
      if (group) group.push(link); else linksByActor_.set(key, [link])
    }
    for (const k of elementKeyframes) {
      if (k.source_kind !== 'mesh' && k.source_kind !== 'annotation') continue
      const key = add(k.source_kind, k.element_ref)
      const group = keyframesByActor_.get(key)
      if (group) group.push(k); else keyframesByActor_.set(key, [k])
    }
    for (const f of pathFollowers) {
      // "camera" (2026-07-11) has no viewport UI to bind it yet — see
      // path_follower.py's own docstring — so it never actually appears
      // here in practice; skipped rather than added as a same-scoped gap.
      if (f.target_kind !== 'mesh') continue
      const key = add(f.target_kind, f.element_ref)
      pathBoundActors_.add(key)
    }
    for (const actor of byKey.values()) actor.label = labelFor(actor.sourceKind, actor.elementRef)

    return {
      actors: [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label)),
      linksByActor: linksByActor_, keyframesByActor: keyframesByActor_, pathBoundActors: pathBoundActors_,
    }
  }, [modelElementLinks, elementKeyframes, pathFollowers, annotations])

  // Built once here, not per PresetTrack render (2026-07-21 perf fix) —
  // PresetTrack used to build these same two Maps itself, from the full
  // project-wide `activities`/`animationProfiles` arrays, on every one of
  // its own renders (one per actor with a Preset link). Harmless at small
  // scale, real waste at hundreds of activities x hundreds of Preset-linked
  // mesh/annotation actors, redone every time this list re-renders.
  const activityById = useMemo(() => new Map(activities.map(a => [a.id, a])), [activities])
  const profileById = useMemo(() => new Map(animationProfiles.map(p => [p.id, p])), [animationProfiles])

  if (actors.length === 0) {
    return <p className="px-3 py-3 text-xs text-gray-400">No animated actors yet — link an object to an Activity+Profile, bind it to a Path, or keyframe its Transform to see it here.</p>
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto border-t border-gray-100">
      {actors.map(actor => {
        const key = `${actor.sourceKind}:${actor.elementRef}`
        return (
          <ActorRow
            key={key}
            actor={actor}
            links={linksByActor.get(key) ?? EMPTY_LINKS}
            keyframes={keyframesByActor.get(key) ?? EMPTY_KEYFRAMES}
            isPathBound={pathBoundActors.has(key)}
            activityById={activityById}
            profileById={profileById}
            scheduleStart={scheduleStart}
            scheduleEnd={scheduleEnd}
            totalMs={totalMs}
            format={format}
            onJumpTo={onJumpTo}
            onMoveKeyframes={onMoveKeyframes}
            onDeleteKeyframes={onDeleteKeyframes}
            onSelect={actor.sourceKind === 'ifc' ? null : () => onSelectActor(actor.sourceKind, actor.elementRef)}
          />
        )
      })}
    </div>
  )
})

// Shared empty-array constants (2026-07-21) — an actor with no links or no
// keyframes is the common case; returning the same stable empty array
// instead of allocating a fresh `[]` per actor per render keeps ActorRow's
// own `useMemo`s (groupByDay, keyed on `keyframes`) actually able to skip
// recomputation when nothing changed, rather than seeing a "new" array
// reference every time and recomputing anyway.
const EMPTY_LINKS: ModelElementLink[] = []
const EMPTY_KEYFRAMES: ElementKeyframe[] = []
