import { formatDateTime } from '@/modules/scheduling/dateTime'
import { GANTT_ROW_HEIGHT, HEADER_HEIGHT } from '@/modules/scheduling/GanttChart'
import type { Activity } from '@/modules/scheduling/types'

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
  scrollContainerRef, onScroll,
}: Props) {
  const hasChildren = new Set<string>()
  for (const a of activities) if (a.parent_id) hasChildren.add(a.parent_id)

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
          <thead className="sticky top-0 bg-gray-50 z-10">
            <tr className="text-left text-gray-500" style={{ height: HEADER_HEIGHT }}>
              <th className="px-2 border-b border-gray-200">Code</th>
              <th className="px-2 border-b border-gray-200">Name</th>
              <th className="px-2 border-b border-gray-200 text-right">Dur (d)</th>
              <th className="px-2 border-b border-gray-200">Start</th>
              <th className="px-2 border-b border-gray-200">Finish</th>
            </tr>
          </thead>
          <tbody>
            {visibleActivities.map(a => {
              const depth = depthOf(a)
              const isSummary = a.activity_type === 'wbs_summary'
              const critical = a.is_critical || a.sub_is_critical
              const isCollapsed = collapsedIds.has(a.id)
              const isSelected = selectedActivityIds.has(a.id)
              return (
                <tr
                  key={a.id}
                  onClick={e => onSelectActivity(a.id, e.ctrlKey || e.metaKey)}
                  style={{ height: GANTT_ROW_HEIGHT }}
                  className={`cursor-pointer hover:bg-gray-50 ${isSummary ? 'bg-gray-50/70' : ''} ${isSelected ? 'bg-blue-50 outline outline-1 outline-blue-400 -outline-offset-1' : ''}`}
                >
                  <td className={`px-2 border-b border-gray-100 font-mono ${critical ? 'text-red-600' : 'text-gray-500'}`}>{a.code}</td>
                  <td className={`px-2 border-b border-gray-100 ${isSummary ? 'font-bold text-gray-800' : critical ? 'text-red-600' : 'text-gray-700'}`}>
                    <span style={{ paddingLeft: depth * 16 }} className="inline-flex items-center gap-1">
                      {hasChildren.has(a.id) ? (
                        <button onClick={e => { e.stopPropagation(); onToggleCollapsed(a.id) }} className="text-gray-400 w-3 shrink-0">
                          {isCollapsed ? '▸' : '▾'}
                        </button>
                      ) : <span className="w-3 shrink-0" />}
                      {a.task_name}
                    </span>
                  </td>
                  <td className={`px-2 border-b border-gray-100 text-right ${critical ? 'text-red-600' : 'text-gray-500'}`}>{formatDuration(a.duration_days)}</td>
                  <td className={`px-2 border-b border-gray-100 ${critical ? 'text-red-600' : 'text-gray-500'}`}>{formatDateTime(a.start, false)}</td>
                  <td className={`px-2 border-b border-gray-100 ${critical ? 'text-red-600' : 'text-gray-500'}`}>{formatDateTime(a.finish, false)}</td>
                </tr>
              )
            })}
            {activities.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-4 text-center text-gray-400">No activities yet</td></tr>
            )}
          </tbody>
        </table>
    </div>
  )
}
