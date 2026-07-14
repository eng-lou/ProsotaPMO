import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import { recalculateCosts, saveSpreadRange, type ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { formatDateTime } from './dateTime'
import { resolveHoursPerDay } from './durationDisplay'
import { RESOURCE_CHART_Y_AXIS_WIDTH, type ResourcesLayoutPrefs } from './resourcesLayout'
import { eachDate, type AssignmentRow } from './useResourcesTabData'
import type { Calendar, Resource, ResourceAssignment } from './types'

interface Props {
  calendars: Calendar[]
  trackedResources: Resource[]
  assignmentsByResource: Map<string, AssignmentRow[]>
  buckets: { start: Date; end: Date; label: string }[]
  spreadByResource: Map<string, ResourceSpread>
  loading: boolean
  // Set when Promise.allSettled found at least one resource's spread fetch
  // failed (2026-07-13 fix, per Maro: "some resources are still not
  // showing" — previously a single failed request silently blanked every
  // resource's numbers with no visible error at all; see
  // useResourcesTabData.ts's own header on the Promise.all -> allSettled
  // fix). Surfaced here rather than swallowed, matching this app's
  // established "never silently eat a real error" rule.
  spreadFetchError: string | null
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
  // Usage Profile's (2026-07-09, per Maro: "align the dividers"). Optional
  // so this widget still works standalone.
  //
  // Timeline scroll position used to be mirrored both ways with Resource
  // Usage Profile too, but that cross-widget sync (scrollLeft/
  // onScrollLeftChange) turned out to interact badly with this widget's
  // own column virtualization in ways that were never fully run down —
  // Profile's own scroll position would silently fail to apply from an
  // externally-synced value despite the prop carrying a real, correct
  // number (2026-07-14, per Maro: "just make both independent at this
  // point," after several rounds of chasing it). Each timeline now scrolls
  // on its own; only the divider position still lines up.
  onLeftPaneWidthChange?: (width: number) => void
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
  spreadFetchError, onRefetchResource, unit, layoutPrefs, selectedResourceIds, onToggleResourceSelected,
  selectedActivityIds, onToggleActivitySelected, collapsedIds, onToggleCollapsed,
  onLeftPaneWidthChange,
}: Props) {
  const [visibleOptionalCols, setVisibleOptionalCols] = useState<Set<OptionalColKey>>(loadVisibleOptionalCols)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)
  const [sortKey, setSortKey] = useState<ColKey | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const [editing, setEditing] = useState<{ assignmentId: string; bucketIndex: number } | null>(null)
  const [editValue, setEditValue] = useState('')
  const [recalculatingIds, setRecalculatingIds] = useState<Set<string>>(new Set())

  // 2026-07-14 rewrite, per Maro (after the tree/timeline two-table design
  // proved fundamentally fragile — row heights drifted out of sync between
  // the two separate <table> elements as more resources/child rows were
  // added, silently shifting a resource's real numbers onto the wrong
  // visual row; multiple CSS patches to pin row heights did not fix it).
  // Rebuilt as ONE table: tree columns and timeline columns are cells in
  // the *same* <tr>, so there is no second table that can ever drift out
  // of alignment — correctness by construction, not by keeping two things
  // in sync. Tree columns use position:sticky (left) to stay frozen while
  // the timeline scrolls; the header row is sticky (top) the same way.
  // Sticky columns were tried once before this session (2026-07-07) and
  // caused visible seam/overlap artefacts — that's *why* the two-table
  // design existed at all. Avoiding those known causes this time:
  // border-collapse:separate (not collapse — collapsed borders are the
  // classic trigger for sticky-cell seam bugs in Chrome), an explicit
  // solid background on every sticky cell (no reliance on inherited/
  // transparent backgrounds letting scrolled content bleed through), and
  // deliberate z-index layering (sticky-left body cells > timeline cells;
  // sticky-top header cells above those; the sticky-top+sticky-left corner
  // cells highest of all, since they overlap both axes).
  const mainScrollRef = useRef<HTMLDivElement>(null)
  // A dedicated strip below everything carries the one real, visible,
  // draggable scrollbar (2026-07-07, per Maro: "I want the scroll wheel at
  // the bottom") — still needed even with one unified table, since a tall
  // resource list would otherwise put the table's own horizontal scrollbar
  // far below the fold.
  const footerScrollRef = useRef<HTMLDivElement>(null)
  // Cross-widget sync (with Resource Usage Profile's own timeline, below)
  // can't rely on a simple "already equal" guarantee — a value copied from
  // this widget's own scrollLeft can still land on a genuinely different
  // number over there (clamped to a different max scrollable width, or
  // sub-pixel rounding under a fractional display scale), which fires a
  // real 'scroll' event back here with a value that then looks "new" again,
  // and around it goes forever. Counting exactly how many scroll events our
  // own programmatic writes are about to cause, and swallowing exactly that
  // many, is immune to that regardless of what value the browser actually
  // lands on (2026-07-09 fix, per Maro: "the scroll failing going back and
  // forth perpetually").
  // Local sync only — mainScrollRef's own horizontal position mirrored to
  // the dedicated bottom scrollbar strip and back, nothing cross-widget
  // (see this component's own Props.onLeftPaneWidthChange header comment).
  // No guard needed here: setting scrollLeft to a value it already holds
  // doesn't re-fire a native 'scroll' event, so mirroring main->footer
  // and footer->main can't loop.
  const syncFrom = (source: 'main' | 'footer') => {
    const value = source === 'main' ? mainScrollRef.current?.scrollLeft : footerScrollRef.current?.scrollLeft
    if (value === undefined) return
    if (mainScrollRef.current && source !== 'main') mainScrollRef.current.scrollLeft = value
    if (footerScrollRef.current && source !== 'footer') footerScrollRef.current.scrollLeft = value
  }

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

  // Date-string -> bucket-index, built once per bucket-set change and shared
  // across every resource (2026-07-14 perf fix #2, per Maro: the first perf
  // fix below stopped scroll events from re-triggering this work, but didn't
  // reduce the work itself — at this project's real scale (25 resources,
  // some with 10k+ day-cells over a 3.5-year range), the original approach
  // called eachDate() separately *per bucket per resource* (25x more
  // allocation than necessary) and did a template-literal-keyed Map lookup
  // for *every (day, row) pair*, not just the ones with real data. That's
  // slow enough that a fresh fetch landing (spreadByResource changing) could
  // leave the table visibly blank/stale for long enough to screenshot before
  // the recompute finished and painted — checking a single resource looked
  // "fixed" only because 1-resource's-worth of this work is fast, not
  // because the many-resource case was actually broken data-wise (confirmed
  // via console logging: every resource's fetch returns real, nonzero
  // cells). Building this lookup once, and then making a single pass over
  // each resource's own already-known cells/days below instead of walking
  // every calendar day and testing every row against it, cuts the work from
  // O(resources x buckets x days x rows) to O(resources x cells).
  const bucketIndexByDate = useMemo(() => {
    const map = new Map<string, number>()
    buckets.forEach((bucket, i) => {
      for (const d of eachDate(bucket.start, bucket.end)) map.set(d, i)
    })
    return map
  }, [buckets])

  const bucketData = useMemo(() => {
    const demandCapacityByResource = new Map<string, { demand: number[]; capacity: number[] }>()
    const hoursByAssignment = new Map<string, number[]>()
    for (const resource of trackedResources) {
      const rows = assignmentsByResource.get(resource.id) ?? []
      const spread = spreadByResource.get(resource.id)
      const demand = new Array(buckets.length).fill(0)
      const capacity = new Array(buckets.length).fill(0)
      const rowHours = new Map<string, number[]>()
      for (const row of rows) rowHours.set(row.assignment.id, new Array(buckets.length).fill(0))
      if (spread) {
        for (const day of spread.days) {
          const i = bucketIndexByDate.get(day.date)
          if (i !== undefined) capacity[i] += Number(day.capacity)
        }
        for (const cell of spread.cells) {
          const i = bucketIndexByDate.get(cell.date)
          if (i === undefined) continue
          const hours = Number(cell.hours)
          demand[i] += hours
          const arr = rowHours.get(cell.assignment_id)
          if (arr) arr[i] += hours
        }
      }
      demandCapacityByResource.set(resource.id, { demand, capacity })
      for (const [assignmentId, arr] of rowHours) hoursByAssignment.set(assignmentId, arr)
    }
    return { demandCapacityByResource, hoursByAssignment }
  }, [trackedResources, assignmentsByResource, buckets, spreadByResource, bucketIndexByDate])

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

  // Cumulative left-offset (px) for each sticky tree column, in render
  // order: checkbox, each leftCol, the trailing gutter — leftOffsets[i] is
  // where the i-th sticky column's own `left` should land so it sits
  // immediately after the one before it, with no gap or overlap.
  const leftOffsets = useMemo(() => {
    const widths = [26, ...leftCols.map(c => c.width), RESOURCE_CHART_Y_AXIS_WIDTH]
    const offsets: number[] = []
    let cumulative = 0
    for (const w of widths) {
      offsets.push(cumulative)
      cumulative += w
    }
    return offsets
  }, [leftCols])

  // Column virtualization (2026-07-14, per Maro: "lagging when i switch
  // intervals year to week etc") — switching from a year zoom (~4 buckets)
  // to week (~180 buckets over a multi-year project) or day (~1,275
  // buckets) previously rendered every single one of those as a real <td>
  // in every row (header + every child activity row), for every tracked
  // resource — tens to hundreds of thousands of DOM cells. Only the
  // buckets actually visible in the horizontal scroll viewport (plus a
  // buffer on each side, so fast scrolling doesn't show a blank flash
  // before the next window renders) are real cells now; everything else
  // collapses into two spacer cells whose width covers exactly the skipped
  // buckets, so the table's total scrollable width — and every other
  // widget synced to this one's scrollLeft — is completely unaffected.
  // 30, not the original 10 — widened alongside switching from a per-frame
  // throttle to a debounce below, so the fixed window an active scroll
  // rides on covers a real scroll distance before hitting its edge.
  const BUCKET_BUFFER = 30
  // Capped, not buckets.length — the real viewport-measured window (below)
  // corrects this before the browser ever paints (useLayoutEffect, not
  // useEffect), but the *initial* state has no ref to measure from yet, and
  // this app has already been bitten once today by "briefly renders the
  // full un-windowed thing before a later pass fixes it" (see
  // useResourcesTabData.ts's own spreadByResource merge-fix header) — this
  // sidesteps that same class of problem by never having a full-bucket
  // initial state to begin with, at day zoom or otherwise.
  const [visibleBucketRange, setVisibleBucketRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(buckets.length, 40) })

  const recomputeVisibleBucketRange = () => {
    const el = mainScrollRef.current
    if (!el) return
    const treeWidth = leftOffsets[leftOffsets.length - 1] + RESOURCE_CHART_Y_AXIS_WIDTH
    const firstVisible = Math.floor(el.scrollLeft / PERIOD_COL_WIDTH)
    const lastVisible = Math.ceil((el.scrollLeft + el.clientWidth - treeWidth) / PERIOD_COL_WIDTH)
    const start = Math.max(0, firstVisible - BUCKET_BUFFER)
    const end = Math.min(buckets.length, lastVisible + BUCKET_BUFFER)
    setVisibleBucketRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  // Recompute whenever the bucket set itself changes (a zoom switch swaps
  // in a whole new bucket array at a scroll position that's likely no
  // longer valid for it) and once on mount — useLayoutEffect, not useEffect,
  // so this runs and corrects the window *before* the browser paints,
  // rather than painting the (possibly huge) capped-guess window first and
  // visibly snapping to the real one a frame later.
  useLayoutEffect(() => {
    recomputeVisibleBucketRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets, leftOffsets])

  // Debounced, not per-frame throttled — an earlier version recomputed on
  // every animation frame during an active scroll (up to ~60/sec), which
  // meant React re-rendered and reconciled the whole ~150-row table that
  // often *while the user was actively dragging the scrollbar*, competing
  // with the browser's own scroll handling and making the scroll itself
  // feel unresponsive (2026-07-14, per Maro: "scrolls are unresponsive").
  // The window now stays fixed for the whole duration of an active scroll
  // (riding on the wider BUCKET_BUFFER above) and only actually recomputes
  // once scrolling pauses for a moment — the browser's native scroll stays
  // completely free of React re-renders while it's actually moving.
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleMainScroll = () => {
    syncFrom('main')
    if (scrollDebounceRef.current !== null) clearTimeout(scrollDebounceRef.current)
    scrollDebounceRef.current = setTimeout(() => {
      scrollDebounceRef.current = null
      recomputeVisibleBucketRange()
    }, 150)
  }

  useEffect(() => {
    window.addEventListener('resize', recomputeVisibleBucketRange)
    return () => window.removeEventListener('resize', recomputeVisibleBucketRange)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visibleBucketIndices = useMemo(
    () => Array.from({ length: Math.max(0, visibleBucketRange.end - visibleBucketRange.start) }, (_, k) => visibleBucketRange.start + k),
    [visibleBucketRange]
  )
  const leadingSpacerWidth = visibleBucketRange.start * PERIOD_COL_WIDTH
  const trailingSpacerWidth = Math.max(0, buckets.length - visibleBucketRange.end) * PERIOD_COL_WIDTH

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
        {spreadFetchError && <div className="text-xs text-red-600">{spreadFetchError}</div>}
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
          {/* One table, tree columns + timeline columns as cells of the same
              <tr> — see this function's own header comment for why (replaced
              a two-table design that drifted out of vertical alignment).
              Tree columns are position:sticky (left) so they stay frozen
              while only the timeline portion visually scrolls; the header
              row is sticky (top) the same way. */}
          <div
            ref={mainScrollRef}
            onScroll={handleMainScroll}
            className="rt-hide-scrollbar"
            style={{
              maxHeight: 500, overflow: 'auto',
              fontFamily: FONT_FAMILY_CSS[layoutPrefs.fontFamily], fontSize: layoutPrefs.fontSize,
            }}
          >
            <table
              style={{
                width: leftPaneWidth + 26 + RESOURCE_CHART_Y_AXIS_WIDTH + buckets.length * PERIOD_COL_WIDTH,
                tableLayout: 'fixed', borderCollapse: 'separate', borderSpacing: 0,
              }}
            >
              <colgroup>
                <col style={{ width: 26 }} />
                {leftCols.map((c, i) => <col key={i} style={{ width: c.width }} />)}
                <col style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH }} />
                {leadingSpacerWidth > 0 && <col style={{ width: leadingSpacerWidth }} />}
                {visibleBucketIndices.map(i => <col key={`b${i}`} style={{ width: PERIOD_COL_WIDTH }} />)}
                {trailingSpacerWidth > 0 && <col style={{ width: trailingSpacerWidth }} />}
              </colgroup>
              <thead>
                <tr className="text-left text-gray-500">
                  <th style={{ position: 'sticky', top: 0, left: leftOffsets[0], zIndex: 3, background: '#f9fafb' }} className="border-r border-b border-gray-200" />
                  {leftCols.map((c, i) => (
                    <th
                      key={c.key}
                      onClick={() => handleSortClick(c.key)}
                      title="Click to sort"
                      style={{ position: 'sticky', top: 0, left: leftOffsets[i + 1], zIndex: 3, background: '#f9fafb' }}
                      className="px-2 py-1.5 border-r border-b border-gray-200 cursor-pointer select-none hover:bg-gray-100"
                    >
                      {c.label}{sortIndicator(c.key)}
                    </th>
                  ))}
                  {/* Blank — matches Resource Usage Profile's y-axis gutter in the
                      same spot, so both tables' period columns line up. */}
                  <th style={{ position: 'sticky', top: 0, left: leftOffsets[leftOffsets.length - 1], zIndex: 3, background: '#f9fafb' }} className="border-r border-b border-gray-200" />
                  {/* Column virtualization spacers — see this component's own
                      recomputeVisibleBucketRange header comment. A single
                      cell each, widths taken straight from the matching
                      <col> above, standing in for every skipped bucket so
                      the table's total scrollable width never changes. */}
                  {leadingSpacerWidth > 0 && <th className="border-r border-b border-gray-200" />}
                  {visibleBucketIndices.map(i => (
                    <th key={i} style={{ position: 'sticky', top: 0, zIndex: 2, background: '#f9fafb' }} className="px-2 py-1.5 border-r border-b border-gray-200 text-right">{buckets[i].label}</th>
                  ))}
                  {trailingSpacerWidth > 0 && <th className="border-r border-b border-gray-200" />}
                </tr>
              </thead>
              <tbody>
                {trackedResources.map(resource => {
                  const rows = assignmentsByResource.get(resource.id) ?? []
                  const collapsed = collapsedIds.has(resource.id)
                  const resourceStart = rows.length ? rows.reduce((min, r) => !min || (r.activity.start ?? '') < min ? r.activity.start : min, rows[0].activity.start) : null
                  const resourceFinish = rows.length ? rows.reduce((max, r) => !max || (r.activity.finish ?? '') > max ? r.activity.finish : max, rows[0].activity.finish) : null
                  const resourceBuckets = bucketData.demandCapacityByResource.get(resource.id)
                  return (
                    <Fragment key={resource.id}>
                      <tr className="text-white font-semibold" style={{ height: 30, backgroundColor: layoutPrefs.headerColor }}>
                        <td className="px-1.5" style={{ position: 'sticky', left: leftOffsets[0], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
                          <input type="checkbox" checked={selectedResourceIds.has(resource.id)} onChange={() => onToggleResourceSelected(resource.id)} />
                        </td>
                        <td className="px-2 py-1.5" style={{ position: 'sticky', left: leftOffsets[1], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
                          <button onClick={() => onToggleCollapsed(resource.id)} className="mr-1 text-white/80 hover:text-white">
                            {collapsed ? '▸' : '▾'}
                          </button>
                        </td>
                        <td className="px-2 py-1.5 truncate" style={{ position: 'sticky', left: leftOffsets[2], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>
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
                        <td className="px-2 py-1.5" style={{ position: 'sticky', left: leftOffsets[3], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>{formatDateTime(resourceStart, false)}</td>
                        <td className="px-2 py-1.5" style={{ position: 'sticky', left: leftOffsets[4], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>{formatDateTime(resourceFinish, false)}</td>
                        {OPTIONAL_COLUMNS.filter(c => visibleOptionalCols.has(c.key)).map((c, i) => (
                          <td key={c.key} className="px-2 py-1.5" style={{ position: 'sticky', left: leftOffsets[5 + i], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }}>—</td>
                        ))}
                        <td style={{ position: 'sticky', left: leftOffsets[leftOffsets.length - 1], zIndex: 1, height: 30, overflow: 'hidden', backgroundColor: layoutPrefs.headerColor, borderRight: `1px solid ${layoutPrefs.headerColor}` }} />
                        {leadingSpacerWidth > 0 && <td style={{ height: 30, overflow: 'hidden' }} />}
                        {visibleBucketIndices.map(i => {
                          const demand = resourceBuckets?.demand[i] ?? 0
                          const capacity = resourceBuckets?.capacity[i] ?? 0
                          const overallocated = demand > capacity && capacity > 0
                          return (
                            <td
                              key={i}
                              style={{ height: 30, overflow: 'hidden', borderRight: `1px solid ${layoutPrefs.headerColor}` }}
                              className={`px-2 py-1.5 text-right ${overallocated ? 'text-red-300 font-bold' : ''}`}
                            >
                              {toDisplay(demand, resource)}
                            </td>
                          )
                        })}
                        {trailingSpacerWidth > 0 && <td style={{ height: 30, overflow: 'hidden' }} />}
                      </tr>
                      {!collapsed && rows.map(row => (
                        <tr key={row.assignment.id} style={{ height: 26 }}>
                          <td className="px-1.5 border-r border-gray-200" style={{ position: 'sticky', left: leftOffsets[0], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>
                            <input type="checkbox" checked={selectedActivityIds.has(row.activity.id)} onChange={() => onToggleActivitySelected(row.activity.id)} />
                          </td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500 font-mono" style={{ position: 'sticky', left: leftOffsets[1], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>{row.activity.code}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-700 truncate" style={{ position: 'sticky', left: leftOffsets[2], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>{row.activity.task_name}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500" style={{ position: 'sticky', left: leftOffsets[3], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>{formatDateTime(row.activity.start, false)}</td>
                          <td className="px-2 py-1 border-r border-gray-200 text-gray-500" style={{ position: 'sticky', left: leftOffsets[4], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>{formatDateTime(row.activity.finish, false)}</td>
                          {OPTIONAL_COLUMNS.filter(c => visibleOptionalCols.has(c.key)).map((c, i) => (
                            <td key={c.key} className="px-2 py-1 border-r border-gray-200 text-gray-500" style={{ position: 'sticky', left: leftOffsets[5 + i], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }}>{renderOptionalCell(c.key, row)}</td>
                          ))}
                          <td className="border-r border-gray-200" style={{ position: 'sticky', left: leftOffsets[leftOffsets.length - 1], zIndex: 1, height: 26, overflow: 'hidden', backgroundColor: 'white' }} />
                          {leadingSpacerWidth > 0 && <td style={{ height: 26, overflow: 'hidden' }} />}
                          {visibleBucketIndices.map(i => {
                            const bucket = buckets[i]
                            const active = bucketOverlapsSpan(bucket, row.activity)
                            if (!active) {
                              return <td key={i} className="px-2 py-1 border-r border-gray-200 bg-gray-50" style={{ height: 26, overflow: 'hidden' }} />
                            }
                            const hours = bucketData.hoursByAssignment.get(row.assignment.id)?.[i] ?? 0
                            const isEditing = editing?.assignmentId === row.assignment.id && editing.bucketIndex === i
                            if (isEditing) {
                              return (
                                <td key={i} className="px-1 py-0.5 border-r border-gray-200" style={{ height: 26, overflow: 'hidden' }}>
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
                                style={{ height: 26, overflow: 'hidden' }}
                              >
                                {toDisplay(hours, resource)}
                              </td>
                            )
                          })}
                          {trailingSpacerWidth > 0 && <td style={{ height: 26, overflow: 'hidden' }} />}
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* The one visible, draggable scrollbar (2026-07-07, per Maro: "I
              want the scroll wheel at the bottom") — offset to start exactly
              where the timeline columns do, purely a scroll control (1px-tall
              dummy content matching the real table width), synced with the
              main table above via syncFrom. */}
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
