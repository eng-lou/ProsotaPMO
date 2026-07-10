import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import { recalculateCosts, saveSpreadRange, type ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { formatDateTime } from './dateTime'
import { resolveHoursPerDay } from './durationDisplay'
import { RESOURCE_CHART_Y_AXIS_WIDTH, type ResourcesLayoutPrefs } from './resourcesLayout'
import { eachDate, indexSpread, type AssignmentRow } from './useResourcesTabData'
import type { Calendar, Resource, ResourceAssignment } from './types'

interface Props {
  calendars: Calendar[]
  trackedResources: Resource[]
  assignmentsByResource: Map<string, AssignmentRow[]>
  buckets: { start: Date; end: Date; label: string }[]
  spreadByResource: Map<string, ResourceSpread>
  loading: boolean
  onRefetchResource: (resourceId: string) => Promise<void>
  unit: 'hours' | 'days' | 'cost'
  layoutPrefs: ResourcesLayoutPrefs
  // Checked rows (2026-07-08, per Maro: "full interactivity") — shared with
  // Resource Pool and Resource Usage Profile via Scheduling.tsx, so checking
  // a resource or activity anywhere scopes all three consistently.
  selectedResourceIds: Set<string>
  onToggleResourceSelected: (id: string) => void
  selectedActivityIds: Set<string>
  onToggleActivitySelected: (id: string) => void
  collapsedIds: Set<string>
  onToggleCollapsed: (resourceId: string) => void
  // Keeps this table's own tree/timeline divider lined up with Resource
  // Usage Profile's, and their timeline scroll positions mirrored in both
  // directions — both owned by Scheduling.tsx since two sibling widgets need
  // to agree on them (2026-07-09, per Maro: "align the dividers... ensure
  // scrolling across spreadsheet also scrolls across usage profile and vice
  // versa"). Both optional so this widget still works standalone.
  onLeftPaneWidthChange?: (width: number) => void
  scrollLeft?: number
  onScrollLeftChange?: (scrollLeft: number) => void
}

const VISIBLE_COLS_STORAGE_KEY = 'prosota_resource_tracking_visible_cols'

// Tree pane columns — a genuinely separate <table> from the timeline pane
// (below), not CSS-sticky columns inside one shared scroller. Sticky columns
// caused visible seam/overlap artefacts once both horizontal and vertical
// scroll were in play together (2026-07-07, per Maro); two real panes, only
// the right one horizontally scrollable, sidesteps that entirely — "the
// scroll should only accept the timeline." Activity ID/Name/Start/Finish are
// always shown; the rest are optional, toggled via the Columns menu, same
// visible-Set+localStorage pattern as the Activities tab's own.
type FixedColKey = 'code' | 'name' | 'start' | 'finish'
type OptionalColKey = 'duration' | 'pct_complete' | 'total_float' | 'role' | 'utilisation' | 'calendar'
type ColKey = FixedColKey | OptionalColKey

const FIXED_LEFT_COLS: { key: FixedColKey; label: string; width: number }[] = [
  { key: 'code', label: 'Activity ID', width: 90 },
  { key: 'name', label: 'Activity Name', width: 220 },
  { key: 'start', label: 'Start', width: 90 },
  { key: 'finish', label: 'Finish', width: 90 },
]
const OPTIONAL_COLUMNS: { key: OptionalColKey; label: string; width: number }[] = [
  { key: 'duration', label: 'Duration (d)', width: 80 },
  { key: 'pct_complete', label: '% Complete', width: 80 },
  { key: 'total_float', label: 'Total Float (d)', width: 90 },
  { key: 'role', label: 'Role', width: 100 },
  { key: 'utilisation', label: 'Utilisation %', width: 90 },
  { key: 'calendar', label: 'Calendar', width: 120 },
]
const PERIOD_COL_WIDTH = 64

function loadVisibleOptionalCols(): Set<OptionalColKey> {
  try {
    const raw = localStorage.getItem(VISIBLE_COLS_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as OptionalColKey[]) : new Set()
  } catch {
    return new Set()
  }
}

// P6-style Resource Usage Spreadsheet (2026-07-07, per Maro) — a left tree
// (resource -> its assigned activities) alongside a right spreadsheet whose
// columns are timeline periods and whose cells are that assignment's hours
// in that period, directly editable (manual resource leveling). Labour/
// Equipment only for now — Material/Subcontractor get their own spread mode
// later ("we'll see as it goes").
export function ResourceTrackingWidget({
  calendars, trackedResources, assignmentsByResource: baseAssignmentsByResource, buckets, spreadByResource, loading,
  onRefetchResource, unit, layoutPrefs, selectedResourceIds, onToggleResourceSelected,
  selectedActivityIds, onToggleActivitySelected, collapsedIds, onToggleCollapsed,
  onLeftPaneWidthChange, scrollLeft, onScrollLeftChange,
}: Props) {
  const [visibleOptionalCols, setVisibleOptionalCols] = useState<Set<OptionalColKey>>(loadVisibleOptionalCols)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const [sortKey, setSortKey] = useState<ColKey | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [editing, setEditing] = useState<{ assignmentId: string; bucketIndex: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [recalculatingIds, setRecalculatingIds] = useState<Set<string>>(new Set())

  const headerScrollRef = useRef<HTMLDivElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)
  // A dedicated strip below everything carries the one real, visible,
  // draggable scrollbar (2026-07-07, per Maro: "I want the scroll wheel at
  // the bottom") — offset to start exactly where the timeline pane does, so
  // it never sits under the tree pane. Header and body panes both stay
  // directly scrollable too (trackpad/shift-wheel), just with their own
  // native scrollbars hidden (`.rt-hide-scrollbar`, index.css) so neither
  // can visually reserve a different amount of space than the other and
  // throw rows out of alignment — the bug this whole three-way sync exists
  // to avoid. Setting scrollLeft to a value it already holds doesn't re-fire
  // `scroll`, so this can't loop within these three panes.
  const footerScrollRef = useRef<HTMLDivElement>(null)
  // Cross-widget sync (with Resource Usage Profile's own timeline, below)
  // can't rely on that same "already equal" guarantee — a value copied from
  // this widget's own scrollLeft can still land on a genuinely different
  // number over there (clamped to a different max scrollable width, or
  // sub-pixel rounding under a fractional display scale), which fires a
  // real 'scroll' event back here with a value that then looks "new" again,
  // and around it goes forever. Counting exactly how many scroll events our
  // own programmatic writes are about to cause, and swallowing exactly that
  // many, is immune to that regardless of what value the browser actually
  // lands on (2026-07-09 fix, per Maro: "the scroll failing going back and
  // forth perpetually").
  const pendingExternalSyncsRef = useRef(0)
  const syncFrom = (source: 'header' | 'body' | 'footer') => {
    if (pendingExternalSyncsRef.current > 0) { pendingExternalSyncsRef.current -= 1; return }
    const value = source === 'header' ? headerScrollRef.current?.scrollLeft
      : source === 'body' ? bodyScrollRef.current?.scrollLeft
      : footerScrollRef.current?.scrollLeft
    if (value === undefined) return
    if (headerScrollRef.current && source !== 'header') headerScrollRef.current.scrollLeft = value
    if (bodyScrollRef.current && source !== 'body') bodyScrollRef.current.scrollLeft = value
    if (footerScrollRef.current && source !== 'footer') footerScrollRef.current.scrollLeft = value
    onScrollLeftChange?.(value)
  }

  // Applies an externally-driven scroll position (from Resource Usage
  // Profile scrolling its own timeline) — pre-arms pendingExternalSyncsRef
  // with exactly how many of these three elements are actually about to
  // change, so their resulting 'scroll' events get swallowed instead of
  // re-propagating.
  useEffect(() => {
    if (scrollLeft === undefined) return
    for (const el of [headerScrollRef.current, bodyScrollRef.current, footerScrollRef.current]) {
      if (el && el.scrollLeft !== scrollLeft) { el.scrollLeft = scrollLeft; pendingExternalSyncsRef.current += 1 }
    }
  }, [scrollLeft])

  const sortValueFor = (row: AssignmentRow, key: ColKey): string | number => {
    switch (key) {
      case 'code': return row.activity.code
      case 'name': return row.activity.task_name
      case 'start': return row.activity.start ?? ''
      case 'finish': return row.activity.finish ?? ''
      case 'duration': return row.activity.duration_days !== null ? Number(row.activity.duration_days) : -Infinity
      case 'pct_complete': return row.activity.pct_complete !== null ? Number(row.activity.pct_complete) : -Infinity
      case 'total_float': return row.activity.total_float_hours !== null ? Number(row.activity.total_float_hours) : -Infinity
      case 'role': return row.assignment.role ?? ''
      case 'utilisation': return row.assignment.utilisation_pct !== null ? Number(row.assignment.utilisation_pct) : -Infinity
      case 'calendar': return calendars.find(c => c.id === row.activity.calendar_id)?.name ?? ''
    }
  }

  // Own sort applied on top of the shared base grouping (Profile just sums
  // the base as-is; Tracking additionally re-orders within each resource).
  const assignmentsByResource = useMemo(() => {
    if (!sortKey) return baseAssignmentsByResource
    const map = new Map<string, AssignmentRow[]>()
    for (const [resourceId, rows] of baseAssignmentsByResource) {
      const sorted = [...rows].sort((a, b) => {
        const av = sortValueFor(a, sortKey)
        const bv = sortValueFor(b, sortKey)
        const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
        return cmp * sortDir
      })
      map.set(resourceId, sorted)
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseAssignmentsByResource, sortKey, sortDir, calendars])

  // Days/Cost both divide through the *resource's own* max_hours_per_day —
  // not the activity's calendar — so the three units stay arithmetically
  // consistent with each other (e.g. "1.0 day" at this resource's day rate
  // always equals that day rate in Cost view) and with the spread's own
  // demand basis (resource.max_hours_per_day x utilisation%, 2026-07-08).
  // "obviously assuming cost per resources are populated" (2026-07-10, per
  // Maro) — rate defaults to 0 if never set, so Cost view just shows £0
  // rather than needing special "not populated" handling.
  const toDisplay = (hours: number, resource: Pick<Resource, 'max_hours_per_day' | 'rate'>): string => {
    if (unit === 'hours') return hours === 0 ? '' : hours.toFixed(1).replace(/\.0$/, '')
    const maxHoursPerDay = Number(resource.max_hours_per_day) || 8
    if (unit === 'days') {
      const days = hours / maxHoursPerDay
      return days === 0 ? '' : days.toFixed(1).replace(/\.0$/, '')
    }
    const cost = (hours / maxHoursPerDay) * Number(resource.rate)
    return cost === 0 ? '' : `£${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  }

  const bucketOverlapsSpan = (bucket: { start: Date; end: Date }, activity: AssignmentRow['activity']): boolean => {
    if (!activity.start || !activity.finish) return false
    return bucket.start < new Date(activity.finish) && bucket.end > new Date(activity.start)
  }

  const startEdit = (assignment: ResourceAssignment, bucketIndex: number, currentHours: number) => {
    setEditing({ assignmentId: assignment.id, bucketIndex })
    setEditValue(unit === 'hours' ? String(currentHours) : '')
  }

  const commitEdit = async (row: AssignmentRow, bucket: { start: Date; end: Date }) => {
    const raw = editValue.trim()
    setEditing(null)
    if (raw === '') return
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) return
    const resource = trackedResources.find(r => r.id === row.assignment.resource_id)
    const maxHoursPerDay = resource ? Number(resource.max_hours_per_day) || 8 : 8
    const rate = resource ? Number(resource.rate) : 0
    const hours = unit === 'hours' ? value
      : unit === 'days' ? value * maxHoursPerDay
      : rate > 0 ? (value / rate) * maxHoursPerDay : 0
    const periodEndInclusive = new Date(bucket.end)
    periodEndInclusive.setDate(periodEndInclusive.getDate() - 1)
    await saveSpreadRange(row.assignment.id, bucket.start, periodEndInclusive, hours)
    await onRefetchResource(row.assignment.resource_id)
  }

  const handleRecalculate = async (resource: Resource) => {
    const rows = assignmentsByResource.get(resource.id) ?? []
    if (rows.length === 0) return
    if (!(await confirmWithDontAsk(
      'scheduling.resource-tracking-recalculate',
      `Recalculate costs for every "${resource.name}" assignment from its current time-phased spread? This updates each assignment's utilisation % and re-syncs Cost Plan/EVM figures.`
    ))) return
    setRecalculatingIds(prev => new Set(prev).add(resource.id))
    try {
      for (const row of rows) {
        await recalculateCosts(row.assignment.id)
      }
      await onRefetchResource(resource.id)
    } finally {
      setRecalculatingIds(prev => {
        const next = new Set(prev)
        next.delete(resource.id)
        return next
      })
    }
  }

  const leftCols = useMemo(
    () => [...FIXED_LEFT_COLS, ...OPTIONAL_COLUMNS.filter(c => visibleOptionalCols.has(c.key))],
    [visibleOptionalCols]
  )
  const leftPaneWidth = useMemo(() => leftCols.reduce((sum, c) => sum + c.width, 0), [leftCols])

  useEffect(() => {
    onLeftPaneWidthChange?.(leftPaneWidth + 26 + RESOURCE_CHART_Y_AXIS_WIDTH)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPaneWidth])

  const toggleOptionalColumn = (key: OptionalColKey) => {
    setVisibleOptionalCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(VISIBLE_COLS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  const handleSortClick = (key: ColKey) => {
    if (sortKey !== key) { setSortKey(key); setSortDir(1); return }
    if (sortDir === 1) { setSortDir(-1); return }
    setSortKey(null)
  }

  const sortIndicator = (key: ColKey) => sortKey === key ? (sortDir === 1 ? ' ▲' : ' ▼') : ''

  const renderOptionalCell = (key: OptionalColKey, row: AssignmentRow) => {
    switch (key) {
      case 'duration': return row.activity.duration_days ?? '—'
      case 'pct_complete': return row.activity.pct_complete !== null ? `${row.activity.pct_complete}%` : '—'
      case 'total_float': return row.activity.total_float_hours !== null
        ? Math.round(Number(row.activity.total_float_hours) / resolveHoursPerDay(row.activity, calendars))
        : '—'
      case 'role': return row.assignment.role ?? '—'
      case 'utilisation': return row.assignment.utilisation_pct !== null ? `${row.assignment.utilisation_pct}%` : '—'
      case 'calendar': return calendars.find(c => c.id === row.activity.calendar_id)?.name ?? '—'
    }
  }

  if (trackedResources.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4 no-print">
        <div className="font-bold text-sm mb-1">Resource Tracking</div>
        <div className="text-xs text-gray-400">
          No Labour/Equipment resources with assignments yet — assign one to an activity via Logic to see it here.
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4 no-print">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="font-bold text-sm">Resource Tracking</div>
        <div className="text-xs text-gray-400">Hours per period, per activity — double-click a cell to level it manually</div>
        <div className="relative ml-auto">
          <button
            onClick={() => setColumnsMenuOpen(o => !o)}
            className={`text-xs px-2 py-1 rounded border ${columnsMenuOpen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`}
          >
            ☰ Columns
          </button>
          {columnsMenuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded shadow-lg p-2 z-30 text-xs w-44">
              {OPTIONAL_COLUMNS.map(c => (
                <label key={c.key} className="flex items-center gap-1.5 py-0.5 text-gray-600">
                  <input type="checkbox" checked={visibleOptionalCols.has(c.key)} onChange={() => toggleOptionalColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400 p-4">Loading resource tracking…</div>
      ) : (
        <div className="border border-gray-200 rounded overflow-hidden text-xs">
          {/* Header row — tree-pane labels (fixed) + period labels (horizontally
              synced with the body's own scroll, never independently scrollable). */}
          <div className="flex bg-gray-50 border-b border-gray-200">
            <table style={{ width: leftPaneWidth + 26 + RESOURCE_CHART_Y_AXIS_WIDTH, tableLayout: 'fixed' }} className="border-collapse flex-shrink-0">
              <colgroup>
                <col style={{ width: 26 }} />{leftCols.map((c, i) => <col key={i} style={{ width: c.width }} />)}
                <col style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH }} />
              </colgroup>
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="border-r border-gray-200" />
                  {leftCols.map(c => (
                    <th
                      key={c.key}
                      onClick={() => handleSortClick(c.key)}
                      title="Click to sort"
                      className="px-2 py-1.5 border-r border-gray-200 cursor-pointer select-none hover:bg-gray-100"
                    >
                      {c.label}{sortIndicator(c.key)}
                    </th>
                  ))}
                  {/* Blank — matches Resource Usage Profile's y-axis gutter in the
                      same spot, so both tables' period columns line up. */}
                  <th className="border-r border-gray-200" />
                </tr>
              </thead>
            </table>
            <div ref={headerScrollRef} onScroll={() => syncFrom('header')} className="flex-1 rt-hide-scrollbar" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
              <table style={{ width: buckets.length * PERIOD_COL_WIDTH, tableLayout: 'fixed' }} className="border-collapse">
                <colgroup>{buckets.map((_, i) => <col key={i} style={{ width: PERIOD_COL_WIDTH }} />)}</colgroup>
                <thead>
                  <tr className="text-left text-gray-500">
                    {buckets.map((b, i) => (
                      <th key={i} className="px-2 py-1.5 border-r border-gray-200 text-right">{b.label}</th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>

          {/* Body — tree pane (natural height, no scroll of its own) + timeline
              pane (the ONLY horizontally-scrollable region — "the scroll should
              only accept the timeline," 2026-07-07 per Maro). Both panes sit
              inside one shared vertical scroller so they still move together
              top-to-bottom. */}
          <div className="flex" style={{ maxHeight: 500, overflowY: 'auto', fontFamily: FONT_FAMILY_CSS[layoutPrefs.fontFamily], fontSize: layoutPrefs.fontSize }}>
            <table style={{ width: leftPaneWidth + 26 + RESOURCE_CHART_Y_AXIS_WIDTH, tableLayout: 'fixed' }} className="border-collapse flex-shrink-0">
              <colgroup>
                <col style={{ width: 26 }} />{leftCols.map((c, i) => <col key={i} style={{ width: c.width }} />)}
                <col style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH }} />
              </colgroup>
              <tbody>
                {trackedResources.map(resource => {
                  const rows = assignmentsByResource.get(resource.id) ?? []
                  const collapsed = collapsedIds.has(resource.id)
                  const resourceStart = rows.length ? rows.reduce((min, r) => !min || (r.activity.start ?? '') < min ? r.activity.start : min, rows[0].activity.start) : null
                  const resourceFinish = rows.length ? rows.reduce((max, r) => !max || (r.activity.finish ?? '') > max ? r.activity.finish : max, rows[0].activity.finish) : null
                  return (
                    <Fragment key={resource.id}>
                      <tr className="text-white font-semibold" style={{ height: 30, backgroundColor: layoutPrefs.headerColor }}>
                        <td className="px-1.5" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
                          <input type="checkbox" checked={selectedResourceIds.has(resource.id)} onChange={() => onToggleResourceSelected(resource.id)} />
                        </td>
                        <td className="px-2 py-1.5" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
                          <button onClick={() => onToggleCollapsed(resource.id)} className="mr-1 text-white/80 hover:text-white">
                            {collapsed ? '▸' : '▾'}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 truncate" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
                          {resource.name}
                          <button
                            onClick={() => handleRecalculate(resource)}
                            disabled={recalculatingIds.has(resource.id)}
                            title="Recalculate costs for every assignment of this resource from its current time-phased spread"
                            className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/20 hover:bg-white/30 disabled:opacity-50"
                          >
                            {recalculatingIds.has(resource.id) ? '…' : '🔄'}
                          </button>
                        </td>
                        <td className="px-2 py-1.5" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>{formatDateTime(resourceStart, false)}</td>
                        <td className="px-2 py-1.5" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>{formatDateTime(resourceFinish, false)}</td>
                        {OPTIONAL_COLUMNS.filter(c => visibleOptionalCols.has(c.key)).map(c => (
                          <td key={c.key} className="px-2 py-1.5" style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}>—</td>
                        ))}
                        <td style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }} />
                      </tr>
                      {!collapsed && rows.map(row => (
                        <tr key={row.assignment.id} className="hover:bg-gray-50" style={{ height: 26 }}>
                          <td className="px-1.5 border-r border-gray-200">
                            <input type="checkbox" checked={selectedActivityIds.has(row.activity.id)} onChange={() => onToggleActivitySelected(row.activity.id)} />
                          </td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500 font-mono">{row.activity.code}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-700 truncate">{row.activity.task_name}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500">{formatDateTime(row.activity.start, false)}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500">{formatDateTime(row.activity.finish, false)}</td>
                          {OPTIONAL_COLUMNS.filter(c => visibleOptionalCols.has(c.key)).map(c => (
                            <td key={c.key} className="px-2 py-1 border-r border-gray-200 text-gray-500">{renderOptionalCell(c.key, row)}</td>
                          ))}
                          <td className="border-r border-gray-200" />
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>

            <div ref={bodyScrollRef} onScroll={() => syncFrom('body')} className="flex-1 rt-hide-scrollbar" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
              <table style={{ width: buckets.length * PERIOD_COL_WIDTH, tableLayout: 'fixed' }} className="border-collapse">
                <colgroup>{buckets.map((_, i) => <col key={i} style={{ width: PERIOD_COL_WIDTH }} />)}</colgroup>
                <tbody>
                  {trackedResources.map(resource => {
                    const rows = assignmentsByResource.get(resource.id) ?? []
                    const spread = spreadByResource.get(resource.id)
                    const { hoursByAssignmentDate, capacityByDate } = indexSpread(spread)
                    const collapsed = collapsedIds.has(resource.id)
                    return (
                      <Fragment key={resource.id}>
                        <tr className="text-white font-semibold" style={{ height: 30, backgroundColor: layoutPrefs.headerColor }}>
                          {buckets.map((bucket, i) => {
                            let demand = 0
                            let capacity = 0
                            for (const d of eachDate(bucket.start, bucket.end)) {
                              capacity += capacityByDate.get(d) ?? 0
                              for (const row of rows) {
                                demand += hoursByAssignmentDate.get(`${row.assignment.id}:${d}`)?.hours ?? 0
                              }
                            }
                            const overallocated = demand > capacity && capacity > 0
                            return (
                              <td
                                key={i}
                                style={{ borderRight: `1px solid ${layoutPrefs.headerColor}` }}
                                className={`px-2 py-1.5 text-right ${overallocated ? 'text-red-300 font-bold' : ''}`}
                              >
                                {toDisplay(demand, resource)}
                              </td>
                            )
                          })}
                        </tr>
                        {!collapsed && rows.map(row => (
                          <tr key={row.assignment.id} className="hover:bg-gray-50" style={{ height: 26 }}>
                            {buckets.map((bucket, i) => {
                              const active = bucketOverlapsSpan(bucket, row.activity)
                              if (!active) {
                                return <td key={i} className="px-2 py-1 border-r border-gray-200 bg-gray-50" />
                              }
                              let hours = 0
                              for (const d of eachDate(bucket.start, bucket.end)) {
                                hours += hoursByAssignmentDate.get(`${row.assignment.id}:${d}`)?.hours ?? 0
                              }
                              const isEditing = editing?.assignmentId === row.assignment.id && editing.bucketIndex === i
                              if (isEditing) {
                                return (
                                  <td key={i} className="px-1 py-0.5 border-r border-gray-200">
                                    <input
                                      autoFocus
                                      type="number" min={0} step={0.5}
                                      value={editValue}
                                      onChange={e => setEditValue(e.target.value)}
                                      onBlur={() => commitEdit(row, bucket)}
                                      onKeyDown={e => {
                                        if (e.key === 'Enter') commitEdit(row, bucket)
                                        if (e.key === 'Escape') setEditing(null)
                                      }}
                                      className="w-14 border border-blue-400 rounded px-1 py-0.5 text-xs text-right"
                                    />
                                  </td>
                                )
                              }
                              return (
                                <td
                                  key={i}
                                  onDoubleClick={() => startEdit(row.assignment, i, hours)}
                                  title="Double-click to edit — manual resource leveling"
                                  className="px-2 py-1 border-r border-gray-200 text-right text-gray-600 cursor-pointer hover:bg-blue-50"
                                >
                                  {toDisplay(hours, resource)}
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* The one visible, draggable scrollbar (2026-07-07, per Maro: "I
              want the scroll wheel at the bottom") — offset to start exactly
              where the timeline pane does, purely a scroll control (1px-tall
              dummy content matching the real table width), synced with the
              header/body panes above via syncFrom. */}
          <div className="flex border-t border-gray-200">
            <div style={{ width: leftPaneWidth + 26 + RESOURCE_CHART_Y_AXIS_WIDTH, flexShrink: 0 }} />
            <div ref={footerScrollRef} onScroll={() => syncFrom('footer')} className="flex-1" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
              <div style={{ width: buckets.length * PERIOD_COL_WIDTH, height: 14 }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
