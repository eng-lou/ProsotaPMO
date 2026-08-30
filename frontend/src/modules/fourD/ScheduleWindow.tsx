import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatDateTime } from '@/modules/scheduling/dateTime'
import { GANTT_ROW_HEIGHT, HEADER_HEIGHT, parseDate } from '@/modules/scheduling/GanttChart'
import type { Activity } from '@/modules/scheduling/types'
import type { AnimationProfile } from './animationProfiles'
import type { ModelElementLink } from './modelElementLinks'

interface Props {
  // Full raw list — only used here to compute hasChildren (which activity
  // rows get an expand/collapse arrow), independent of the current collapse
  // state (2026-07-09). Actual rendering uses visibleActivities below.
  activities: Activity[]
  // Already outline-ordered + collapse-filtered by FourD.tsx via
  // computeVisibleActivities below — lifted out of this component
  // (2026-07-09, per Maro: "I want full sync capabilities regarding the 4d
  // windows") so the Gantt window can be fed the exact same row set/order,
  // a prerequisite for the two windows' rows to actually correspond 1:1
  // (scrollTop-syncing two panes that show *different* rows at the same
  // pixel offset wouldn't actually mean anything).
  visibleActivities: Activity[]
  collapsedIds: Set<string>
  onToggleCollapsed: (id: string) => void
  // Row click <-> Gantt bar click sync (2026-07-09, per Maro: "the gantt in
  // the 4d doesnt interact with the schedule in the 4d") — both windows
  // read/write the same FourD.tsx-owned selectedActivityIds set, so
  // clicking a row here highlights the matching bar in the Gantt window and
  // vice versa. Plain click replaces the selection; Ctrl/Cmd+click toggles
  // membership, matching this session's other multi-select controls.
  selectedActivityIds: Set<string>
  onSelectActivity: (id: string, additive: boolean) => void
  // Native scrollTop sync with the Gantt window (2026-07-09, per Maro: "I
  // want full sync capabilities") — plain DOM scroll-mirroring (not
  // GanttChart.tsx's own transform-based GanttChartHandle trick, which
  // assumes a fixed-height clipped viewport; these are two independently
  // resizable/dockable WindowChrome panes instead), guarded against
  // feedback loops entirely in FourD.tsx (see its own scroll-sync effect).
  scrollContainerRef: React.RefObject<HTMLDivElement>
  onScroll: (scrollTop: number) => void
  // Profile + Browse columns (2026-07-25, per Maro: "allow me to add the
  // profile and browse columns for the activity table in 4d") — the same
  // two columns Scheduling.tsx's own real Activities grid already has
  // ("3D Profile"/"Browse Elements"), just not previously surfaced in this
  // window's own deliberately-slimmer read-only table. Both stay read-only
  // here (view/browse only, no inline editing) — matching this component's
  // own already-documented "deliberately read-only" contract above; a
  // profile can still be *changed* from Scheduling.tsx's real grid or
  // per-link from the Collections/DataPanel assignment UI, this window
  // just now also shows the result.
  animationProfiles: AnimationProfile[]
  modelElementLinks: ModelElementLink[]
  // 4D's Animation Timeline playhead (2026-08-29, per Maro: "the activity
  // table would also be interactive" as the timeline plays/scrubs) — see
  // GanttChart.tsx's own subscribeFocusDate Props header for the shared
  // mechanism. Drives auto-scroll-to-current-row below; omitted wherever
  // this window isn't paired with a live Animation Timeline.
  subscribeFocusDate?: (cb: (d: Date) => void) => () => void
}

