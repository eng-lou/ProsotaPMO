import { memo, useMemo, useRef, useState } from 'react'
import type { Activity } from '@/modules/scheduling/types'
import type { Annotation } from './annotations'
import type { AnimationProfile } from './animationProfiles'
import type { ElementKeyframe, KeyframeField } from './elementKeyframes'
import type { ModelElementLink } from './modelElementLinks'
import type { Path } from './paths'
import type { PathFollower } from './pathFollowers'
import { formatTimelineValue, type TimeDisplayMode } from './timelinePlayback'
import type { Zone } from './zones'

type ActorSourceKind = 'mesh' | 'ifc' | 'annotation' | 'path' | 'zone'

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
// A Path/Zone's own line-draw/border-draw reveal window (2026-07-30, per
// Maro: "if i keyframe i should see the path actor in the timeline with
// both keyframes so i can drag, delete etc") — reuses KeyframeTrack
// exactly like every other field group here, just for source_kind
// 'path'/'zone' actors instead of 'mesh'/'annotation'.
const ANIM_FIELDS = ['anim_start', 'anim_end'] as const

// One editable sub-track row (2026-07-12, per Maro: "underneath, the
// animation timeline... actors with a sub line with keyframes on those")
// — reuses TimelineWindow.tsx's own single-actor marker drag/delete
// interaction verbatim, just generalized to whichever day-grouped list a
// given actor+field-group resolves to, instead of always the current
// viewport selection. Each instance owns its own local drag state — rows
// are fully independent, no shared state needed across sub-tracks.
// selectedIds (2026-07-23, per Maro: "allow me to drag and select all
// keyframe and delete or copy and paste") — ActorRow's own box-select
// drag (below) is what actually populates this; a day-group here just
// needs to know whether any of its own keyframes are in it, to render the
// amber diamond as selected instead of reaching into selection logic
// itself.
function KeyframeTrack({
  dayGroups, scheduleStart, totalMs, format, onJumpTo, onMoveKeyframes, onDeleteKeyframes, selectedIds,
}: {
  dayGroups: DayGroup[]
  scheduleStart: Date
  scheduleEnd: Date
  totalMs: number
  format: DisplayFormat
  onJumpTo: (date: Date) => void
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
  selectedIds: Set<string>
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
        const selected = group.keyframes.some(k => selectedIds.has(k.id))
        return (
          <div
            key={dayKey}
            title={`${formatTimelineValue(shownDate, format.scheduleStart, format.timeDisplayMode, format.speedDaysPerSecond, format.fps)} — drag to move, right-click to delete`}
            onPointerDown={handlePointerDown(group)}
            onContextMenu={e => { e.preventDefault(); onDeleteKeyframes(group.keyframes) }}
            className={`absolute top-0.5 w-2 h-2 border rotate-45 -translate-x-1/2 cursor-grab active:cursor-grabbing ${
              selected ? 'bg-sky-500 border-sky-600 ring-2 ring-sky-300' : 'bg-amber-500 border-amber-600'
            } ${dragging ? 'ring-2 ring-amber-300' : ''}`}
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
        // Link's own override wins, else the activity's own profile — same
        // cascade Viewport3D.tsx's own Mode A resolution uses, so this
        // tooltip's "(default)" fallback only shows when neither is set.
        const profileId = link.animation_profile_id ?? activity.animation_profile_id
        const profileName = profileId ? profileById.get(profileId)?.name : null
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

// Box-select (2026-07-23, per Maro: "allow me to drag and select all
// keyframe" — confirmed scoping answer: one drag spans every sub-track for
// this actor at once, Location+Rotation+Scale+3D Path together, not one
// row at a time). Deliberately horizontal-only — the highlight rectangle
// always spans the full height of the sub-track stack regardless of the
// drag's own Y — since "which time range" is the only thing that
// distinguishes one keyframe from another here; there's no vertical
// channel-picking concept the way a real 2D box-select would need. Reads
// `keyframes` (every field, every sub-track, ungrouped) directly rather
// than re-deriving from the day-grouped sub-tracks — a flat date-range
// filter over that same list ActorRow already has is exactly the set a
// human dragging across those diamonds would expect to grab.
function useBoxSelect(keyframes: ElementKeyframe[], scheduleStart: Date, totalMs: number, onSelect: (ids: string[]) => void) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ startX: number; currentX: number } | null>(null)

  const dateFromClientX = (clientX: number): Date => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return scheduleStart
    const pct = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return new Date(scheduleStart.getTime() + pct * totalMs)
  }

  // Only ever reached for a pointerdown that lands on empty track
  // background — every diamond's own onPointerDown (KeyframeTrack, above)
  // already calls stopPropagation, so this never fires for a click that's
  // actually meant to drag/jump a single keyframe.
  const onBackgroundPointerDown = (e: React.PointerEvent) => {
    const startX = e.clientX
    setDrag({ startX, currentX: startX })
    const handleMove = (ev: PointerEvent) => setDrag({ startX, currentX: ev.clientX })
    const handleUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      const lo = Math.min(startX, ev.clientX)
      const hi = Math.max(startX, ev.clientX)
      if (hi - lo > 3) {
        const loMs = dateFromClientX(lo).getTime()
        const hiMs = dateFromClientX(hi).getTime()
        onSelect(keyframes.filter(k => {
          const t = new Date(k.date).getTime()
          return t >= loMs && t <= hiMs
        }).map(k => k.id))
      } else {
        onSelect([])
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }

  const overlay = drag && Math.abs(drag.currentX - drag.startX) > 3 && containerRef.current ? (
    <div
      className="absolute top-0 bottom-0 bg-sky-400/20 border border-sky-400 pointer-events-none"
      style={{
        left: Math.min(drag.startX, drag.currentX) - containerRef.current.getBoundingClientRect().left,
        width: Math.abs(drag.currentX - drag.startX),
      }}
    />
  ) : null

  return { containerRef, onBackgroundPointerDown, overlay }
}

function ActorRow({
  actor, links, keyframes, isPathBound, isAnimatable, activityById, profileById, scheduleStart, scheduleEnd, totalMs, format,
  onJumpTo, onMoveKeyframes, onDeleteKeyframes, onSelect, selectedIds, onBoxSelect,
}: {
  actor: Actor
  links: ModelElementLink[]
  keyframes: ElementKeyframe[]
  isPathBound: boolean
  isAnimatable: boolean
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
  selectedIds: Set<string>
  onBoxSelect: (ids: string[]) => void
}) {
  const [collapsed, setCollapsed] = useState(false)
  const boxSelect = useBoxSelect(keyframes, scheduleStart, totalMs, onBoxSelect)

  const pathGroups = useMemo(() => groupByDay(keyframes, PATH_FIELDS), [keyframes])
  const locationGroups = useMemo(() => groupByDay(keyframes, LOCATION_FIELDS), [keyframes])
  const rotationGroups = useMemo(() => groupByDay(keyframes, ROTATION_FIELDS), [keyframes])
  const scaleGroups = useMemo(() => groupByDay(keyframes, SCALE_FIELDS), [keyframes])
  const animGroups = useMemo(() => groupByDay(keyframes, ANIM_FIELDS), [keyframes])
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
  // Same "binding alone is immediately visible" reasoning for a Path/Zone's
  // own reveal window (2026-07-30) — `animate` toggled on with no keyframes
  // keyed yet is still an animated actor, per Maro: "if i keyframe i should
  // see the path actor in the timeline."
  const hasAnim = isAnimatable || animGroups.length > 0

  const trackProps = { scheduleStart, scheduleEnd, totalMs, format, onJumpTo, onMoveKeyframes, onDeleteKeyframes, selectedIds }

  const subTracks: SubTrackDef[] = []
  if (links.length > 0) {
    subTracks.push({ label: 'Preset', content: <PresetTrack links={links} activityById={activityById} profileById={profileById} scheduleStart={scheduleStart} totalMs={totalMs} onJumpTo={onJumpTo} /> })
  }
  if (hasPath) {
    subTracks.push({ label: '3D Path', content: <KeyframeTrack dayGroups={pathGroups} {...trackProps} /> })
  }
  if (hasAnim) {
    subTracks.push({ label: 'Reveal', content: <KeyframeTrack dayGroups={animGroups} {...trackProps} /> })
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
        <div className="flex gap-2 pl-4 pr-2 py-1">
          <div className="w-14 shrink-0 space-y-1">
            {subTracks.map(t => (
              <div key={t.label} className="h-3 flex items-center text-[10px] text-gray-400">{t.label}</div>
            ))}
          </div>
          {/* Box-select's own container (2026-07-23) — spans just the
              track *content* column, not the label column beside it, so
              its bounding rect matches exactly what each KeyframeTrack row
              inside it already uses for its own clientX -> date math
              (useBoxSelect's own header). A drag started here covers every
              sub-track stacked inside at once. */}
          <div
            className="relative flex-1 min-w-0 space-y-1"
            ref={boxSelect.containerRef}
            onPointerDown={boxSelect.onBackgroundPointerDown}
          >
            {subTracks.map(t => <div key={t.label}>{t.content}</div>)}
            {boxSelect.overlay}
          </div>
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
  scheduleStart, scheduleEnd, currentDate, activities, modelElementLinks, elementKeyframes, pathFollowers, annotations, animationProfiles, paths, zones,
  timeDisplayMode, speedDaysPerSecond, fps,
  onJumpTo, onMoveKeyframes, onDeleteKeyframes, onCreateKeyframes, onReverseKeyframes, onSelectActor,
}: {
  scheduleStart: Date
  scheduleEnd: Date
  // Paste's own anchor (2026-07-23) — "at the current playhead date," per
  // Maro's own confirmed choice, not the schedule's start/end.
  currentDate: Date
  activities: Activity[]
  modelElementLinks: ModelElementLink[]
  elementKeyframes: ElementKeyframe[]
  pathFollowers: PathFollower[]
  annotations: Annotation[]
  animationProfiles: AnimationProfile[]
  paths: Path[]
  zones: Zone[]
  timeDisplayMode: TimeDisplayMode
  speedDaysPerSecond: number
  fps: number
  onJumpTo: (date: Date) => void
  onMoveKeyframes: (dayKeyframes: ElementKeyframe[], newDate: Date) => void
  onDeleteKeyframes: (dayKeyframes: ElementKeyframe[]) => void
  onCreateKeyframes: (rows: { sourceKind: ElementKeyframe['source_kind']; elementRef: string; field: KeyframeField; date: Date; value: number }[]) => void
  onReverseKeyframes: (keyframes: ElementKeyframe[]) => void
  onSelectActor: (sourceKind: ActorSourceKind, elementRef: string) => void
}) {
  const totalMs = scheduleEnd.getTime() - scheduleStart.getTime()
  const format: DisplayFormat = { scheduleStart, timeDisplayMode, speedDaysPerSecond, fps }

  // Box-select/Delete/Copy/Paste/Reverse (2026-07-23, per Maro: "allow me
  // to drag and select all keyframe and delete or copy and paste"/"reverse
  // too"). Selection is scoped to one actor at a time — ActorRow's own
  // box-select drag (useBoxSelect, above) only ever grabs keyframes
  // belonging to the actor it was dragged inside, so selectedActorKey just
  // tracks *which* row's selectedIds is actually live; every other row
  // gets the shared EMPTY_IDS constant below rather than an empty set of
  // its own each render (same stable-reference reasoning as EMPTY_LINKS/
  // EMPTY_KEYFRAMES further down). The clipboard remembers which actor it
  // was copied from (clipboardActorKey) so Paste always re-targets that
  // same object — copying one object's animation shape onto a *different*
  // object was never asked for, only "paste it again," so there's no
  // target-picker to build.
  const [selectedActorKey, setSelectedActorKey] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [clipboard, setClipboard] = useState<{ field: KeyframeField; offsetMs: number; value: number }[] | null>(null)
  const [clipboardActorKey, setClipboardActorKey] = useState<string | null>(null)

  const handleBoxSelect = (actorKey: string, ids: string[]) => {
    setSelectedActorKey(ids.length > 0 ? actorKey : null)
    setSelectedIds(new Set(ids))
  }

  const selectedKeyframes = useMemo(
    () => elementKeyframes.filter(k => selectedIds.has(k.id)),
    [elementKeyframes, selectedIds],
  )

  const clearSelection = () => { setSelectedActorKey(null); setSelectedIds(new Set()) }

  const handleDeleteSelected = () => {
    if (selectedKeyframes.length === 0) return
    onDeleteKeyframes(selectedKeyframes)
    clearSelection()
  }

  const handleCopySelected = () => {
    if (selectedKeyframes.length === 0 || !selectedActorKey) return
    const earliestMs = Math.min(...selectedKeyframes.map(k => new Date(k.date).getTime()))
    setClipboard(selectedKeyframes.map(k => ({ field: k.field, offsetMs: new Date(k.date).getTime() - earliestMs, value: k.value })))
    setClipboardActorKey(selectedActorKey)
  }

  const handleReverseSelected = () => {
    if (selectedKeyframes.length === 0) return
    onReverseKeyframes(selectedKeyframes)
  }

  // References `actors` (defined further down via useMemo) — safe despite
  // the declaration order: this closure only ever runs later, from the
  // Paste button's own onClick, by which point the component function has
  // already finished running top to bottom and `actors` is fully set.
  const handlePaste = () => {
    if (!clipboard || !clipboardActorKey) return
    const actor = actors.find(a => `${a.sourceKind}:${a.elementRef}` === clipboardActorKey)
    if (!actor) return
    const anchorMs = currentDate.getTime()
    onCreateKeyframes(clipboard.map(c => ({
      sourceKind: actor.sourceKind, elementRef: actor.elementRef, field: c.field, date: new Date(anchorMs + c.offsetMs), value: c.value,
    })))
  }

  // One O(n) grouping pass, not an O(links)/O(keyframes) filter *per actor*
  // (2026-07-21 perf fix — see this component's own header). At real
  // schedule scale that per-actor `.filter()`/`.some()` in the render body
  // below used to be O(actors × links) + O(actors × keyframes), redone on
  // every render (and, per this component's own memo above, that used to
  // mean every single animation frame). Grouped once here, keyed the same
  // way `actors` itself is deduped (`${sourceKind}:${elementRef}`), so the
  // render below becomes a plain O(1) Map lookup per actor instead.
  const { actors, linksByActor, keyframesByActor, pathBoundActors, animatableActors } = useMemo(() => {
    const byKey = new Map<string, Actor>()
    const annotationById = new Map(annotations.map(a => [a.id, a]))
    const pathById = new Map(paths.map(p => [p.id, p]))
    const zoneById = new Map(zones.map(z => [z.id, z]))
    const linksByActor_ = new Map<string, ModelElementLink[]>()
    const keyframesByActor_ = new Map<string, ElementKeyframe[]>()
    const pathBoundActors_ = new Set<string>()
    const animatableActors_ = new Set<string>()

    const labelFor = (sourceKind: ActorSourceKind, elementRef: string): string => {
      if (sourceKind === 'mesh') return elementRef
      if (sourceKind === 'path') return pathById.get(elementRef)?.name ?? elementRef
      if (sourceKind === 'zone') return zoneById.get(elementRef)?.name ?? elementRef
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
      if (k.source_kind !== 'mesh' && k.source_kind !== 'annotation' && k.source_kind !== 'path' && k.source_kind !== 'zone') continue
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
    // A Path/Zone with `animate` on is its own actor the moment that toggle
    // is flipped (2026-07-30) — same "binding alone is immediately visible"
    // reasoning as pathBoundActors above, so the row appears in time to key
    // the very first anim_start/anim_end, not only after one already exists.
    for (const p of paths) {
      if (!p.animate) continue
      animatableActors_.add(add('path', p.id))
    }
    for (const z of zones) {
      if (!z.animate) continue
      animatableActors_.add(add('zone', z.id))
    }
    // Same "binding alone is immediately visible" reasoning, for an
    // Annotation's own whole-marker reveal window (2026-08-06, per Maro:
    // "how the leader works and how its animated which should also have
    // the ability to be animated independent of tasks").
    for (const a of annotations) {
      if (!a.animate) continue
      animatableActors_.add(add('annotation', a.id))
    }
    for (const actor of byKey.values()) actor.label = labelFor(actor.sourceKind, actor.elementRef)

    return {
      actors: [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label)),
      linksByActor: linksByActor_, keyframesByActor: keyframesByActor_, pathBoundActors: pathBoundActors_, animatableActors: animatableActors_,
    }
  }, [modelElementLinks, elementKeyframes, pathFollowers, annotations, paths, zones])

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
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden border-t border-gray-100">
      {/* selectedKeyframes.length, not selectedIds.size (2026-07-23 fix,
          found while cleaning up test data during this same feature's own
          verification) — a selection made before its object gets unloaded
          (or its keyframes otherwise deleted some other way) left
          selectedIds pointing at ids that no longer exist in
          elementKeyframes; selectedIds.size stayed "9" forever, showing a
          toolbar whose own Copy/Reverse/Delete buttons all silently
          no-op against an actually-empty selectedKeyframes. Deriving both
          the visibility check and the displayed count from
          selectedKeyframes instead means the bar honestly reflects what
          Delete/Copy/Reverse would actually act on, and disappears on its
          own the moment that's empty — no separate cleanup effect needed. */}
      {selectedKeyframes.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 bg-sky-50 border-b border-sky-100 text-xs shrink-0">
          <span className="text-gray-600">{selectedKeyframes.length} keyframe{selectedKeyframes.length === 1 ? '' : 's'} selected</span>
          <button onClick={handleCopySelected} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">Copy</button>
          <button onClick={handleReverseSelected} className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">Reverse</button>
          <button onClick={handleDeleteSelected} className="px-1.5 py-0.5 rounded border border-red-300 bg-white text-red-600 hover:bg-red-50">Delete</button>
          <button onClick={clearSelection} className="ml-auto text-gray-400 hover:text-gray-600">Clear</button>
        </div>
      )}
      {clipboard && (
        <div className="flex items-center gap-2 px-3 py-1 bg-amber-50 border-b border-amber-100 text-xs shrink-0">
          <span className="text-gray-600">{clipboard.length} keyframe{clipboard.length === 1 ? '' : 's'} copied</span>
          <button
            onClick={handlePaste}
            title="Pastes at the current playhead date, keeping every copied keyframe's own offset from the earliest one"
            className="px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          >
            Paste at playhead
          </button>
          <button onClick={() => { setClipboard(null); setClipboardActorKey(null) }} className="ml-auto text-gray-400 hover:text-gray-600">Clear</button>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {actors.map(actor => {
          const key = `${actor.sourceKind}:${actor.elementRef}`
          return (
            <ActorRow
              key={key}
              actor={actor}
              links={linksByActor.get(key) ?? EMPTY_LINKS}
              keyframes={keyframesByActor.get(key) ?? EMPTY_KEYFRAMES}
              isPathBound={pathBoundActors.has(key)}
              isAnimatable={animatableActors.has(key)}
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
              selectedIds={selectedActorKey === key ? selectedIds : EMPTY_IDS}
              onBoxSelect={ids => handleBoxSelect(key, ids)}
            />
          )
        })}
      </div>
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
// Same reasoning, for every actor row that isn't the one currently holding
// a box-select (2026-07-23) — a fresh `new Set()` per non-selected actor
// per render would defeat KeyframeTrack's own diamond-selected check for
// no benefit, since it's never non-empty anyway.
const EMPTY_IDS: Set<string> = new Set()
