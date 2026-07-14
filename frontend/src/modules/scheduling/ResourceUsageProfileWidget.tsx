import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FONT_FAMILY_CSS } from '@/lib/ganttLayout'
import type { ResourceSpread } from '@/lib/resourceAssignmentSpread'
import { RESOURCE_CHART_Y_AXIS_WIDTH, type ResourcesLayoutPrefs } from './resourcesLayout'
import { computeUsageProfileBars, type AssignmentRow } from './useResourcesTabData'
import type { Calendar, Resource } from './types'

interface Props {
  calendars: Calendar[]
  trackedResources: Resource[]
  assignmentsByResource: Map<string, AssignmentRow[]>
  buckets: { start: Date; end: Date; label: string }[]
  spreadByResource: Map<string, ResourceSpread>
  loading: boolean
  layoutPrefs: ResourcesLayoutPrefs
  // Hours/Days/Cost (2026-07-10, per Maro) — same shared toggle Resource
  // Tracking already had; Profile previously ignored it entirely and always
  // showed hours.
  unit: 'hours' | 'days' | 'cost'
  selectedResourceIds: Set<string>
  onToggleResourceSelected: (id: string) => void
  selectedActivityIds: Set<string>
  // Mirrors Resource Tracking's own tree/timeline divider position
  // (2026-07-09, per Maro) — see the matching prop on ResourceTrackingWidget.
  // Timeline scroll used to be mirrored both ways too; see that widget's
  // own Props header comment for why that was dropped (2026-07-14, per
  // Maro: "just make both independent at this point") — this chart now
  // scrolls entirely on its own.
  leftPaneWidth: number
}

const VISIBLE_COLS_STORAGE_KEY = 'prosota_resource_usage_profile_visible_cols'

type OptionalColKey = 'role' | 'utilisation' | 'calendar' | 'default_units'
const OPTIONAL_COLUMNS: { key: OptionalColKey; label: string }[] = [
  { key: 'role', label: 'Role' },
  { key: 'utilisation', label: 'Utilisation' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'default_units', label: 'Default Units/Time' },
]

function loadVisibleCols(): Set<OptionalColKey> {
  try {
    const raw = localStorage.getItem(VISIBLE_COLS_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as OptionalColKey[]) : new Set(['role', 'utilisation', 'calendar', 'default_units'])
  } catch {
    return new Set(['role', 'utilisation', 'calendar', 'default_units'])
  }
}

const PERIOD_COL_WIDTH = 64
const CHART_HEIGHT_MIN = 180

export const RESOURCE_USAGE_COLORS = { budgeted: '#eab308', actual: '#22c55e', overallocated: '#ef4444', limit: '#111827' }