// "Active as of `date`" — same inline start<=date<=finish test the Export
// Video path already uses (exportOverlays.ts's drawActivityTableStrip/
// selectExportActivities), just against the outline-ordered/collapse-
// filtered row list this window actually renders. Falls back to the next
// upcoming activity (first with a start after `date`) when nothing's
// currently in progress, same fallback selectExportActivities uses; falls
// back further to the last dated row when everything's already finished.
// -1 only when nothing in the list has real start/finish dates at all.
//
// Critical-path priority, take 2 (2026-08-30, per Maro: still chaotic after
// the first attempt — "going up and down trying to follow different
// activities in the same time periods") — the first attempt still picked
// "first in outline/WBS-array order" as its tie-break, just narrowed to
// critical activities; real schedules routinely have *several* zero-float
// activities active at once (parallel critical/near-critical chains, e.g.
// offsite fabrication running alongside onsite install), so that tie-break
// kept flipping between unrelated WBS branches for the same reason as
// before, just less often. Tie-break is now which active activity *started
// most recently* (largest start <= date) — a date-based comparison that
// stays consistent regardless of WBS/array position, and matches "what's
// actually being worked on right now" rather than "whatever the tree
// happens to list first". Also switched from `is_critical || sub_is_critical`
// to `is_critical` alone — sub_is_critical is a *different*, per-sub-project
// float calculation (backend/app/services/scheduling_cpm.py's own
// "Second, additional float calculation per PM-tagged sub-project branch"
// pass), not the master critical path; a small tagged branch like an
// elevator pit can be internally zero-float (sub_is_critical) on its own
// terms while being finished and irrelevant months before the date actually
// being followed — that's what sent the row jumping off to an unrelated,
// already-finished branch. The upcoming/last-done fallbacks (used only when
// nothing brackets `date` at all) are date-based for the same reason —
// "first/last in array order" was never actually "next/previous
// chronologically" once the WBS tree's own branch ordering diverges from
// the schedule's actual date order, which is most of the time.
function findCurrentOrNextActivityIndex(list: Activity[], date: Date): number {
  const ms = date.getTime()
  let bestActiveIdx = -1
  let bestActiveStart = -Infinity
  let bestCriticalIdx = -1
  let bestCriticalStart = -Infinity
  let upcomingIdx = -1
  let upcomingStart = Infinity
  let lastDoneIdx = -1
  let lastDoneFinish = -Infinity
  for (let i = 0; i < list.length; i++) {
    // Skip WBS summary rows (2026-08-29 fix, found via live testing) — a
    // summary's own start/finish rolls up its entire subtree (e.g. the
    // top-level "Sample" row spans the whole project), so it always
    // brackets `date` and would win on the very first iteration, before
    // ever reaching the actual in-progress leaf activity. Same exclusion
    // exportOverlays.ts's selectExportActivities already applies for the
    // identical reason.
    if (list[i].activity_type === 'wbs_summary') continue
    const start = parseDate(list[i].start)
    const finish = parseDate(list[i].finish)
    if (!start || !finish) continue
    const startMs = start.getTime()
    const finishMs = finish.getTime()
    if (ms >= startMs && ms <= finishMs) {
      if (startMs > bestActiveStart) { bestActiveStart = startMs; bestActiveIdx = i }
      if (list[i].is_critical && startMs > bestCriticalStart) { bestCriticalStart = startMs; bestCriticalIdx = i }
      continue
    }
    if (startMs > ms && startMs < upcomingStart) { upcomingStart = startMs; upcomingIdx = i }
    if (finishMs <= ms && finishMs > lastDoneFinish) { lastDoneFinish = finishMs; lastDoneIdx = i }
  }
  if (bestCriticalIdx !== -1) return bestCriticalIdx
  if (bestActiveIdx !== -1) return bestActiveIdx
  return upcomingIdx !== -1 ? upcomingIdx : lastDoneIdx
}

function formatDuration(value: number | string | null): string {
  if (value === null) return '—'
  const n = Number(value)
  return Number.isNaN(n) ? '—' : String(Math.round(n))
}

// Outline order + depth from parent_id/wbs_path (2026-07-11) — a fresh,
// read-only reimplementation, not an extraction of Scheduling.tsx's own
// activity table (that one's tree-building is inline and tightly coupled to
// its inline-editing/column-resize/sort state — see this file's own history
// for why a read-only version was scoped separately rather than sharing
// that code). Same underlying approach though: group by parent_id, depth-
// first visit for outline order, depth = wbs_path's dot-count.
export function buildOutline(activities: Activity[]): Activity[] {
  const byParent = new Map<string | null, Activity[]>()
  for (const a of activities) {
    const key = a.parent_id
    if (!byParent.has(key)) byParent.set(key, [])
    byParent.get(key)!.push(a)
  }
  const seen = new Set<string>()
  const ordered: Activity[] = []
  function visit(parentId: string | null) {
    for (const child of byParent.get(parentId) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      ordered.push(child)
      visit(child.id)
    }
  }
  visit(null)
  // Orphans (a stale/dangling parent_id) — append at the end rather than
  // silently drop them, matching Scheduling.tsx's own fallback.
  for (const a of activities) {
    if (!seen.has(a.id)) { seen.add(a.id); ordered.push(a) }
  }
  return ordered
}

export function depthOf(a: Activity): number {
  return a.wbs_path ? a.wbs_path.split('.').length - 1 : 0
}

// The single source of truth for "what rows are actually showing, and in
// what order" (2026-07-09) — used by FourD.tsx to feed both this window
// *and* the Gantt window the identical list, so a collapsed WBS summary
// here also hides its bars there, same as Scheduling.tsx's own paired grid
// + chart.
export function computeVisibleActivities(activities: Activity[], collapsedIds: Set<string>): Activity[] {
  const byId = new Map(activities.map(a => [a.id, a]))
  const ordered = buildOutline(activities)
  return ordered.filter(a => {
    let current = a.parent_id ? byId.get(a.parent_id) : undefined
    while (current) {
      if (collapsedIds.has(current.id)) return false
      current = current.parent_id ? byId.get(current.parent_id) : undefined
    }
    return true
  })
}

// 2026-07-11, per Maro: "adopt the layout of the activity table in the
// schedule" — upgraded from a flat list to this WBS-hierarchy tree (indent
// by depth, bold/shaded summary rows with collapse, critical-path tinting),
// staying deliberately read-only (Maro's own call, given the Activities
// tab's real table's inline-editing/resize/sort logic isn't extracted into
// anything reusable — see buildOutline's own note above). Content-only —
// WindowChrome.tsx owns the header/dock-toggle/close.
export function ScheduleWindow({
  activities, visibleActivities, collapsedIds, onToggleCollapsed, selectedActivityIds, onSelectActivity,
  scrollContainerRef, onScroll, animationProfiles, modelElementLinks, subscribeFocusDate,
}: Props) {
  const hasChildren = new Set<string>()
  for (const a of activities) if (a.parent_id) hasChildren.add(a.parent_id)

  // Auto-scroll-to-current-row (2026-08-29, revised same day per Maro:
  // "too jittery... the table move in and out of focus... i just want a
  // seamless transition") — the first version re-aligned the row flush
  // against whichever edge it was about to cross, which meant sitting
  // still and then hard-jumping every time, reading as the table snapping
  // in and out of focus rather than following smoothly. Unlike the Gantt's
  // own horizontal follow (which re-anchors every tick because todayOffset
  // itself changes continuously), which row is "current" only changes on
  // the rare tick an activity boundary is actually crossed — so the fix
  // here isn't "follow every tick", it's "only scroll on that real
  // transition, and make that one scroll itself smooth" via native
  // scroll-behavior rather than an instant teleport. currentActivityId IS
  // state, but (like before) only changes on that same rare tick — still
  // no per-frame re-render of this table.
  const [currentActivityId, setCurrentActivityId] = useState<string | null>(null)
  const currentActivityIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!subscribeFocusDate) return
    return subscribeFocusDate(date => {
      const idx = findCurrentOrNextActivityIndex(visibleActivities, date)
      if (idx === -1 || currentActivityIdRef.current === visibleActivities[idx].id) return
      currentActivityIdRef.current = visibleActivities[idx].id
      setCurrentActivityId(visibleActivities[idx].id)
      const container = scrollContainerRef.current
      if (!container) return
      const rowTop = HEADER_HEIGHT + idx * GANTT_ROW_HEIGHT
      const target = Math.max(0, rowTop - container.clientHeight * 0.35)
      container.scrollTo({ top: target, behavior: 'smooth' })
    })
  }, [subscribeFocusDate, visibleActivities, scrollContainerRef])

  const profileNameById = useMemo(() => new Map(animationProfiles.map(p => [p.id, p.name])), [animationProfiles])
  const elementLinksByActivityId = useMemo(() => {
    const map = new Map<string, ModelElementLink[]>()
    for (const link of modelElementLinks) {
      const existing = map.get(link.activity_id)
      if (existing) existing.push(link); else map.set(link.activity_id, [link])
    }
    return map
  }, [modelElementLinks])
  // Which row's Browse popup is open, plus where to render it (2026-07-25,
  // same fixed/portal approach as Scheduling.tsx's own elementsBrowse —
  // see the popup's own render below for why a portal specifically).
  const [elementsBrowse, setElementsBrowse] = useState<{ activityId: string; x: number; y: number } | null>(null)

  return (
    <div ref={scrollContainerRef} onScroll={e => onScroll(e.currentTarget.scrollTop)} className="overflow-auto h-full">
      <table className="w-full text-xs border-collapse">
          {/* Row/header heights pinned to GanttChart.tsx's own exported
              GANTT_ROW_HEIGHT/HEADER_HEIGHT constants (2026-07-09 fix, per
              Maro: "the gantt and activity table has misalignment") — same
              fixed-height requirement GanttChart.tsx's own header comment
              already documents for Scheduling.tsx's paired grid+chart, just
              applied here too so the Nth row lines up at the same height in
              both windows when they're docked side by side. Cell padding
              alone (the previous px-2 py-1 approach) produced a row height
              that had no defined relationship to the Gantt's fixed 46px
              rows/36px header, so they drifted apart by design, not by
              accident. */}
          <thead className="sticky top-0 bg-gray-50 dark:bg-prosota-panel2 z-10">
            <tr className="text-left text-gray-500 dark:text-prosota-muted" style={{ height: HEADER_HEIGHT }}>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line">Code</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line">Name</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line text-right">Dur (d)</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line">Start</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line">Finish</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line" title="Animation profile every 3D element linked to this activity uses in the 4D timeline, unless one has its own override">Profile</th>
              <th className="px-2 border-b border-gray-200 dark:border-prosota-line" title="Click to browse the individual 3D elements linked to this activity">Browse</th>
            </tr>
          </thead>
          <tbody>
            {visibleActivities.map(a => {
              const depth = depthOf(a)
              const isSummary = a.activity_type === 'wbs_summary'
              const critical = a.is_critical || a.sub_is_critical
              const isCollapsed = collapsedIds.has(a.id)
              const isSelected = selectedActivityIds.has(a.id)
              const isCurrent = a.id === currentActivityId
              const links = elementLinksByActivityId.get(a.id) ?? []
              return (
                <tr
                  key={a.id}
                  onClick={e => onSelectActivity(a.id, e.ctrlKey || e.metaKey)}
                  style={{ height: GANTT_ROW_HEIGHT }}
                  className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-prosota-panel2 ${isSummary ? 'bg-gray-50/70' : ''} ${isSelected ? 'bg-blue-50 outline outline-1 outline-blue-400 -outline-offset-1' : ''} ${isCurrent ? 'border-l-2 border-l-amber-500' : ''}`}
                >
                  <td className={`px-2 border-b border-gray-100 dark:border-prosota-line font-mono ${critical ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>{a.code}</td>
                  <td className={`px-2 border-b border-gray-100 dark:border-prosota-line ${isSummary ? 'font-bold text-gray-800 dark:text-prosota-paper' : critical ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>
                    <span style={{ paddingLeft: depth * 16 }} className="inline-flex items-center gap-1">
                      {hasChildren.has(a.id) ? (
                        <button onClick={e => { e.stopPropagation(); onToggleCollapsed(a.id) }} className="text-gray-400 dark:text-prosota-muted w-3 shrink-0">
                          {isCollapsed ? '▸' : '▾'}
                        </button>
                      ) : <span className="w-3 shrink-0" />}
                      {a.task_name}
                    </span>
                  </td>
                  <td className={`px-2 border-b border-gray-100 dark:border-prosota-line text-right ${critical ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>{formatDuration(a.duration_days)}</td>
                  <td className={`px-2 border-b border-gray-100 dark:border-prosota-line ${critical ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>{formatDateTime(a.start, false)}</td>
                  <td className={`px-2 border-b border-gray-100 dark:border-prosota-line ${critical ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>{formatDateTime(a.finish, false)}</td>
                  <td className="px-2 border-b border-gray-100 dark:border-prosota-line text-gray-500 dark:text-prosota-muted whitespace-nowrap overflow-hidden text-ellipsis">
                    {a.animation_profile_id ? (profileNameById.get(a.animation_profile_id) ?? 'Default') : <span className="text-gray-300 dark:text-prosota-line">Default</span>}
                  </td>
                  <td className="px-2 border-b border-gray-100 dark:border-prosota-line">
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (elementsBrowse?.activityId === a.id) { setElementsBrowse(null); return }
                        const rect = e.currentTarget.getBoundingClientRect()
                        setElementsBrowse({ activityId: a.id, x: rect.left, y: rect.bottom })
                      }}
                      disabled={links.length === 0}
                      className="text-left w-full truncate disabled:text-gray-300 disabled:cursor-default hover:text-blue-600 disabled:hover:text-gray-300"
                      title={links.length > 0 ? 'Browse linked 3D elements' : 'No 3D elements linked to this activity'}
                    >
                      {links.length === 0 ? '—' : `Browse (${links.length}) ▾`}
                    </button>
                  </td>
                </tr>
              )
            })}
            {activities.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-4 text-center text-gray-400 dark:text-prosota-muted">No activities yet</td></tr>
            )}
          </tbody>
        </table>
      {elementsBrowse && (() => {
        const links = elementLinksByActivityId.get(elementsBrowse.activityId) ?? []
        if (links.length === 0) return null
        // Portal straight onto document.body (2026-07-25, same reasoning as
        // Scheduling.tsx's own elementsBrowse popup) — this window's own
        // scroll container clips a same-subtree popover no matter how it's
        // positioned; fixed (viewport-relative) coordinates, already read as
        // getBoundingClientRect values at click time.
        return createPortal(
          <>
            <div className="fixed inset-0 z-40" onClick={() => setElementsBrowse(null)} />
            <div
              className="fixed z-50 w-64 max-h-64 overflow-y-auto bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md shadow-lg py-1"
              style={{ left: elementsBrowse.x, top: elementsBrowse.y + 4 }}
            >
              {links.map(link => (
                <div
                  key={link.id}
                  className="px-2.5 py-1 text-xs text-gray-700 dark:text-prosota-muted truncate border-b border-gray-50 last:border-b-0"
                  title={`${link.element_label} (${link.element_ref})`}
                >
                  {link.element_label}
                </div>
              ))}
            </div>
          </>,
          document.body,
        )
      })()}
    </div>
  )
}