// P6's own "Resource Usage Profile" — the resource histogram (Rita Mulcahy
// PMP Exam Prep 11th ed., Ch.6 "Resource Histograms": "a bar chart
// illustrating the number of resources needed per time period... allows a
// project manager to easily see where there is a spike"), 2026-07-07 per
// Maro's own P6 reference screenshot. A bar is green where the contributing
// activity(ies) already have an Actual Cost recorded, yellow (Budgeted)
// otherwise, red if the period is overallocated against the Limit line
// (resource.max_hours_per_day x utilisation, same figure driving Resource
// Tracking's own red flag) — red takes priority over green, since being
// over capacity matters more than progress having been logged.
export function ResourceUsageProfileWidget({
  calendars, trackedResources, assignmentsByResource, buckets, spreadByResource, loading, layoutPrefs, unit,
  selectedResourceIds, onToggleResourceSelected, selectedActivityIds,
  leftPaneWidth,
}: Props) {
  const [visibleCols, setVisibleCols] = useState<Set<OptionalColKey>>(loadVisibleCols)
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false)

  // Flexes the chart to use whatever vertical space is left below it in the
  // viewport, instead of a small fixed height (2026-07-09, per Maro: "flex
  // the height of the usage profile to fit the well... it will improve the
  // visibility of the charts").
  const chartWrapRef = useRef<HTMLDivElement>(null)
  const [chartHeight, setChartHeight] = useState(CHART_HEIGHT_MIN)
  useEffect(() => {
    function recalc() {
      if (!chartWrapRef.current) return
      const top = chartWrapRef.current.getBoundingClientRect().top
      const available = window.innerHeight - top - 40
      setChartHeight(Math.max(CHART_HEIGHT_MIN, available))
    }
    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [])

  const chartScrollRef = useRef<HTMLDivElement>(null)
  // A dedicated visible scrollbar strip below the chart, matching
  // ResourceTrackingWidget's own — this chart's native scrollbar isn't
  // reliable enough to depend on alone (thin/OS-dependent rendering,
  // 2026-07-14 per Maro: "where tf is scroller i asked for"), so its own
  // scrollbar stays hidden (rt-hide-scrollbar) in favour of this always-
  // visible strip instead. Local sync only, no cross-widget component —
  // see this widget's own Props header comment for why that was dropped.
  const footerScrollRef = useRef<HTMLDivElement>(null)
  const syncChartScroll = (source: 'chart' | 'footer') => {
    const value = source === 'chart' ? chartScrollRef.current?.scrollLeft : footerScrollRef.current?.scrollLeft
    if (value === undefined) return
    if (chartScrollRef.current && source !== 'chart') chartScrollRef.current.scrollLeft = value
    if (footerScrollRef.current && source !== 'footer') footerScrollRef.current.scrollLeft = value
  }

  // Column virtualization — same rationale and pattern as
  // ResourceTrackingWidget's own (2026-07-14, per Maro: "heavily lagging").
  // Every bar and every x-axis label used to render regardless of zoom
  // level — up to ~1,275 of each at day zoom over a multi-year project.
  // Bars are already position:absolute with an explicit left offset, so
  // skipping the ones outside the visible window needs no spacer elements
  // at all (the container's own width, set explicitly below, keeps the
  // scrollable area correct either way) — simpler than Resource Tracking's
  // table cells, which needed real spacer <td>s to hold column widths.
  // 30, not 10 — widened alongside switching from a per-frame throttle to
  // a debounce below, same reasoning as ResourceTrackingWidget's own.
  const BUCKET_BUFFER = 30
  const [visibleBucketRange, setVisibleBucketRange] = useState<{ start: number; end: number }>({ start: 0, end: Math.min(buckets.length, 40) })

  const recomputeVisibleBucketRange = () => {
    const el = chartScrollRef.current
    if (!el) return
    const firstVisible = Math.floor(el.scrollLeft / PERIOD_COL_WIDTH)
    const lastVisible = Math.ceil((el.scrollLeft + el.clientWidth) / PERIOD_COL_WIDTH)
    const start = Math.max(0, firstVisible - BUCKET_BUFFER)
    const end = Math.min(buckets.length, lastVisible + BUCKET_BUFFER)
    setVisibleBucketRange(prev => (prev.start === start && prev.end === end) ? prev : { start, end })
  }

  useLayoutEffect(() => {
    recomputeVisibleBucketRange()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buckets])

  // Debounced, not per-frame throttled — see ResourceTrackingWidget's own
  // handleMainScroll for why (2026-07-14, per Maro: "scrolls are
  // unresponsive"). The window stays fixed for the whole duration of an
  // active scroll and only recomputes once scrolling actually pauses.
  const scrollDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleChartScroll = () => {
    syncChartScroll('chart')
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

  const toggleColumn = (key: OptionalColKey) => {
    setVisibleCols(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      localStorage.setItem(VISIBLE_COLS_STORAGE_KEY, JSON.stringify([...next]))
      return next
    })
  }

  // "select an activity in the tracking, I want to see the usage profile
  // reflected" (2026-07-08, per Maro) — shared calc with the print view so
  // the has-actuals/overallocation colouring can't drift between the two.
  const { barValues, hasActuals, limitValue } = useMemo(
    () => computeUsageProfileBars(trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit),
    [trackedResources, assignmentsByResource, buckets, spreadByResource, selectedActivityIds, unit]
  )

  const maxValue = Math.max(...barValues, limitValue, 1) * 1.1
  const gridlineCount = 4
  const axisLabel = unit === 'cost' ? '£' : unit === 'days' ? 'Days' : 'Hours'
  // Abbreviated (10.2M / 28.7k), not full comma-formatted (10,192,050) —
  // no fixed gutter width comfortably fits a full 8-figure, comma-grouped
  // Cost value at any readable font size (2026-07-14, per Maro: "£10,192,050"
  // overflowing the gutter into the resource table beside it, even after
  // widening RESOURCE_CHART_Y_AXIS_WIDTH once already) — abbreviating
  // scales to any project size without the gutter ever needing to grow
  // again. Full precision is still one hover away via each bar's own title
  // tooltip, unaffected by this — only the axis labels abbreviate.
  const formatAxisValue = (value: number): string => {
    const rounded = Math.round(value)
    const abs = Math.abs(rounded)
    const short = abs >= 1_000_000 ? `${(rounded / 1_000_000).toFixed(1)}M`
      : abs >= 1_000 ? `${(rounded / 1_000).toFixed(1)}k`
      : String(rounded)
    return unit === 'cost' ? `£${short}` : short
  }

  if (trackedResources.length === 0) return null

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4 no-print">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="font-bold text-sm">Resource Usage Profile</div>
        <div className="text-xs text-gray-400">Budgeted {unit} per period vs capacity (Limit)</div>
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
                  <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleColumn(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-400 p-4">Loading resource usage profile…</div>
      ) : (
        <div className="border border-gray-200 rounded overflow-hidden text-xs" style={{ fontFamily: FONT_FAMILY_CSS[layoutPrefs.fontFamily], fontSize: layoutPrefs.fontSize }}>
        <div className="flex">
          <div className="flex-shrink-0 border-r border-gray-200 flex flex-col" style={{ width: leftPaneWidth - RESOURCE_CHART_Y_AXIS_WIDTH }}>
            {/* Table header sits outside the bounded/scrollable body below,
                roughly matching the legend row's own height on the chart
                side. The body itself is capped to chartHeight and scrolls
                independently if there are more resources than fit — before
                this fix the table grew to its full natural height (one row
                per resource) with no bound at all, while the chart's own
                bars area was sized to the viewport via chartHeight
                independently of how many rows the table actually had,
                leaving a tall blank gap under the chart whenever the table
                ended up taller (2026-07-14, per Maro: "the chart and table
                are not aligned"). Both sides now share the same height. */}
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  <th className="px-1.5 py-1.5 border-b border-gray-200" />
                  <th className="px-2 py-1.5 border-b border-gray-200">Resource</th>
                  {visibleCols.has('role') && <th className="px-2 py-1.5 border-b border-gray-200">Role</th>}
                  {visibleCols.has('utilisation') && <th className="px-2 py-1.5 border-b border-gray-200 text-right">Utilisation</th>}
                  {visibleCols.has('calendar') && <th className="px-2 py-1.5 border-b border-gray-200">Calendar</th>}
                  {visibleCols.has('default_units') && <th className="px-2 py-1.5 border-b border-gray-200 text-right">Default Units/Time</th>}
                </tr>
              </thead>
            </table>
            <div className="overflow-y-auto rt-hide-scrollbar" style={{ maxHeight: chartHeight }}>
              <table className="w-full border-collapse">
                <tbody>
                  {trackedResources.map(resource => {
                    const rows = assignmentsByResource.get(resource.id) ?? []
                    const utilisations = rows.map(r => r.assignment.utilisation_pct !== null ? Number(r.assignment.utilisation_pct) : null).filter((v): v is number => v !== null)
                    const avgUtilisation = utilisations.length ? Math.round(utilisations.reduce((a, b) => a + b, 0) / utilisations.length) : null
                    return (
                      <tr key={resource.id} className="hover:bg-gray-50" style={{ height: 26 }}>
                        <td className="px-1.5 border-b border-gray-100">
                          <input type="checkbox" checked={selectedResourceIds.has(resource.id)} onChange={() => onToggleResourceSelected(resource.id)} />
                        </td>
                        <td className="px-2 py-1 border-b border-gray-100 font-medium text-gray-700">{resource.name}</td>
                        {visibleCols.has('role') && <td className="px-2 py-1 border-b border-gray-100 text-gray-500">{resource.role ?? '—'}</td>}
                        {visibleCols.has('utilisation') && <td className="px-2 py-1 border-b border-gray-100 text-right text-gray-500">{avgUtilisation !== null ? `${avgUtilisation}%` : '—'}</td>}
                        {visibleCols.has('calendar') && (
                          <td className="px-2 py-1 border-b border-gray-100 text-gray-500">
                            {resource.calendar_id ? (calendars.find(c => c.id === resource.calendar_id)?.name ?? '—') : '—'}
                          </td>
                        )}
                        {visibleCols.has('default_units') && <td className="px-2 py-1 border-b border-gray-100 text-right text-gray-500">{resource.max_hours_per_day}h/d</td>}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div ref={chartWrapRef} className="flex-1 flex flex-col">
            <div className="flex items-center gap-3 mb-2 px-3 pt-3 text-gray-500">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.budgeted }} />Budgeted</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.actual }} />Has Actuals</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: RESOURCE_USAGE_COLORS.overallocated }} />Overallocated</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ backgroundColor: RESOURCE_USAGE_COLORS.limit }} />Limit</span>
            </div>
            {/* mt-2 — the topmost y-axis gridline label sits at
                bottom:chartHeight with a -translate-y-1/2 (2026-07-14, per
                Maro: "some legend and text overlap") — that shift pushes it
                partway above this row's own top edge, colliding with the
                legend row directly above; a little breathing room here
                keeps it clear regardless of exact font size/line height. */}
            <div className="flex flex-1 mt-2">
              {/* Y-axis gutter — fixed, doesn't scroll with the chart, mirrors
                  the x-axis's own period labels below (2026-07-09, per Maro:
                  "add y axis fields, e.g in x axis you have the time
                  periods"). Resource Tracking reserves an identical blank
                  column so both tables' period columns still line up despite
                  this extra width on Profile's side only. */}
              <div className="flex-shrink-0 flex" style={{ width: RESOURCE_CHART_Y_AXIS_WIDTH, height: chartHeight }}>
                {/* writing-mode (not transform:rotate) — rotate() doesn't
                    participate in layout, so at larger Layout font sizes the
                    title visually bled upward out of this 14px box into the
                    legend row above (2026-07-10 fix, per Maro: "the y axis
                    details is overlapping with the other chart details").
                    writing-mode lays the text out vertically as a normal
                    box, so it can't overflow its container that way. */}
                <div className="flex items-center justify-center overflow-hidden" style={{ width: 14 }}>
                  <span className="text-gray-500 whitespace-nowrap" style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>{axisLabel}</span>
                </div>
                <div className="relative flex-1">
                  {Array.from({ length: gridlineCount + 1 }, (_, i) => {
                    const value = (maxValue / gridlineCount) * i
                    const bottom = (value / maxValue) * chartHeight
                    // The topmost label sits at bottom:chartHeight — the
                    // very top edge of this container — so centering it on
                    // that line via -translate-y-1/2 (every other label's
                    // own approach) pushes half its own height *above* the
                    // container, overlapping the legend row directly above
                    // it regardless of any margin added around the
                    // container itself (2026-07-14, per Maro: "some legend
                    // and text overlap... even at different time
                    // intervals"). Top-aligning just this one label instead
                    // of center-aligning it — same convention most chart
                    // libraries use for exactly this reason — keeps it
                    // fully inside the container no matter the font size.
                    const isTopLabel = i === gridlineCount
                    return (
                      <span
                        key={i}
                        className={`absolute right-1 text-gray-400 ${isTopLabel ? '' : '-translate-y-1/2'}`}
                        style={isTopLabel ? { top: 0 } : { bottom }}
                      >
                        {formatAxisValue(value)}
                      </span>
                    )
                  })}
                </div>
              </div>
              <div
                ref={chartScrollRef}
                onScroll={handleChartScroll}
                className="flex-1 overflow-x-auto pb-3 rt-hide-scrollbar"
              >
                <div className="relative" style={{ height: chartHeight, width: buckets.length * PERIOD_COL_WIDTH }}>
                  {Array.from({ length: gridlineCount + 1 }, (_, i) => {
                    const value = (maxValue / gridlineCount) * i
                    const bottom = (value / maxValue) * chartHeight
                    return <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ bottom }} />
                  })}
                  {limitValue > 0 && (
                    <div
                      className="absolute left-0 right-0"
                      style={{ bottom: (limitValue / maxValue) * chartHeight, height: 2, backgroundColor: RESOURCE_USAGE_COLORS.limit }}
                      title={`Limit: ${unit === 'cost' ? `£${limitValue.toFixed(0)}` : `${limitValue.toFixed(0)}${unit === 'days' ? 'd' : 'h'}`}`}
                    />
                  )}
                  {visibleBucketIndices.map(i => {
                    const value = barValues[i]
                    const overallocated = value > limitValue && limitValue > 0
                    const color = overallocated ? RESOURCE_USAGE_COLORS.overallocated : hasActuals[i] ? RESOURCE_USAGE_COLORS.actual : RESOURCE_USAGE_COLORS.budgeted
                    return (
                      <div
                        key={i}
                        title={`${buckets[i].label}: ${unit === 'cost' ? `£${value.toFixed(0)}` : `${value.toFixed(1)}${unit === 'days' ? 'd' : 'h'}`}`}
                        className="absolute rounded-t-sm"
                        style={{
                          left: i * PERIOD_COL_WIDTH + 6, width: PERIOD_COL_WIDTH - 12,
                          bottom: 0, height: (value / maxValue) * chartHeight,
                          backgroundColor: color,
                        }}
                      />
                    )
                  })}
                </div>
                {/* position:relative + absolute children, not flex — flex
                    would pack the (windowed) visible labels together at
                    the container's left edge instead of leaving each one
                    at its real bucket position, since flex has no concept
                    of "skipped" siblings the way an explicit left offset
                    does. */}
                <div className="relative text-gray-400 mt-1" style={{ width: buckets.length * PERIOD_COL_WIDTH, height: 16 }}>
                  {visibleBucketIndices.map(i => (
                    <div key={i} className="absolute text-center" style={{ left: i * PERIOD_COL_WIDTH, width: PERIOD_COL_WIDTH }}>{buckets[i].label}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* The one visible, draggable scrollbar for this chart — its own
            native scrollbar stays hidden (rt-hide-scrollbar above) in
            favour of this, matching ResourceTrackingWidget's own "I want
            the scroll wheel at the bottom" strip. leftPaneWidth already
            covers both the table's own width *and* the y-axis gutter next
            to it (leftPaneWidth = table width + RESOURCE_CHART_Y_AXIS_WIDTH,
            see this widget's own Props), so the blank spacer below needs
            no further adjustment to line up with where the chart bars
            actually start. */}
        <div className="flex border-t border-gray-200">
          <div style={{ width: leftPaneWidth, flexShrink: 0 }} />
          <div ref={footerScrollRef} onScroll={() => syncChartScroll('footer')} className="flex-1" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
            <div style={{ width: buckets.length * PERIOD_COL_WIDTH, height: 14 }} />
          </div>
        </div>
        </div>
      )}
    </div>
  )
}
