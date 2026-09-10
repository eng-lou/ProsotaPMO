import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Customized, LabelList, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  getCostPerformanceTrend, getIcdOpenItemsTrend, getPvEvAcTrend, getRiskEmvTrend, getSpiTrend,
  type CostPerformanceTrendPoint, type IcdOpenItemsTrendPoint, type PvEvAcTrendPoint, type RiskEmvTrendPoint,
  type SpiTrendPoint,
} from './baselineTrends'
import { listCameraViews, type CameraView } from '../fourD/cameraViews'
import { downloadFourDVideo, listFourDVideos, type FourDVideo } from '../fourD/fourDVideos'
import { evaluateDashboardFilter, type DashboardFilterCondition } from '@/lib/dashboardFilters'
import { matchesCrossFilter, type CrossFilterEntityKind, type CrossFilterScope } from '@/lib/dashboardCrossFilter'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { getMilestoneTrend, type MilestoneTrendSeries } from './milestoneTrend'
import { MilestoneTrack } from './MilestoneTrack'
import { formatCurrency, formatDate } from './Overview'
import type { DashboardOverviewResponse, ResourceAssignmentSummary } from './types'

// The Dashboard's addable/removable/resizable widget catalog (2026-07-20,
// per Maro: "think powerbi") — each of Overview.tsx's six former fixed
// panels, extracted so DashboardGrid.tsx can place/resize them freely.
// Every widget takes the same already-fetched DashboardOverviewResponse —
// none of them fetch their own data, same "one fetch, many views" split
// Overview.tsx already used before this change.
export interface WidgetProps {
  data: DashboardOverviewResponse
  onNavigateToRisks: () => void
  // 2026-07-20 (Batch 7) — widgets reading 4D-module data (Camera Views, 4D
  // Video) fetch it themselves rather than through DashboardOverviewResponse,
  // same "genuinely different data source gets its own fetch" reasoning
  // Baseline Comparison's own separate endpoint already established.
  // Optional, mirroring DashboardGrid's own projectId prop — undefined only
  // while no project is selected yet, same case that component already handles.
  projectId: string | undefined
  // Per-widget filter (2026-09-02, per Maro: "what if you allowed
  // flexibility to those widgets" -> "any structured field should be
  // queryable/sliceable/filterable" -> "see how we use the filters/
  // highlights in the schedule. functionality is definitely there" — this
  // is now the exact same {field, operator, value} condition language as
  // Scheduling's own Filters/Highlights (lib/dashboardFilters.ts's own
  // header explains why it's a sibling of, not a reuse of,
  // lib/schedulingFilters.ts's evaluateCondition), not a flat equals-only
  // dict — this app's first-pass dashboard filter shape, which couldn't
  // express a numeric/date comparison or a WBS-subtree scope
  // (wbs_path+starts_with). Undefined/empty = no filter.
  //
  // 2026-09-03, per Maro: "you didnt apply them to the existing widgets" —
  // the original 9 (see FILTERABLE_WIDGET_TYPES below) were only ever the
  // ones a live Poe request had actually exercised, not "every widget this
  // COULD apply to." Extended to every other widget that reads straight off
  // one of the same six raw per-record arrays (data.risks/cost_elements/
  // icd_items/resource_assignments/schedule_activities/milestones), or one
  // of the two smaller ones added at the same time (data.lookahead_items,
  // data.mitigation_actions), or data.clash_pairs — plus milestone_trend_chart
  // (its own, genuinely different milestone-across-baselines shape, added
  // 2026-09-03) — 34 widget_types total now, see FILTERABLE_WIDGET_TYPES. Extended
  // again 2026-09-10 to milestone_variance, that same milestone-across-
  // baselines shape — 35 total now.
  // risk_emv_trend/cost_cpi_trend/cost_eac_trend/spi_trend/
  // icd_open_items_trend (added same day, per Maro: "Do a trend chart for
  // Risk EMV, do for CPI, SPI, Cost EAC, Issues, Changes and Decisions
  // Status changes... being able to see the trend is important") are
  // deliberately NOT in that set — like kpi_strip/risk_exposure below, they
  // read a server-pre-aggregated portfolio rollup (total EMV, portfolio
  // CPI/EAC/SPI, open counts) computed across baselines, not a raw
  // per-record array there's anything to filter down to.
  // Deliberately NOT extended to the
  // handful of widgets that read a server-pre-aggregated summary instead
  // of a raw array (kpi_strip, schedule_performance, risk_overview,
  // risk_exposure, dcma_score, clash_summary, eac_forecast_comparison,
  // earned_value_summary_table) — those numbers are computed server-side
  // over the WHOLE project (dashboard.py's own EVM/DCMA/clash rollups), so
  // "filtering" one would mean re-deriving that computation client-side
  // over a subset, a materially different (and riskier to get subtly
  // wrong) change than reusing an already-fetched raw array; a real
  // follow-up if ever asked for, not silently out of scope. project_info/
  // project_narrative aren't per-record at all; camera_view_gallery/
  // fourd_video_gallery fetch their own, unrelated 4D-module data.
  filterConditions?: DashboardFilterCondition[]
  filterMatchMode?: 'all' | 'any'

  // Cross-widget "click to filter" (2026-09-06, per Maro — see
  // lib/dashboardCrossFilter.ts's own header for the full design).
  // crossFilter is the currently-active scope (or null/undefined when
  // nothing's selected) — every widget below that reads one of the six
  // per-record arrays applies matchesCrossFilter alongside its existing
  // evaluateDashboardFilter call. onCrossFilterClick is how a widget acts
  // as a *source*: pass a unique key identifying what was clicked (e.g.
  // `activity:${id}`), which kind of record it is, and the id(s) it
  // resolves to — Overview.tsx owns the actual toggle-on-same-key-again
  // logic and the related-records fetch this triggers. Widened 2026-09-07
  // from activity-only to any of the four kinds (per Maro: "most of the
  // dashboards are not clickable... risk/cost/resource rows [should be]
  // clickable as sources too"). Only present while a project is selected,
  // same optionality as projectId itself.
  crossFilter?: CrossFilterScope | null
  onCrossFilterClick?: (key: string, seedType: CrossFilterEntityKind, seedIds: string[]) => void
}

const RISK_BAND_COLORS: Record<string, string> = { Low: '#16a34a', Medium: '#d97706', High: '#dc2626' }

// Shared click-to-source helper for every record-keyed row/bar (2026-09-06,
// widened 2026-09-07 to any CrossFilterEntityKind — see
// WidgetProps.onCrossFilterClick's own header). ids is plural so a chart
// bucket representing several records at once (e.g. one Float Distribution
// bar) can seed the cross-filter with all of them, not just a single row's
// own id — a single-row table just passes a one-element array.
function recordClick(
  kind: CrossFilterEntityKind, ids: string[],
  crossFilter: CrossFilterScope | null | undefined, onCrossFilterClick: WidgetProps['onCrossFilterClick'],
) {
  const key = `${kind}:${ids.join(',')}`
  return {
    onClick: onCrossFilterClick ? () => onCrossFilterClick(key, kind, ids) : undefined,
    selected: crossFilter?.key === key,
  }
}

function activityClick(ids: string[], crossFilter: CrossFilterScope | null | undefined, onCrossFilterClick: WidgetProps['onCrossFilterClick']) {
  return recordClick('activity', ids, crossFilter, onCrossFilterClick)
}
const CROSS_FILTER_ROW_CLASS = 'cursor-pointer hover:bg-gray-50 dark:hover:bg-prosota-panel2'
const CROSS_FILTER_SELECTED_CLASS = 'bg-prosota-amber/10'

export function KpiStripWidget({ data }: WidgetProps) {
  const { kpis } = data
  const tiles: [string, React.ReactNode, React.ReactNode?][] = [
    ['Planned Finish', formatDate(kpis.planned_finish), kpis.planned_finish_status !== 'unknown' && (
      <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${kpis.planned_finish_status === 'delayed' ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400' : 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-400'}`}>
        {kpis.planned_finish_status === 'delayed' ? 'Delayed' : 'On track'}
      </span>
    )],
    ['Open Issues', kpis.open_issues],
    ['Open Changes', kpis.open_changes],
    ['Schedule SPI', kpis.schedule_spi !== null ? Number(kpis.schedule_spi).toFixed(2) : '—'],
    ['BAC', kpis.bac !== null ? formatCurrency(kpis.bac) : '—'],
    ['EAC', kpis.eac !== null ? formatCurrency(kpis.eac) : '—'],
    ['Cost CPI', <span className={kpis.cpi !== null && Number(kpis.cpi) < 1 ? 'text-orange-600' : 'text-gray-900 dark:text-prosota-paper'}>{kpis.cpi !== null ? Number(kpis.cpi).toFixed(2) : '—'}</span>],
  ]
  return (
    <div className="grid grid-cols-4 gap-3 h-full overflow-auto">
      {tiles.map(([label, value, extra]) => (
        <div key={label} className="bg-gray-50 dark:bg-prosota-panel2 rounded-lg p-3">
          <div className="text-xs text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1">{label}</div>
          <div className="text-lg font-bold text-gray-900 dark:text-prosota-paper">{value}</div>
          {extra}
        </div>
      ))}
    </div>
  )
}

export function SchedulePerformanceWidget({ data }: WidgetProps) {
  const { schedule_buckets } = data
  const bucketPct = (n: number) => (schedule_buckets.total > 0 ? Math.round((n / schedule_buckets.total) * 100) : 0)
  return (
    <div className="space-y-2 text-xs h-full overflow-auto">
      {([
        ['On-Time', schedule_buckets.on_time, 'bg-green-500'],
        ['At Risk', schedule_buckets.at_risk, 'bg-amber-500'],
        ['Delayed', schedule_buckets.delayed, 'bg-red-500'],
      ] as const).map(([label, count, color]) => (
        <div key={label}>
          <div className="flex justify-between mb-0.5">
            <span className="text-gray-600 dark:text-prosota-muted">{label}</span>
            <span className="font-medium">{count} ({bucketPct(count)}%)</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-prosota-panel2 rounded-full overflow-hidden">
            <div className={`h-full ${color}`} style={{ width: `${bucketPct(count)}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function RiskOverviewWidget({ data }: WidgetProps) {
  const { risk_overview } = data
  return (
    <div className="h-full overflow-auto">
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div className="bg-red-50 dark:bg-red-500/10 rounded-md p-2.5">
          <div className="text-lg font-bold text-red-700 dark:text-red-400">{risk_overview.high}</div>
          <div className="text-xs text-red-600 dark:text-red-400">High</div>
        </div>
        <div className="bg-amber-50 dark:bg-amber-500/10 rounded-md p-2.5">
          <div className="text-lg font-bold text-amber-700 dark:text-amber-400">{risk_overview.medium}</div>
          <div className="text-xs text-amber-600 dark:text-amber-400">Medium</div>
        </div>
        <div className="bg-green-50 dark:bg-green-500/10 rounded-md p-2.5">
          <div className="text-lg font-bold text-green-700 dark:text-green-400">{risk_overview.low}</div>
          <div className="text-xs text-green-600 dark:text-green-400">Low</div>
        </div>
      </div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-prosota-muted pt-2 border-t border-gray-100 dark:border-prosota-line">
        <span>Open: {risk_overview.open}</span>
        <span>Closed: {risk_overview.closed}</span>
      </div>
    </div>
  )
}

export function MilestoneTimelineWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const milestones = data.milestones
    .filter(m => evaluateDashboardFilter(m, filterConditions, filterMatchMode))
    .filter(m => matchesCrossFilter(m.id, 'activity', crossFilter))
  const selected = milestones.find(m => crossFilter?.key === `activity:${m.id}`)
  // Data-date line (2026-09-07, per Maro: first "allow me to set the
  // date," then "scrap the data date picker use the data date from the
  // working schedule" — no manual input at all; always the schedule's own
  // real Data Date, the same field ProjectInfoWidget already shows).
  const dataDate = data.project_info.data_date
  // pt-4 (2026-09-03, per Maro: "top buffer for the milestone timeline") —
  // MilestoneTrack's own topmost label sits at a fixed offset above its
  // internal axis, which is itself vertically centred within a container
  // whose height is usually pinned at BASE_MIN_HEIGHT (single-row case) —
  // so shrinking the widget tile down toward that minimum leaves almost no
  // visible gap between this header and the first label. Adding padding
  // here (outside MilestoneTrack's own layout math) pushes the whole track
  // down by a fixed amount without touching its internal dot/label/axis
  // spacing logic.
  return (
    // h-full REMOVED (2026-09-07, per Maro: "its not centered, its too
    // top... see that red milestone just alone with no title or date
    // too") — this wrapper forcing itself to 100% of the Expand modal's
    // own height defeated the modal's `justify-center` entirely (a
    // stretched-to-fill child can't be centered inside its own container,
    // it just IS the container), which also explains the seemingly
    // "missing" label: the modal's own fixed content height reserved less
    // room above the axis than the topmost stacked row actually needed,
    // clipping just that one label off the rendered area while its dot
    // (24px lower) still fit. Sizing to real content height instead of
    // h-full fixes both at once.
    <div className="overflow-auto pt-4">
      <MilestoneTrack
        milestones={milestones}
        onMilestoneClick={onCrossFilterClick ? id => onCrossFilterClick(`activity:${id}`, 'activity', [id]) : undefined}
        selectedId={selected?.id ?? null}
        dataDate={dataDate}
      />
    </div>
  )
}

// Milestone Trend Analysis (2026-09-03, per Maro: "i need charts across
// baseline periods e.g milestones over time a trend analysis... whether
// milestones have improved or delayed over time") — unlike every widget
// above, this doesn't read `data` (DashboardOverviewResponse) at all: it
// needs every saved ScheduleBaseline's own captured milestone dates, not a
// single current-schedule snapshot, so it fetches its own data and resolves
// its own schedule period, same "genuinely different data source gets its
// own fetch" precedent Camera Views/4D Video already established (Batch 7
// above). A classic P6/PMBOK "milestone trend chart" (a.k.a. banana chart):
// each milestone gets its own line, one point per baseline it existed for
// (chronological) plus a final "Current" point from its live, un-baselined
// finish — a flat line means stable, a rising line means slipping, falling
// means pulling in.
const MILESTONE_TREND_COLORS = ['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2', '#db2777', '#65a30d']

interface MilestoneTrendAxisEntry { key: string; label: string; date: string }

function buildMilestoneTrendAxis(series: MilestoneTrendSeries[]): MilestoneTrendAxisEntry[] {
  const byKey = new Map<string, MilestoneTrendAxisEntry>()
  for (const s of series) {
    for (const p of s.points) {
      const key = p.baseline_id ?? 'current'
      if (!byKey.has(key)) byKey.set(key, { key, label: p.baseline_name, date: p.baseline_date })
    }
  }
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// Collision-avoided end-of-line labels for a trend chart's last data point
// (2026-09-11, per Maro on a real screenshot: with several milestones
// landing close together — or sharing a name like two "Roof Complete"
// lines — plain one-label-per-line placement stacked them right on top of
// each other, illegible, and a long milestone name ran straight off the
// tile's right edge instead of wrapping or truncating). Recharts' own
// Customized component hands the `component` prop the EXACT xAxisMap/
// yAxisMap/offset the chart itself just computed — its real d3 scale
// functions, not a guess at one — so labels land pixel-perfect against the
// actual layout without reimplementing (and risking drifting out of sync
// with) the chart's own margin/domain math. Used instead of Line's own
// `label` prop, which silently rendered nothing at all when first tried
// (Line delegates a function `label` to LabelList/Label's own
// content-render path, whose exact prop shape isn't the simple
// {x,y,index,value} it looks like from the docs — confirmed by inspecting
// the real rendered SVG in a live browser and finding zero label <text>
// nodes).
interface TrendEndLabelSpec { key: string; label: string; color: string; value: number }

const TREND_END_LABEL_MAX_CHARS = 20
const TREND_END_LABEL_MIN_GAP = 14

function renderTrendEndLabels(specs: TrendEndLabelSpec[], lastLabel: string) {
  return (
    <Customized
      key="end-labels"
      component={(props: { xAxisMap?: Record<string, { scale: (v: unknown) => number }>; yAxisMap?: Record<string, { scale: (v: unknown) => number }>; offset?: { top: number; height: number } }) => {
        const { xAxisMap, yAxisMap, offset } = props
        if (!xAxisMap || !yAxisMap || !offset) return null
        const xScale = Object.values(xAxisMap)[0]?.scale
        const yScale = Object.values(yAxisMap)[0]?.scale
        if (!xScale || !yScale) return null
        const anchorX = xScale(lastLabel)
        const top = offset.top
        const bottom = offset.top + offset.height

        // Sort by true (unavoidably overlapping) pixel position, then push
        // later ones down to keep a minimum gap, then — since a long run
        // of clustered points can get pushed straight past the chart's own
        // bottom edge — pull the whole stack back up from the bottom so it
        // stays inside the plot area while still respecting the gap.
        const positioned = specs
          .map(s => ({ ...s, trueY: yScale(s.value), y: yScale(s.value) }))
          .sort((a, b) => a.trueY - b.trueY)
        for (let i = 1; i < positioned.length; i++) {
          positioned[i].y = Math.max(positioned[i].y, positioned[i - 1].y + TREND_END_LABEL_MIN_GAP)
        }
        const overflow = positioned.length ? positioned[positioned.length - 1].y - bottom : 0
        if (overflow > 0) {
          for (const p of positioned) p.y -= overflow
          for (let i = positioned.length - 2; i >= 0; i--) {
            positioned[i].y = Math.min(positioned[i].y, positioned[i + 1].y - TREND_END_LABEL_MIN_GAP)
          }
        }
        if (positioned.length) positioned[0].y = Math.max(positioned[0].y, top)

        return (
          <g>
            {positioned.map(p => {
              const truncated = p.label.length > TREND_END_LABEL_MAX_CHARS
                ? `${p.label.slice(0, TREND_END_LABEL_MAX_CHARS - 1)}…`
                : p.label
              const shifted = Math.abs(p.y - p.trueY) > 2
              return (
                <g key={p.key}>
                  {shifted && (
                    <line x1={anchorX} y1={p.trueY} x2={anchorX + 6} y2={p.y} stroke={p.color} strokeWidth={1} strokeOpacity={0.45} />
                  )}
                  <text x={anchorX + (shifted ? 10 : 6)} y={p.y} dy={4} fontSize={11} fill={p.color}>
                    <title>{p.label}</title>
                    {truncated}
                  </text>
                </g>
              )
            })}
          </g>
        )
      }}
    />
  )
}

export function MilestoneTrendChartWidget({ projectId, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const { period: schedulePeriod, loading: periodLoading } = useActiveScheduleVariant(projectId)
  const [series, setSeries] = useState<MilestoneTrendSeries[] | null>(null)

  useEffect(() => {
    if (!schedulePeriod) return
    let cancelled = false
    getMilestoneTrend(schedulePeriod.id).then(s => { if (!cancelled) setSeries(s) })
    return () => { cancelled = true }
  }, [schedulePeriod?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || series === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (series.length === 0) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No milestones in this schedule yet.</span>

  // Filterable on code/task_name (2026-09-03, per Maro: "the filter should
  // be exposed so i can pick the milestones to show") — e.g.
  // {field:'code', operator:'eq', value:'M-0002'} isolates one milestone,
  // or {field:'task_name', operator:'contains', value:'Completion'} shows
  // a themed subset. Filtered before the axis is built so a narrowed view
  // never shows a baseline column that's now entirely empty.
  const visibleSeries = series
    .filter(s => evaluateDashboardFilter(s, filterConditions, filterMatchMode))
    .filter(s => matchesCrossFilter(s.activity_id, 'activity', crossFilter))
  if (visibleSeries.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-prosota-muted">No milestones match this filter.</span>
  }

  const axis = buildMilestoneTrendAxis(visibleSeries)
  if (axis.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved baselines yet) — save at least one Schedule Baseline to start a trend.
      </span>
    )
  }
  const chartData = axis.map(a => {
    const row: Record<string, string | number | null> = { label: a.label }
    for (const s of visibleSeries) {
      const point = s.points.find(p => (p.baseline_id ?? 'current') === a.key)
      row[s.code] = point?.finish ? new Date(point.finish).getTime() : null
    }
    return row
  })
  const lastLabel = axis[axis.length - 1].label

  return (
    <ResponsiveContainer width="100%" height="100%">
      {/* horizontal-only gridlines, no axis box, and each line labelled
          directly at its own last point (via renderTrendEndLabels — see its
          own header for why that's a Customized layer over Line's own
          `label` prop, which silently rendered nothing at all when first
          tried) instead of a separate legend (2026-09-03, per Maro: the
          bottom-legend/full-grid-box version "looks like trash" next to a
          clean reference chart) — reads which line is which without eye
          travel back and forth to a key, and survives lines clustering
          close together far better than colour alone would (collision
          avoidance added 2026-09-11 once a real chart had several
          milestones landing close enough to make the labels stack right on
          top of each other — see renderTrendEndLabels). */}
      <LineChart data={chartData} margin={{ top: 10, right: 165, bottom: 10, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
        <YAxis
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => formatDate(new Date(v).toISOString())}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#d1d5db' }}
          width={90}
        />
        <Tooltip
          labelFormatter={(label: string) => label}
          formatter={(v: number, name: string) => [formatDate(new Date(v).toISOString()), name]}
        />
        {visibleSeries.map((s, i) => {
          const color = MILESTONE_TREND_COLORS[i % MILESTONE_TREND_COLORS.length]
          return (
            <Line
              key={s.activity_id}
              type="monotone"
              dataKey={s.code}
              name={s.task_name}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: color }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          )
        })}
        {renderTrendEndLabels(
          visibleSeries
            .map((s, i) => {
              const lastValue = chartData[chartData.length - 1][s.code]
              if (typeof lastValue !== 'number') return null
              return { key: s.activity_id, label: s.task_name, color: MILESTONE_TREND_COLORS[i % MILESTONE_TREND_COLORS.length], value: lastValue }
            })
            .filter((s): s is TrendEndLabelSpec => s !== null),
          lastLabel,
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

// Milestone Variance (2026-09-10, per Maro, referencing an AI-generated
// dashboard mockup with a bar-per-milestone slippage summary underneath the
// trend chart) — same underlying per-milestone-across-baselines data as
// MilestoneTrendChartWidget above, reduced to one number per milestone: how
// many days its finish moved between a REFERENCE baseline (picked below,
// earliest by default) and the most recent point (a later baseline, or
// "Current" if that's all there is past the reference). Deliberately NOT a
// true cumulative waterfall (each bar doesn't start where the previous
// one's top/bottom left off) — the reference mockup's bars are each
// independent against one shared zero line, which is what's built here;
// "waterfall" in the ask was describing the look (diverging red/green
// bars), not literal waterfall-chart math.
interface MilestoneVarianceBaselineOption { id: string; name: string; date: string }

// 2026-09-11, per Maro on a real screenshot: the widget silently always
// diffed against the EARLIEST baseline with no way to tell (or change)
// what it was comparing against — surfaced here as a real picker (option
// values are real baseline ids, not the generic {field,operator,value}
// filter language every other widget's Filter button uses, since "which
// baseline is the reference point" is a chart parameter, not a per-record
// filter condition — there's no single MilestoneTrendSeries field a
// condition could target that would mean this).
function getMilestoneVarianceBaselineOptions(series: MilestoneTrendSeries[]): MilestoneVarianceBaselineOption[] {
  const byId = new Map<string, MilestoneVarianceBaselineOption>()
  for (const s of series) {
    for (const p of s.points) {
      if (p.baseline_id && !byId.has(p.baseline_id)) {
        byId.set(p.baseline_id, { id: p.baseline_id, name: p.baseline_name, date: p.baseline_date })
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function buildMilestoneVarianceData(series: MilestoneTrendSeries[], referenceBaselineId: string) {
  return series
    .map(s => {
      const reference = s.points.find(p => p.baseline_id === referenceBaselineId && p.finish)
      const withFinish = s.points.filter(p => p.finish)
      const latest = withFinish[withFinish.length - 1]
      if (!reference || !latest) return null
      const days = Math.round((new Date(latest.finish!).getTime() - new Date(reference.finish!).getTime()) / 86_400_000)
      return { activity_id: s.activity_id, name: s.task_name, days }
    })
    .filter((d): d is { activity_id: string; name: string; days: number } => d !== null)
}

// Recharts' own Bar `label` prop has the same unreliable content-shape
// problem documented on renderTrendEndLabels above, so this uses LabelList's
// `content` render-prop instead — needed here anyway to flip the label to
// the *outside* of the bar (above a red bar, below a green one) rather than
// recharts' default, which anchors "top" to the rect's own top edge. x/y/
// height here are Bar's own raw rect props, which for a NEGATIVE value
// Recharts hands over unnormalized (y at the bar's pixel-bottom, height
// negative) rather than flipped the way you'd naively expect — min/max
// against y+height rather than trusting height's sign is what actually
// gets a negative bar's label positioned below it instead of landing back
// inside the bar itself, where green-on-green text rendered but was
// functionally invisible (2026-09-11, per Maro on a real screenshot: "greens
// not showing the numbers").
function MilestoneVarianceLabel({ x = 0, y = 0, width = 0, height = 0, value = 0 }: { x?: number; y?: number; width?: number; height?: number; value?: number }) {
  const top = Math.min(y, y + height)
  const bottom = Math.max(y, y + height)
  const isNegative = value < 0
  return (
    <text
      x={x + width / 2}
      y={isNegative ? bottom + 16 : top - 8}
      textAnchor="middle"
      fontSize={11}
      fontWeight={600}
      fill={value > 0 ? '#dc2626' : isNegative ? '#16a34a' : '#6b7280'}
    >
      {value > 0 ? `+${value}d` : `${value}d`}
    </text>
  )
}

export function MilestoneVarianceWidget({ projectId, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const { period: schedulePeriod, loading: periodLoading } = useActiveScheduleVariant(projectId)
  const [series, setSeries] = useState<MilestoneTrendSeries[] | null>(null)
  const [referenceBaselineId, setReferenceBaselineId] = useState<string | null>(null)

  useEffect(() => {
    if (!schedulePeriod) return
    let cancelled = false
    getMilestoneTrend(schedulePeriod.id).then(s => { if (!cancelled) setSeries(s) })
    return () => { cancelled = true }
  }, [schedulePeriod?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || series === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (series.length === 0) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No milestones in this schedule yet.</span>

  const visibleSeries = series
    .filter(s => evaluateDashboardFilter(s, filterConditions, filterMatchMode))
    .filter(s => matchesCrossFilter(s.activity_id, 'activity', crossFilter))
  if (visibleSeries.length === 0) {
    return <span className="text-xs text-gray-400 dark:text-prosota-muted">No milestones match this filter.</span>
  }

  const baselineOptions = getMilestoneVarianceBaselineOptions(series)
  if (baselineOptions.length === 0) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved baselines yet) — save at least one Schedule Baseline to see variance.
      </span>
    )
  }
  const effectiveReferenceId = referenceBaselineId && baselineOptions.some(b => b.id === referenceBaselineId)
    ? referenceBaselineId
    : baselineOptions[0].id
  const referenceOption = baselineOptions.find(b => b.id === effectiveReferenceId)!

  const chartData = buildMilestoneVarianceData(visibleSeries, effectiveReferenceId)
  const click = activityClick
  // Extra headroom above/below the tallest bars (2026-09-11, per Maro on a
  // real screenshot: a negative bar's label had nowhere to sit — it landed
  // right on top of the rotated X-axis tick labels below it, since Recharts'
  // own auto domain hugs the data tightly with no room reserved for an
  // external label) — proportional to the chart's own value range so it
  // scales sensibly whether variances are single- or triple-digit.
  const varianceValues = chartData.map(d => d.days)
  const domainMin = Math.min(0, ...varianceValues)
  const domainMax = Math.max(0, ...varianceValues)
  const domainPad = Math.max(8, Math.round((domainMax - domainMin) * 0.18))

  return (
    <div className="h-full flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-prosota-muted shrink-0">
        <span>Comparing against:</span>
        <select
          className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1 text-xs"
          value={effectiveReferenceId}
          onChange={e => setReferenceBaselineId(e.target.value)}
        >
          {baselineOptions.map(b => <option key={b.id} value={b.id}>{b.name} ({formatDate(b.date)})</option>)}
        </select>
      </div>
      {chartData.length === 0 ? (
        <span className="flex-1 flex items-center justify-center text-center px-4 text-xs text-gray-400 dark:text-prosota-muted">
          No milestones have a finish date at both {referenceOption.name} and now.
        </span>
      ) : (
        <div className="flex-1 min-h-0">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 26, right: 12, bottom: 10, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#d1d5db' }}
                interval={0}
                angle={-25}
                textAnchor="end"
                height={70}
              />
              <YAxis
                domain={[domainMin - domainPad, domainMax + domainPad]}
                tickFormatter={(v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}d`)}
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#d1d5db' }}
                width={50}
              />
              <ReferenceLine y={0} stroke="#9ca3af" />
              <Tooltip formatter={(v: number) => [`${v > 0 ? '+' : ''}${v} days`, 'Variance']} />
              <Bar
                dataKey="days"
                radius={[3, 3, 3, 3]}
                isAnimationActive={false}
                cursor={onCrossFilterClick ? 'pointer' : undefined}
                onClick={onCrossFilterClick ? (entry: { activity_id: string }) => click([entry.activity_id], crossFilter, onCrossFilterClick).onClick?.() : undefined}
              >
                {chartData.map(d => {
                  const selected = click([d.activity_id], crossFilter, onCrossFilterClick).selected
                  return <Cell key={d.activity_id} fill={selected ? '#d97706' : d.days > 0 ? '#dc2626' : d.days < 0 ? '#16a34a' : '#9ca3af'} />
                })}
                <LabelList dataKey="days" content={<MilestoneVarianceLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

// Trend-across-baselines charts (2026-09-03, per Maro: "Do a trend chart for
// Risk EMV, do for CPI, SPI, Cost EAC, Issues, Changes and Decisions Status
// changes... more comprehensive analysis, not just a snapshot but we have
// baseline data/s, being able to see the trend is important") — same visual
// language as Milestone Trend Chart above (horizontal-only gridlines, no
// legend, each line labelled at its own last point via renderTrendEndLabels),
// factored into one shared renderer since these four widgets
// are otherwise near-identical: a handful of named numeric series plotted
// against the same {baseline_name, baseline_date}-shaped x-axis. Unlike
// Milestone Trend Chart, these read a server-pre-aggregated rollup (total
// EMV, portfolio CPI/EAC/SPI, open counts) rather than one row per record —
// same "not filterable" bucket as kpi_strip/risk_exposure/dcma_score (see
// WidgetProps' own filterConditions doc) since there's no raw per-record
// array here to filter.
interface TrendChartPoint { baseline_name: string; baseline_date: string }
interface TrendSeriesDef<T> {
  key: string
  label: string
  getValue: (point: T) => number | null
  // Overrides the default MILESTONE_TREND_COLORS[i] palette pick — for PV/EV/AC
  // Trend below, which needs the industry-standard blue/green/red convention
  // (PMBOK's own Figure 4), not whatever falls out of series order.
  color?: string
}

function BaselineTrendChart<T extends TrendChartPoint>({
  points, series, yTickFormatter, tooltipFormatter, referenceValue,
}: {
  points: T[]
  series: TrendSeriesDef<T>[]
  yTickFormatter?: (v: number) => string
  tooltipFormatter?: (v: number) => string
  referenceValue?: number
}) {
  const sorted = [...points].sort((a, b) => a.baseline_date.localeCompare(b.baseline_date))
  const chartData = sorted.map(p => {
    const row: Record<string, string | number | null> = { label: p.baseline_name }
    for (const s of series) row[s.key] = s.getValue(p)
    return row
  })
  const lastLabel = chartData[chartData.length - 1].label as string
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 10, right: 165, bottom: 10, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={{ stroke: '#d1d5db' }} />
        <YAxis
          tickFormatter={yTickFormatter}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: '#d1d5db' }}
          width={70}
        />
        <Tooltip formatter={(v: number, name: string) => [tooltipFormatter ? tooltipFormatter(v) : v, name]} />
        {referenceValue !== undefined && <ReferenceLine y={referenceValue} stroke="#9ca3af" strokeDasharray="4 4" />}
        {series.map((s, i) => {
          const color = s.color ?? MILESTONE_TREND_COLORS[i % MILESTONE_TREND_COLORS.length]
          return (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, strokeWidth: 0, fill: color }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
              connectNulls
            />
          )
        })}
        {renderTrendEndLabels(
          series
            .map((s, i) => {
              const lastValue = chartData[chartData.length - 1][s.key]
              if (typeof lastValue !== 'number') return null
              return { key: s.key, label: s.label, color: s.color ?? MILESTONE_TREND_COLORS[i % MILESTONE_TREND_COLORS.length], value: lastValue }
            })
            .filter((s): s is TrendEndLabelSpec => s !== null),
          lastLabel,
        )}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function RiskEmvTrendWidget({ projectId }: WidgetProps) {
  const { period, loading: periodLoading } = useActivePeriod(projectId)
  const [points, setPoints] = useState<RiskEmvTrendPoint[] | null>(null)

  useEffect(() => {
    if (!period) return
    let cancelled = false
    getRiskEmvTrend(period.id).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [period?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved Risk Baselines yet) — save at least one Risk Baseline to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[{ key: 'emv', label: 'Open Risk EMV (Cost)', getValue: p => Number(p.emv_cost_total) }]}
      yTickFormatter={v => formatCurrency(v)}
      tooltipFormatter={v => formatCurrency(v)}
    />
  )
}

export function CostCpiTrendWidget({ projectId }: WidgetProps) {
  const { period, loading: periodLoading } = useActivePeriod(projectId)
  const [points, setPoints] = useState<CostPerformanceTrendPoint[] | null>(null)

  useEffect(() => {
    if (!period) return
    let cancelled = false
    getCostPerformanceTrend(period.id).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [period?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved Cost Baselines yet) — save at least one Cost Baseline to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[{ key: 'cpi', label: 'CPI', getValue: p => (p.cpi !== null ? Number(p.cpi) : null) }]}
      yTickFormatter={v => v.toFixed(2)}
      tooltipFormatter={v => v.toFixed(2)}
      referenceValue={1}
    />
  )
}

export function CostEacTrendWidget({ projectId }: WidgetProps) {
  const { period, loading: periodLoading } = useActivePeriod(projectId)
  const [points, setPoints] = useState<CostPerformanceTrendPoint[] | null>(null)

  useEffect(() => {
    if (!period) return
    let cancelled = false
    getCostPerformanceTrend(period.id).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [period?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved Cost Baselines yet) — save at least one Cost Baseline to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[{ key: 'eac', label: 'EAC', getValue: p => (p.eac !== null ? Number(p.eac) : null) }]}
      yTickFormatter={v => formatCurrency(v)}
      tooltipFormatter={v => formatCurrency(v)}
    />
  )
}

export function SpiTrendWidget({ projectId }: WidgetProps) {
  const [points, setPoints] = useState<SpiTrendPoint[] | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    getSpiTrend(projectId).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [projectId])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far — SPI needs a "Capture All Now" Baseline Set (linking a Schedule
        and Cost baseline together) to compute a historical point; save at least one to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[{ key: 'spi', label: 'SPI', getValue: p => (p.spi !== null ? Number(p.spi) : null) }]}
      yTickFormatter={v => v.toFixed(2)}
      tooltipFormatter={v => v.toFixed(2)}
      referenceValue={1}
    />
  )
}

// PV/EV/AC Trend (2026-09-04, per Maro — the classic PMBOK Figure 4 S-curve,
// with baseline captures on the x-axis instead of continuous calendar time).
// Colors match Figure 4's own convention (PV blue, EV green, AC red) via
// BaselineTrendChart's per-series color override above, not whatever falls
// out of series order.
export function PvEvAcTrendWidget({ projectId }: WidgetProps) {
  const [points, setPoints] = useState<PvEvAcTrendPoint[] | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    getPvEvAcTrend(projectId).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [projectId])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far — PV/EV/AC needs a "Capture All Now" Baseline Set (linking a Schedule
        and Cost baseline together) to compute a historical point; save at least one to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[
        { key: 'pv', label: 'Planned Value (PV)', getValue: p => (p.pv !== null ? Number(p.pv) : null), color: '#2563eb' },
        { key: 'ev', label: 'Earned Value (EV)', getValue: p => (p.ev !== null ? Number(p.ev) : null), color: '#16a34a' },
        { key: 'ac', label: 'Actual Cost (AC)', getValue: p => (p.ac !== null ? Number(p.ac) : null), color: '#dc2626' },
      ]}
      yTickFormatter={v => formatCurrency(v)}
      tooltipFormatter={v => formatCurrency(v)}
    />
  )
}

export function IcdOpenItemsTrendWidget({ projectId }: WidgetProps) {
  const { period, loading: periodLoading } = useActivePeriod(projectId)
  const [points, setPoints] = useState<IcdOpenItemsTrendPoint[] | null>(null)

  useEffect(() => {
    if (!period) return
    let cancelled = false
    getIcdOpenItemsTrend(period.id).then(p => { if (!cancelled) setPoints(p) })
    return () => { cancelled = true }
  }, [period?.id])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>
  if (periodLoading || points === null) return <span className="text-xs text-gray-400 dark:text-prosota-muted">Loading…</span>
  if (points.length < 2) {
    return (
      <span className="text-xs text-gray-400 dark:text-prosota-muted">
        Only one data point so far (no saved ICD Baselines yet) — save at least one ICD Baseline to start a trend.
      </span>
    )
  }
  return (
    <BaselineTrendChart
      points={points}
      series={[
        { key: 'issues', label: 'Open Issues', getValue: p => p.open_issues },
        { key: 'changes', label: 'Open Changes', getValue: p => p.open_changes },
        { key: 'decisions', label: 'Open Decisions', getValue: p => p.open_decisions },
      ]}
      yTickFormatter={v => String(Math.round(v))}
      tooltipFormatter={v => String(v)}
    />
  )
}

export function RiskExposureWidget({ data }: WidgetProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data.risk_exposure.map(b => ({ ...b, magnitude: Math.abs(Number(b.emv_cost)) }))}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="band" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(_v, _n, item) => formatCurrency(item.payload.emv_cost)} />
        <Bar dataKey="magnitude">
          {data.risk_exposure.map(b => <Cell key={b.band} fill={RISK_BAND_COLORS[b.band]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function TopRisksWidget({ data, onNavigateToRisks, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  // Filterable (2026-09-02) — recomputed from data.risks (the raw list)
  // rather than data.top_risks (a fixed, unfiltered server-side top-5) so
  // an optional risk_type narrowing can apply before picking the top 5;
  // same rating-desc ordering data.top_risks itself uses server-side
  // (dashboard.py), just reproduced client-side here so filtering doesn't
  // need a second backend field.
  // Filterable on any RiskSummary field (2026-09-02, evaluateDashboardFilter's own (lib/dashboardFilters.ts)
  // header) — e.g. filter={risk_type:'threat'}, {category:'Cost'},
  // {code:'R-004'}, {area:'Site'}, or any combination.
  const topRisks = [...data.risks]
    .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
    .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
    .sort((a, b) => Number(b.rating ?? -1) - Number(a.rating ?? -1))
    .slice(0, 5)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Title</th>
          <th className="py-1.5 pr-2">Status</th>
          <th className="py-1.5 pr-2">Rating</th>
          <th className="py-1.5 pr-2">EMV Cost</th>
          <th className="py-1.5 pr-2">EMV Days</th>
        </tr>
      </thead>
      <tbody>
        {topRisks.map(r => (
          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-prosota-panel2 cursor-pointer" onClick={onNavigateToRisks}>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.code}</td>
            <td className="py-1.5 pr-2">{r.title}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.status}</td>
            <td className="py-1.5 pr-2">{r.rating !== null ? Number(r.rating).toFixed(2) : '—'}</td>
            <td className="py-1.5 pr-2">{r.emv_cost !== null ? formatCurrency(r.emv_cost) : '—'}</td>
            <td className="py-1.5 pr-2">{r.emv_schedule_days !== null ? Number(r.emv_schedule_days).toFixed(1) : '—'}</td>
          </tr>
        ))}
        {topRisks.length === 0 && (
          <tr><td colSpan={6} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No risks yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// --- Batch 1: Schedule-module widgets (2026-07-20) ---
// All read data.schedule_activities — the raw, non-milestone/non-summary
// activity rows dashboard.py's own _schedule_activities exposes for exactly
// this purpose (see that function's docstring). Same "one fetch, many
// views" split as the six widgets above; none of these fetch anything of
// their own.

const FLOAT_BUCKETS: [label: string, min: number, max: number][] = [
  ['0', 0, 0],
  ['1-40', 1, 40],
  ['41-80', 41, 80],
  ['81-160', 81, 160],
  ['>160', 161, Infinity],
]

export function FloatDistributionWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const withFloat = data.schedule_activities
    .filter(a => a.total_float_hours !== null)
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
  const chartData = FLOAT_BUCKETS.map(([label, min, max]) => {
    const ids = withFloat.filter(a => {
      const f = Number(a.total_float_hours)
      return f >= min && f <= max
    }).map(a => a.id)
    return { label, count: ids.length, ids }
  })
  const click = activityClick
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} label={{ value: 'Total float (hours)', position: 'insideBottom', offset: -5, fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#2563eb"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids, crossFilter, onCrossFilterClick).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => (
            <Cell key={i} fill={click(bucket.ids, crossFilter, onCrossFilterClick).selected ? '#d97706' : '#2563eb'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ActivitiesByCategoryWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByCategory = new Map<string, string[]>()
  for (const a of data.schedule_activities) {
    if (!evaluateDashboardFilter(a, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(a.id, 'activity', crossFilter)) continue
    const key = a.schedule_category ?? 'Unspecified'
    if (!idsByCategory.has(key)) idsByCategory.set(key, [])
    idsByCategory.get(key)!.push(a.id)
  }
  const chartData = [...idsByCategory.entries()]
    .map(([category, ids]) => ({ category, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const click = activityClick
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#0891b2"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids, crossFilter, onCrossFilterClick).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => (
            <Cell key={i} fill={click(bucket.ids, crossFilter, onCrossFilterClick).selected ? '#d97706' : '#0891b2'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BaselineVarianceTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any ScheduleActivitySummary field (2026-09-02,
  // evaluateDashboardFilter's own header (lib/dashboardFilters.ts)) — applied before the top-10-by-variance
  // slice below, same "specific-entity filter guarantees inclusion
  // regardless of ranking" fix TopRisksWidget already needed, e.g. a
  // single {code:'T-0074'} would otherwise silently vanish if that
  // activity's own variance isn't in the top 10.
  const ranked = data.schedule_activities
    .filter(a => a.variance_days !== null && a.variance_days !== 0)
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
    .sort((a, b) => Math.abs(b.variance_days!) - Math.abs(a.variance_days!))
    .slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Activity</th>
          <th className="py-1.5 pr-2">Baseline Finish</th>
          <th className="py-1.5 pr-2">Current Finish</th>
          <th className="py-1.5 pr-2">Variance</th>
        </tr>
      </thead>
      <tbody>
        {ranked.map(a => {
          const click = activityClick([a.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={a.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
              <td className="py-1.5 pr-2">{a.task_name}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.bl_finish)}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
              <td className={`py-1.5 pr-2 font-medium ${a.variance_days! > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600'}`}>
                {a.variance_days! > 0 ? `+${a.variance_days}` : a.variance_days}d
              </td>
            </tr>
          )
        })}
        {ranked.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No baseline variance yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function MilestonesTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any MilestoneTimelineItem field (2026-09-02, evaluateDashboardFilter's
  // own header) — e.g. a specific milestone by {id:'<real uuid>'}.
  const milestones = data.milestones
    .filter(m => evaluateDashboardFilter(m, filterConditions, filterMatchMode))
    .filter(m => matchesCrossFilter(m.id, 'activity', crossFilter))
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Milestone</th>
          <th className="py-1.5 pr-2">Baseline Finish</th>
          <th className="py-1.5 pr-2">Current Finish</th>
          <th className="py-1.5 pr-2">Variance</th>
        </tr>
      </thead>
      <tbody>
        {milestones.map(m => {
          const click = activityClick([m.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={m.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2">{m.task_name}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(m.bl_finish)}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(m.finish)}</td>
              <td className={`py-1.5 pr-2 font-medium ${m.variance_days !== null && m.variance_days > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>
                {m.variance_days === null ? '—' : m.variance_days > 0 ? `+${m.variance_days}d` : `${m.variance_days}d`}
              </td>
            </tr>
          )
        })}
        {milestones.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No milestones yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function CriticalActivitiesTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any ScheduleActivitySummary field (2026-09-02,
  // evaluateDashboardFilter's own header (lib/dashboardFilters.ts)), on top of the existing is_critical filter.
  const critical = data.schedule_activities
    .filter(a => a.is_critical === true)
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Activity</th>
          <th className="py-1.5 pr-2">Finish</th>
          <th className="py-1.5 pr-2">% Complete</th>
        </tr>
      </thead>
      <tbody>
        {critical.map(a => {
          const click = activityClick([a.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={a.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
              <td className="py-1.5 pr-2">{a.task_name}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
              <td className="py-1.5 pr-2">{a.pct_complete !== null ? `${Number(a.pct_complete).toFixed(0)}%` : '—'}</td>
            </tr>
          )
        })}
        {critical.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No critical activities.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// --- Batch 2: Risk-module widgets (2026-07-20) ---
// All read data.risks — the raw per-risk rows dashboard.py's own
// _risk_summaries exposes for exactly this purpose (see that function's
// docstring). Same "one fetch, many views" split as the Schedule widgets
// above; none of these fetch anything of their own.

export function RisksByCategoryWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByCategory = new Map<string, string[]>()
  for (const r of data.risks) {
    if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
    const key = r.category ?? 'Uncategorised'
    if (!idsByCategory.has(key)) idsByCategory.set(key, [])
    idsByCategory.get(key)!.push(r.id)
  }
  const chartData = [...idsByCategory.entries()]
    .map(([category, ids]) => ({ category, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const click = (ids: string[]) => recordClick('risk', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#7c3aed"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#7c3aed'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RisksByOwnerWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByOwner = new Map<string, string[]>()
  for (const r of data.risks) {
    if (r.status === 'closed') continue
    if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
    const key = r.risk_owner ?? 'Unassigned'
    if (!idsByOwner.has(key)) idsByOwner.set(key, [])
    idsByOwner.get(key)!.push(r.id)
  }
  const chartData = [...idsByOwner.entries()]
    .map(([owner, ids]) => ({ owner, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const click = (ids: string[]) => recordClick('risk', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#d97706"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#7c3aed' : '#d97706'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ThreatsVsOpportunitiesWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // emv_cost is signed (threats negative, opportunities positive — see
  // RiskExposureWidget's own note) — magnitude is what's worth comparing
  // here, the sign is already implied by which bar it is.
  const open = data.risks
    .filter(r => r.status !== 'closed')
    .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
    .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
  const threats = open.filter(r => r.risk_type === 'threat')
  const opportunities = open.filter(r => r.risk_type === 'opportunity')
  const chartData = [
    { type: 'Threats', exposure: threats.reduce((sum, r) => sum + Math.abs(Number(r.emv_cost ?? 0)), 0), count: threats.length, ids: threats.map(r => r.id) },
    { type: 'Opportunities', exposure: opportunities.reduce((sum, r) => sum + Number(r.emv_cost ?? 0), 0), count: opportunities.length, ids: opportunities.map(r => r.id) },
  ]
  const click = (ids: string[]) => recordClick('risk', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="type" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v: number, _n, item) => `${formatCurrency(v)} (${item.payload.count} risks)`} />
        <Bar
          dataKey="exposure"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => (
            <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : i === 0 ? '#dc2626' : '#16a34a'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ResponseStrategyBreakdownWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByStrategy = new Map<string, string[]>()
  for (const r of data.risks) {
    if (r.status === 'closed') continue
    if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
    const key = r.response_strategy ?? 'Not set'
    if (!idsByStrategy.has(key)) idsByStrategy.set(key, [])
    idsByStrategy.get(key)!.push(r.id)
  }
  const chartData = [...idsByStrategy.entries()].map(([strategy, ids]) => ({ strategy, count: ids.length, ids })).sort((a, b) => b.count - a.count)
  const click = (ids: string[]) => recordClick('risk', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="strategy" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#0891b2"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#0891b2'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RiskRegisterTableWidget({ data, onNavigateToRisks, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  // Filterable (2026-09-02) — risk_type/category narrowing on top of the
  // existing open-only filter, e.g. "Cost risks only" or "opportunities only".
  // Filterable on any RiskSummary field, on top of the existing open-only
  // filter (2026-09-02, evaluateDashboardFilter's own header (lib/dashboardFilters.ts)).
  const open = data.risks
    .filter(r => r.status !== 'closed')
    .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
    .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
    .sort((a, b) => Number(b.rating ?? -1) - Number(a.rating ?? -1))
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Title</th>
          <th className="py-1.5 pr-2">Category</th>
          <th className="py-1.5 pr-2">Owner</th>
          <th className="py-1.5 pr-2">Rating</th>
          <th className="py-1.5 pr-2">EMV Cost</th>
        </tr>
      </thead>
      <tbody>
        {open.map(r => (
          <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 dark:hover:bg-prosota-panel2 cursor-pointer" onClick={onNavigateToRisks}>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.code}</td>
            <td className="py-1.5 pr-2">{r.title}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.category ?? '—'}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.risk_owner ?? '—'}</td>
            <td className="py-1.5 pr-2">{r.rating !== null ? Number(r.rating).toFixed(2) : '—'}</td>
            <td className="py-1.5 pr-2">{r.emv_cost !== null ? formatCurrency(r.emv_cost) : '—'}</td>
          </tr>
        ))}
        {open.length === 0 && (
          <tr><td colSpan={6} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No open risks.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// --- Batch 3: Cost-module widgets (2026-07-20) ---
// All read data.cost_elements — the raw per-element rows dashboard.py's own
// _cost_element_summaries exposes (bac/ac already resolved to
// computed_budget/computed_actuals for a percentage element, see that
// function's docstring) for exactly this purpose. Same "one fetch, many
// views" split as the Schedule/Risk widgets above.

export function CostBreakdownByGroupWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const totalsByGroup = new Map<string, { bac: number; ids: string[] }>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
    const key = el.element_group ?? 'Ungrouped'
    const entry = totalsByGroup.get(key) ?? { bac: 0, ids: [] }
    entry.bac += Number(el.bac)
    entry.ids.push(el.id)
    totalsByGroup.set(key, entry)
  }
  const chartData = [...totalsByGroup.entries()]
    .map(([group, v]) => ({ group, bac: v.bac, ids: v.ids }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 10)
  const click = (ids: string[]) => recordClick('cost_element', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="group" tick={{ fontSize: 11 }} width={100} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar
          dataKey="bac"
          fill="#2563eb"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#2563eb'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CostBreakdownByOwnerWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const totalsByOwner = new Map<string, { bac: number; ids: string[] }>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
    const key = el.cost_owner ?? 'Unassigned'
    const entry = totalsByOwner.get(key) ?? { bac: 0, ids: [] }
    entry.bac += Number(el.bac)
    entry.ids.push(el.id)
    totalsByOwner.set(key, entry)
  }
  const chartData = [...totalsByOwner.entries()]
    .map(([owner, v]) => ({ owner, bac: v.bac, ids: v.ids }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 10)
  const click = (ids: string[]) => recordClick('cost_element', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar
          dataKey="bac"
          fill="#d97706"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#2563eb' : '#d97706'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BudgetUtilisationWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const withBac = data.cost_elements
    .filter(el => el.bac !== null)
    .filter(el => evaluateDashboardFilter(el, filterConditions, filterMatchMode))
    .filter(el => matchesCrossFilter(el.id, 'cost_element', crossFilter))
  const bacTotal = withBac.reduce((sum, el) => sum + Number(el.bac), 0)
  const acTotal = withBac.reduce((sum, el) => sum + Number(el.ac ?? 0), 0)
  const pct = bacTotal > 0 ? Math.round((acTotal / bacTotal) * 100) : 0
  return (
    <div className="h-full flex flex-col justify-center gap-2">
      <div className="flex justify-between text-xs text-gray-500 dark:text-prosota-muted">
        <span>Actuals spent</span>
        <span className="font-medium text-gray-900 dark:text-prosota-paper">{pct}%</span>
      </div>
      <div className="h-3 bg-gray-100 dark:bg-prosota-panel2 rounded-full overflow-hidden">
        <div className={`h-full ${pct > 100 ? 'bg-red-500' : pct > 85 ? 'bg-amber-500' : 'bg-green-500'}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex justify-between text-xs text-gray-400 dark:text-prosota-muted">
        <span>{formatCurrency(acTotal)}</span>
        <span>{formatCurrency(bacTotal)}</span>
      </div>
    </div>
  )
}

export function BacVsEacByGroupWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const groups = new Map<string, { bac: number; eac: number; ids: string[] }>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
    const key = el.element_group ?? 'Ungrouped'
    const entry = groups.get(key) ?? { bac: 0, eac: 0, ids: [] }
    entry.bac += Number(el.bac)
    entry.eac += Number(el.eac ?? el.bac)
    entry.ids.push(el.id)
    groups.set(key, entry)
  }
  const chartData = [...groups.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 8)
  const click = (ids: string[]) => recordClick('cost_element', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="group" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar
          dataKey="bac" name="Budget" fill="#94a3b8"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#94a3b8'} />)}
        </Bar>
        <Bar
          dataKey="eac" name="Forecast (EAC)" fill="#dc2626"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#dc2626'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CostElementsTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable (2026-09-02) — narrow to one cost group, e.g. "Prelims only".
  // Filterable on any CostElementSummary field (2026-09-02, evaluateDashboardFilter's
  // own header) — e.g. filter={element_group:'Prelims'} or {code:'C-012'}.
  const rows = data.cost_elements
    .filter(el => evaluateDashboardFilter(el, filterConditions, filterMatchMode))
    .filter(el => matchesCrossFilter(el.id, 'cost_element', crossFilter))
    .sort((a, b) => Number(b.bac ?? 0) - Number(a.bac ?? 0))
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Description</th>
          <th className="py-1.5 pr-2">Budget</th>
          <th className="py-1.5 pr-2">Actuals</th>
          <th className="py-1.5 pr-2">CPI</th>
          <th className="py-1.5 pr-2">EAC</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(el => {
          const click = recordClick('cost_element', [el.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={el.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{el.code}</td>
              <td className="py-1.5 pr-2">{el.description}</td>
              <td className="py-1.5 pr-2">{el.bac !== null ? formatCurrency(el.bac) : '—'}</td>
              <td className="py-1.5 pr-2">{el.ac !== null ? formatCurrency(el.ac) : '—'}</td>
              <td className={`py-1.5 pr-2 ${el.cpi !== null && Number(el.cpi) < 1 ? 'text-orange-600' : ''}`}>
                {el.cpi !== null ? Number(el.cpi).toFixed(2) : '—'}
              </td>
              <td className="py-1.5 pr-2">{el.eac !== null ? formatCurrency(el.eac) : '—'}</td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={6} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No cost elements yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// --- Batch 4: Issues/Changes/Decisions widgets (2026-07-20) ---
// All read data.icd_items — the raw rows dashboard.py's own
// _icd_item_summaries exposes from the one shared IcdItem table (issue/
// change/decision discriminated by item_type — see that model's own
// docstring), same "one fetch, many views" split as every widget batch
// above.

function daysBetween(from: string, to: Date): number {
  return Math.floor((to.getTime() - new Date(from).getTime()) / 86_400_000)
}

export function IssuesByStatusWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByStatus = new Map<string, string[]>()
  for (const i of data.icd_items) {
    if (i.item_type !== 'issue') continue
    if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
    if (!idsByStatus.has(i.status)) idsByStatus.set(i.status, [])
    idsByStatus.get(i.status)!.push(i.id)
  }
  const chartData = [...idsByStatus.entries()].map(([status, ids]) => ({ status, count: ids.length, ids }))
  const click = (ids: string[]) => recordClick('icd_item', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#dc2626"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#dc2626'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function IssuesAgeingTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const now = new Date()
  const rows = data.icd_items
    .filter(i => i.item_type === 'issue' && i.status !== 'closed' && i.raised_date !== null)
    .filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode))
    .filter(i => matchesCrossFilter(i.id, 'icd_item', crossFilter))
    .map(i => ({ ...i, daysOpen: daysBetween(i.raised_date!, now) }))
    .sort((a, b) => b.daysOpen - a.daysOpen)
    .slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Issue</th>
          <th className="py-1.5 pr-2">Owner</th>
          <th className="py-1.5 pr-2">Severity</th>
          <th className="py-1.5 pr-2">Days Open</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(i => {
          const click = recordClick('icd_item', [i.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={i.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.code}</td>
              <td className="py-1.5 pr-2">{i.title}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.owner ?? '—'}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.severity ?? '—'}</td>
              <td className={`py-1.5 pr-2 font-medium ${i.daysOpen > 30 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>{i.daysOpen}</td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No open issues.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function OpenItemsByOwnerWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any IcdItemSummary field (2026-09-02, evaluateDashboardFilter's
  // own header) — e.g. filter={item_type:'issue'} or {code:'I-014'}.
  const idsByOwner = new Map<string, string[]>()
  for (const i of data.icd_items) {
    if (i.status === 'closed') continue
    if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
    const key = i.owner ?? 'Unassigned'
    if (!idsByOwner.has(key)) idsByOwner.set(key, [])
    idsByOwner.get(key)!.push(i.id)
  }
  const chartData = [...idsByOwner.entries()]
    .map(([owner, ids]) => ({ owner, count: ids.length, ids }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  const click = (ids: string[]) => recordClick('icd_item', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#0891b2"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#0891b2'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DecisionsPendingTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const now = new Date()
  const rows = data.icd_items
    .filter(i => i.item_type === 'decision' && i.status !== 'closed')
    .filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode))
    .filter(i => matchesCrossFilter(i.id, 'icd_item', crossFilter))
    .sort((a, b) => {
      if (a.required_by === null) return 1
      if (b.required_by === null) return -1
      return new Date(a.required_by).getTime() - new Date(b.required_by).getTime()
    })
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Decision</th>
          <th className="py-1.5 pr-2">Decision Maker</th>
          <th className="py-1.5 pr-2">Required By</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(i => {
          const overdue = i.required_by !== null && new Date(i.required_by) < now
          const click = recordClick('icd_item', [i.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={i.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.code}</td>
              <td className="py-1.5 pr-2">{i.title}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.decision_maker ?? '—'}</td>
              <td className={`py-1.5 pr-2 font-medium ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>
                {formatDate(i.required_by)}{overdue ? ' (overdue)' : ''}
              </td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No pending decisions.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function ChangesByCcbDecisionWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByDecision = new Map<string, string[]>()
  for (const i of data.icd_items) {
    if (i.item_type !== 'change') continue
    if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
    const key = i.ccb_decision ?? 'Pending'
    if (!idsByDecision.has(key)) idsByDecision.set(key, [])
    idsByDecision.get(key)!.push(i.id)
  }
  const chartData = [...idsByDecision.entries()].map(([decision, ids]) => ({ decision, count: ids.length, ids }))
  const click = (ids: string[]) => recordClick('icd_item', ids, crossFilter, onCrossFilterClick)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="decision" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          fill="#7c3aed"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids).onClick?.() : undefined}
        >
          {chartData.map((bucket, i) => <Cell key={i} fill={click(bucket.ids).selected ? '#d97706' : '#7c3aed'} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// --- Batch 5: Resources-module widgets (2026-07-20) ---
// All read data.resource_assignments — the raw, denormalized-and-costed
// rows dashboard.py's own _resource_assignment_summaries exposes (budget
// via resource_costing.compute_assignment_budget, the same formula the
// Resources tab and Cost Plan sync already use — see that function's
// docstring), same "one fetch, many views" split as every batch above.

function sumBudgetBy(assignments: ResourceAssignmentSummary[], keyOf: (a: ResourceAssignmentSummary) => string) {
  const totals = new Map<string, number>()
  for (const a of assignments) {
    const key = keyOf(a)
    totals.set(key, (totals.get(key) ?? 0) + Number(a.budget))
  }
  return [...totals.entries()].map(([key, budget]) => ({ key, budget })).sort((a, b) => b.budget - a.budget)
}

export function ResourceBudgetByTypeWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const filtered = data.resource_assignments
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
  const chartData = sumBudgetBy(filtered, a => a.resource_type)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="key" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="budget" fill="#2563eb" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ResourceBudgetByDisciplineWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const filtered = data.resource_assignments
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
  const chartData = sumBudgetBy(filtered, a => a.discipline ?? 'Unspecified').slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="key" tick={{ fontSize: 11 }} width={100} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="budget" fill="#0891b2" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ResourceBudgetByCompanyWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const filtered = data.resource_assignments
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
  const chartData = sumBudgetBy(filtered, a => a.company ?? 'Unassigned').slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="key" tick={{ fontSize: 11 }} width={100} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="budget" fill="#d97706" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ResourceAssignmentsTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any ResourceAssignmentSummary field (2026-09-02,
  // evaluateDashboardFilter's own header (lib/dashboardFilters.ts)) — e.g. filter={resource_type:'labour'} or
  // {resource_name:'Concrete Finishing Crew'} (a real gap Poe hit live:
  // could only offer a resource_type slice before this, no way to narrow
  // to one named resource specifically).
  const rows = data.resource_assignments
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
    .sort((a, b) => Number(b.budget) - Number(a.budget))
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Resource</th>
          <th className="py-1.5 pr-2">Role</th>
          <th className="py-1.5 pr-2">Activity</th>
          <th className="py-1.5 pr-2">Budget</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(a => {
          // Seeds the ACTIVITY it's assigned to, not the assignment itself
          // (2026-09-07) — an assignment isn't one of the four cross-filter
          // kinds, but "narrow everything to this row's activity" is the
          // natural click here, same as any other activity-keyed source.
          const click = recordClick('activity', [a.activity_id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={a.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2">{a.resource_name}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.role ?? '—'}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.activity_task_name}</td>
              <td className="py-1.5 pr-2">{formatCurrency(a.budget)}</td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No resource assignments yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function TopResourcesByBudgetWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const byResource = new Map<string, { type: string; budget: number; activityCount: number }>()
  for (const a of data.resource_assignments) {
    if (!evaluateDashboardFilter(a, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(a.activity_id, 'activity', crossFilter)) continue
    const entry = byResource.get(a.resource_name) ?? { type: a.resource_type, budget: 0, activityCount: 0 }
    entry.budget += Number(a.budget)
    entry.activityCount += 1
    byResource.set(a.resource_name, entry)
  }
  const rows = [...byResource.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.budget - a.budget)
    .slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Resource</th>
          <th className="py-1.5 pr-2">Type</th>
          <th className="py-1.5 pr-2">Activities</th>
          <th className="py-1.5 pr-2">Total Budget</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.name} className="border-b border-gray-50">
            <td className="py-1.5 pr-2">{r.name}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.type}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.activityCount}</td>
            <td className="py-1.5 pr-2 font-medium">{formatCurrency(r.budget)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No resource assignments yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// --- Batch 6: quick-win widgets (2026-07-20) ---
// Per WIDGET_LIBRARY_PLAN.md §E.1 — reuse of already-existing, already-
// tested backend capability (DCMA quality, Clash Detective) plus pure math
// on numbers the dashboard already fetches (EAC formulas, EVM thresholds,
// float bands). None of these needed new data-modelling decisions, unlike
// §E.2/E.3's gaps.

export function DcmaScoreWidget({ data }: WidgetProps) {
  const { dcma_quality } = data
  const grade = dcma_quality.logic_score === null ? '—'
    : dcma_quality.logic_score >= 90 ? 'Good'
    : dcma_quality.logic_score >= 70 ? 'Fair'
    : 'Poor'
  return (
    <div className="h-full flex flex-col justify-center gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-prosota-paper">
          {dcma_quality.passing_count}/{dcma_quality.total_checks}
        </span>
        <span className="text-sm text-gray-500 dark:text-prosota-muted">Grade: {grade}</span>
      </div>
      <div className="text-xs text-gray-400 dark:text-prosota-muted">
        {dcma_quality.scope_name ? `Scope: ${dcma_quality.scope_name} · ` : ''}
        {dcma_quality.activity_count} activities analyzed
      </div>
      <div className="flex gap-3 text-xs mt-1">
        <span className="text-red-600 dark:text-red-400">{dcma_quality.failing_count} failing</span>
        <span className="text-amber-600">{dcma_quality.warning_count} warning</span>
        <span className="text-green-600">{dcma_quality.passing_count} passing</span>
      </div>
    </div>
  )
}

export function ClashSummaryWidget({ data }: WidgetProps) {
  const { clash_summary } = data
  return (
    <div className="h-full flex flex-col gap-2 overflow-auto">
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900 dark:text-prosota-paper">{clash_summary.total_clashes}</span>
        <span className="text-xs text-gray-400 dark:text-prosota-muted">across {clash_summary.test_count} clash test{clash_summary.test_count === 1 ? '' : 's'}</span>
      </div>
      <div className="flex gap-3 text-xs">
        <span className="text-red-600 dark:text-red-400">{clash_summary.new_count} new</span>
        <span className="text-amber-600">{clash_summary.reviewed_count} reviewed</span>
        <span className="text-green-600">{clash_summary.approved_count} approved</span>
      </div>
      {clash_summary.by_test.length > 0 && (
        <table className="w-full text-xs mt-1">
          <thead>
            <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
              <th className="py-1 pr-2">Test</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Total</th>
              <th className="py-1 pr-2">New</th>
              <th className="py-1 pr-2">Reviewed</th>
              <th className="py-1 pr-2">Approved</th>
            </tr>
          </thead>
          <tbody>
            {clash_summary.by_test.map(t => (
              <tr key={t.test_id} className="border-b border-gray-50">
                <td className="py-1 pr-2">{t.test_name}</td>
                <td className="py-1 pr-2 text-gray-500 dark:text-prosota-muted">{t.test_type}</td>
                <td className="py-1 pr-2">{t.total}</td>
                <td className="py-1 pr-2 text-red-600 dark:text-red-400">{t.new_count}</td>
                <td className="py-1 pr-2 text-amber-600">{t.reviewed_count}</td>
                <td className="py-1 pr-2 text-green-600">{t.approved_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function ClashDetailTableWidget({ data, filterConditions, filterMatchMode }: WidgetProps) {
  const rows = data.clash_pairs
    .filter(p => evaluateDashboardFilter(p, filterConditions, filterMatchMode))
    .sort((a, b) => {
    // Unreviewed clashes first (new, then reviewed, then approved), same
    // priority Navisworks-style triage would use — worst-first, not
    // alphabetical or insertion order.
    const rank = { new: 0, reviewed: 1, approved: 2 }
    return rank[a.status] - rank[b.status]
  })
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Test</th>
          <th className="py-1.5 pr-2">Element A</th>
          <th className="py-1.5 pr-2">Element B</th>
          <th className="py-1.5 pr-2">Distance</th>
          <th className="py-1.5 pr-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(p => (
          <tr key={p.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{p.test_name}</td>
            <td className="py-1.5 pr-2">{p.element_a_label}</td>
            <td className="py-1.5 pr-2">{p.element_b_label}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{p.distance_mm !== null ? `${p.distance_mm.toFixed(0)}mm` : '—'}</td>
            <td className="py-1.5 pr-2">
              <span className={`px-1.5 py-0.5 rounded text-xs ${
                p.status === 'new' ? 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400' : p.status === 'reviewed' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400' : 'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-400'
              }`}>
                {p.status}
              </span>
            </td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No clashes recorded yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function EacForecastComparisonWidget({ data }: WidgetProps) {
  const { kpis } = data
  const rows: [string, string | null, string][] = [
    ['EAC = BAC / CPI', kpis.eac, 'Past CPI continues'],
    ['EAC = AC + (BAC-EV)', kpis.eac_remaining_at_plan, 'Remaining work at plan rate'],
    ['EAC = AC + (BAC-EV)/(SPI×CPI)', kpis.eac_composite, 'Composite SPI x CPI'],
    ['EAC = AC + remaining cost for activity', kpis.eac_bottom_up, 'Bottom-up, from P6 remaining duration'],
  ]
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Method</th>
          <th className="py-1.5 pr-2">EAC</th>
          <th className="py-1.5 pr-2">Assumption</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([method, value, assumption]) => (
          <tr key={method} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 font-mono text-gray-600 dark:text-prosota-muted">{method}</td>
            <td className="py-1.5 pr-2 font-medium">{value !== null ? formatCurrency(value) : '—'}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{assumption}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function EarnedValueSummaryTableWidget({ data }: WidgetProps) {
  const { kpis } = data
  const spi = kpis.schedule_spi !== null ? Number(kpis.schedule_spi) : null
  const cpi = kpis.cpi !== null ? Number(kpis.cpi) : null
  const rows: [string, string, boolean | null][] = [
    ['BAC (Budget)', kpis.bac !== null ? formatCurrency(kpis.bac) : '—', null],
    ['SPI', spi !== null ? spi.toFixed(2) : '—', spi !== null ? spi >= 1 : null],
    ['CPI', cpi !== null ? cpi.toFixed(2) : '—', cpi !== null ? cpi >= 1 : null],
    ['EAC (Forecast)', kpis.eac !== null ? formatCurrency(kpis.eac) : '—', kpis.eac !== null && kpis.bac !== null ? Number(kpis.eac) <= Number(kpis.bac) : null],
  ]
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Metric</th>
          <th className="py-1.5 pr-2">Value</th>
          <th className="py-1.5 pr-2">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([metric, value, ok]) => (
          <tr key={metric} className="border-b border-gray-50">
            <td className="py-1.5 pr-2">{metric}</td>
            <td className="py-1.5 pr-2 font-medium">{value}</td>
            <td className="py-1.5 pr-2">{ok === null ? '—' : ok ? '✅' : '❌'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function NearCriticalWatchListWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  // Filterable on any ScheduleActivitySummary field (2026-09-02,
  // evaluateDashboardFilter's own header (lib/dashboardFilters.ts)), applied before the top-10-by-float
  // slice — same "specific-entity filter guarantees inclusion" reasoning
  // as BaselineVarianceTableWidget above.
  const rows = data.schedule_activities
    .filter(a => a.total_float_hours !== null && Number(a.total_float_hours) > 0 && Number(a.total_float_hours) <= 80)
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
    .sort((a, b) => Number(a.total_float_hours) - Number(b.total_float_hours))
    .slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Activity</th>
          <th className="py-1.5 pr-2">Total Float (h)</th>
          <th className="py-1.5 pr-2">Finish</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(a => {
          const click = activityClick([a.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={a.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
              <td className="py-1.5 pr-2">{a.task_name}</td>
              <td className="py-1.5 pr-2 font-medium text-amber-600">{Number(a.total_float_hours).toFixed(1)}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No near-critical activities.</td></tr>
        )}
      </tbody>
    </table>
  )
}

const ACTIVITY_STATUS_COLORS: Record<string, string> = {
  'Not Started': '#9ca3af', 'In Progress': '#2563eb', 'Complete': '#16a34a', 'Suspended': '#d97706',
}

export function ActivityStatusWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const idsByStatus: Record<string, string[]> = { 'Not Started': [], 'In Progress': [], 'Complete': [], 'Suspended': [] }
  for (const a of data.schedule_activities) {
    if (!evaluateDashboardFilter(a, filterConditions, filterMatchMode)) continue
    if (!matchesCrossFilter(a.id, 'activity', crossFilter)) continue
    const pct = a.pct_complete !== null ? Number(a.pct_complete) : 0
    if (a.suspend_date !== null && a.resume_date === null) idsByStatus.Suspended.push(a.id)
    else if (pct >= 100) idsByStatus.Complete.push(a.id)
    else if (pct > 0) idsByStatus['In Progress'].push(a.id)
    else idsByStatus['Not Started'].push(a.id)
  }
  const chartData = Object.entries(idsByStatus).map(([status, ids]) => ({ status, count: ids.length, ids }))
  const click = activityClick
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar
          dataKey="count"
          cursor={onCrossFilterClick ? 'pointer' : undefined}
          onClick={onCrossFilterClick ? (entry: { ids: string[] }) => click(entry.ids, crossFilter, onCrossFilterClick).onClick?.() : undefined}
        >
          {chartData.map(d => (
            <Cell key={d.status} fill={ACTIVITY_STATUS_COLORS[d.status]} stroke={click(d.ids, crossFilter, onCrossFilterClick).selected ? '#d97706' : undefined} strokeWidth={click(d.ids, crossFilter, onCrossFilterClick).selected ? 3 : 0} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ProjectInfoWidget({ data }: WidgetProps) {
  const { kpis, project_info } = data
  const rows: [string, React.ReactNode][] = [
    ['Plan Start', formatDate(kpis.plan_start)],
    ['Planned Finish', formatDate(kpis.planned_finish)],
    ['Data Date', formatDate(project_info.data_date)],
    ['Total Activities', project_info.total_activities],
    ['Relationships', project_info.total_relationships],
    ['Resources', project_info.total_resources],
    ['Baseline', project_info.has_baseline ? 'Yes' : 'No'],
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 h-full overflow-auto">
      {rows.map(([label, value]) => (
        <div key={label}>
          <div className="text-xs text-gray-400 dark:text-prosota-muted uppercase tracking-wide mb-1">{label}</div>
          <div className="text-sm font-semibold text-gray-900 dark:text-prosota-paper">{value}</div>
        </div>
      ))}
    </div>
  )
}

// --- Batch 7: 4D-module widgets (2026-07-20) ---
// Unlike every widget above, these don't read `data` (DashboardOverviewResponse)
// at all — Camera Views/4D Video are 4D-module data, a genuinely different
// source, so each fetches its own list via projectId. Per Maro: selecting a
// camera view shows a plain, non-interactive static image (never a live
// viewport — sidesteps the open question of whether the 4D Three.js/WebGL
// viewer can run as several simultaneously-mounted dashboard tiles).

export function CameraViewGalleryWidget({ projectId }: WidgetProps) {
  const [views, setViews] = useState<CameraView[]>([])
  const [selectedId, setSelectedId] = useState<string>('')

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    listCameraViews(projectId).then(v => { if (!cancelled) { setViews(v); setSelectedId(prev => prev || v[0]?.id || '') } })
    return () => { cancelled = true }
  }, [projectId])

  const selected = views.find(v => v.id === selectedId) ?? null

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>

  return (
    <div className="h-full flex flex-col gap-2">
      <select
        className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1 text-xs"
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
      >
        {views.length === 0 && <option value="">No saved camera views</option>}
        {views.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div className="flex-1 min-h-0 bg-gray-50 dark:bg-prosota-panel2 rounded-md overflow-hidden flex items-center justify-center">
        {selected?.thumbnail_data_url ? (
          <img src={selected.thumbnail_data_url} alt={selected.name} className="max-w-full max-h-full object-contain" />
        ) : (
          <span className="text-xs text-gray-400 dark:text-prosota-muted px-4 text-center">
            {selected ? 'No thumbnail saved — reopen the 4D module and re-save this view.' : 'Save a Camera View in the 4D module to see it here.'}
          </span>
        )}
      </div>
    </div>
  )
}

export function FourDVideoGalleryWidget({ projectId }: WidgetProps) {
  const [videos, setVideos] = useState<FourDVideo[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    listFourDVideos(projectId).then(v => { if (!cancelled) { setVideos(v); setSelectedId(prev => prev || v[0]?.id || '') } })
    return () => { cancelled = true }
  }, [projectId])

  // Fetched as an authenticated Blob (see fourDVideos.ts's own comment on
  // why a plain <video src> can't hit this backend directly), turned into
  // an object URL for playback — revoked whenever the selection changes or
  // this widget unmounts, so switching between videos doesn't leak one
  // object URL per selection made.
  useEffect(() => {
    if (!selectedId) { setVideoUrl(null); return }
    let cancelled = false
    setError(null)
    downloadFourDVideo(selectedId)
      .then(blob => { if (!cancelled) setVideoUrl(URL.createObjectURL(blob)) })
      .catch(() => { if (!cancelled) setError('Failed to load video.') })
    return () => { cancelled = true }
  }, [selectedId])

  useEffect(() => {
    return () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }
  }, [videoUrl])

  if (!projectId) return <span className="text-xs text-gray-400 dark:text-prosota-muted">No project selected.</span>

  return (
    <div className="h-full flex flex-col gap-2">
      <select
        className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1 text-xs"
        value={selectedId}
        onChange={e => setSelectedId(e.target.value)}
      >
        {videos.length === 0 && <option value="">No saved 4D videos</option>}
        {videos.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      <div className="flex-1 min-h-0 bg-gray-50 dark:bg-prosota-panel2 rounded-md overflow-hidden flex items-center justify-center">
        {error ? (
          <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
        ) : videoUrl ? (
          <video src={videoUrl} controls className="max-w-full max-h-full" />
        ) : (
          <span className="text-xs text-gray-400 dark:text-prosota-muted px-4 text-center">
            {videos.length === 0 ? 'Export a 4D video from the 4D module to see it here.' : 'Loading…'}
          </span>
        )}
      </div>
    </div>
  )
}

// --- Batch 8: more Tier-1 quick wins (2026-07-20) ---

export function LookaheadPlannerWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const [windowWeeks, setWindowWeeks] = useState<2 | 4 | 6>(4)
  const now = new Date()
  const cutoff = new Date(now.getTime() + windowWeeks * 7 * 86_400_000)
  // Sub-filters the same 6-week fetch rather than three separate ones —
  // same "one fetch, many views" split every other batch uses.
  const rows = data.lookahead_items
    .filter(i => i.start !== null && new Date(i.start) <= cutoff)
    .filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode))
    .filter(i => matchesCrossFilter(i.id, 'activity', crossFilter))
    .sort((a, b) => new Date(a.start!).getTime() - new Date(b.start!).getTime())
  const { lookahead_summary: s } = data
  return (
    <div className="h-full flex flex-col gap-2">
      <div className="flex gap-1">
        {([2, 4, 6] as const).map(w => (
          <button
            key={w}
            onClick={() => setWindowWeeks(w)}
            className={`text-xs px-2 py-0.5 rounded border ${windowWeeks === w ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2'}`}
          >
            {w}-Week
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Activity</th>
              <th className="py-1.5 pr-2">Start</th>
              <th className="py-1.5 pr-2">% Complete</th>
              <th className="py-1.5 pr-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(i => (
              <tr key={i.id} className="border-b border-gray-50">
                <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.code}</td>
                <td className="py-1.5 pr-2">{i.task_name}</td>
                <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(i.start)}</td>
                <td className="py-1.5 pr-2">{i.pct_complete !== null ? `${Number(i.pct_complete).toFixed(0)}%` : '—'}</td>
                <td className="py-1.5 pr-2">
                  {i.has_incomplete_predecessor && <span className="text-red-600 dark:text-red-400">Predecessor incomplete</span>}
                  {!i.has_incomplete_predecessor && i.is_critical && <span className="text-amber-600">Critical</span>}
                  {!i.has_incomplete_predecessor && !i.is_critical && <span className="text-green-600">Ready</span>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">Nothing scheduled to start in this window.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-400 dark:text-prosota-muted border-t border-gray-100 dark:border-prosota-line pt-1.5 space-y-0.5">
        <div>{s.incomplete_predecessor_count} activities due to start with an incomplete predecessor</div>
        <div>{s.critical_in_window} critical activities in the {s.window_weeks}-week window</div>
        <div>{s.healthy_float_count} activities with healthy float</div>
        <div>Next milestone: {s.next_milestone_name ? `${s.next_milestone_name} (${formatDate(s.next_milestone_date)})` : 'none scheduled'}</div>
      </div>
    </div>
  )
}

export function MitigationActionsTableWidget({ data, filterConditions, filterMatchMode, crossFilter }: WidgetProps) {
  const rows = data.mitigation_actions
    .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
    .filter(a => matchesCrossFilter(a.risk_id, 'risk', crossFilter))
    .sort((a, b) => {
    if (a.due_date === null) return 1
    if (b.due_date === null) return -1
    return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
  })
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Risk</th>
          <th className="py-1.5 pr-2">Action</th>
          <th className="py-1.5 pr-2">Owner</th>
          <th className="py-1.5 pr-2">Due</th>
          <th className="py-1.5 pr-2">Status</th>
          <th className="py-1.5 pr-2">% Complete</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(a => (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.risk_code}</td>
            <td className="py-1.5 pr-2">{a.description}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.owner ?? '—'}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.due_date)}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.status}</td>
            <td className="py-1.5 pr-2">{a.pct_complete}%</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={6} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No mitigation actions logged yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function RiskAgeingTableWidget({ data, filterConditions, filterMatchMode, crossFilter, onCrossFilterClick }: WidgetProps) {
  const now = new Date()
  const rows = data.risks
    .filter(r => r.status !== 'closed' && r.date_raised !== null)
    .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
    .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
    .map(r => ({ ...r, daysOpen: Math.floor((now.getTime() - new Date(r.date_raised!).getTime()) / 86_400_000) }))
    .sort((a, b) => b.daysOpen - a.daysOpen)
    .slice(0, 10)
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-gray-400 dark:text-prosota-muted border-b border-gray-100 dark:border-prosota-line">
          <th className="py-1.5 pr-2">Code</th>
          <th className="py-1.5 pr-2">Title</th>
          <th className="py-1.5 pr-2">Owner</th>
          <th className="py-1.5 pr-2">Days Open</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => {
          const click = recordClick('risk', [r.id], crossFilter, onCrossFilterClick)
          return (
            <tr
              key={r.id}
              onClick={click.onClick}
              className={`border-b border-gray-50 dark:border-prosota-line ${click.onClick ? CROSS_FILTER_ROW_CLASS : ''} ${click.selected ? CROSS_FILTER_SELECTED_CLASS : ''}`}
            >
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.code}</td>
              <td className="py-1.5 pr-2">{r.title}</td>
              <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.risk_owner ?? '—'}</td>
              <td className={`py-1.5 pr-2 font-medium ${r.daysOpen > 90 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>{r.daysOpen}</td>
            </tr>
          )
        })}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No open risks with a raised date.</td></tr>
        )}
      </tbody>
    </table>
  )
}

// Templated sentences over numbers already computed elsewhere on this same
// page (kpis/dcma_quality/risk_overview/clash_summary) — not a model call.
// Per WIDGET_LIBRARY_PLAN.md §E.4's own note: this LOOKS like an AI feature
// but is deterministic string formatting, a cheap stand-in until the real
// AI Insight Generator (Phases 2-4 of CONTROLS_DASHBOARD_MODULE_PLAN.md)
// lands.
export function ProjectNarrativeWidget({ data }: WidgetProps) {
  const { kpis, dcma_quality, risk_overview, clash_summary } = data
  const bullets: string[] = []

  if (kpis.schedule_spi !== null) {
    const spi = Number(kpis.schedule_spi)
    bullets.push(`Schedule is ${spi >= 1 ? 'on track or ahead' : 'behind plan'} (SPI ${spi.toFixed(2)}).`)
  } else {
    bullets.push('Schedule performance index not yet available — no schedule-linked cost data.')
  }
  if (kpis.cpi !== null) {
    const cpi = Number(kpis.cpi)
    bullets.push(`Cost performance is ${cpi >= 1 ? 'healthy' : 'behind plan'} (CPI ${cpi.toFixed(2)}).`)
  }
  if (kpis.planned_finish_status === 'delayed') bullets.push('Planned finish has slipped past its baseline.')
  bullets.push(`DCMA quality score: ${dcma_quality.passing_count}/${dcma_quality.total_checks} checks passing${dcma_quality.logic_score !== null ? ` (logic score ${dcma_quality.logic_score.toFixed(0)}%)` : ''}.`)
  if (risk_overview.high > 0) bullets.push(`${risk_overview.high} high-severity risk${risk_overview.high === 1 ? '' : 's'} open — prioritise mitigation.`)
  else bullets.push('No high-severity risks currently open.')
  if (clash_summary.total_clashes > 0) bullets.push(`${clash_summary.new_count} of ${clash_summary.total_clashes} clashes still unreviewed.`)

  return (
    <ul className="text-xs text-gray-700 dark:text-prosota-muted space-y-1.5 list-disc pl-4">
      {bullets.map((b, i) => <li key={i}>{b}</li>)}
    </ul>
  )
}

// Fixed display order for "+ Add Widget"'s category groups (2026-07-21, per
// Maro: the flat 45-item list was hard to scan) — mirrors the app's own
// sidebar module order (Overview, then Scheduling/Cost/Risk/ICD, then the
// cross-cutting Resources and 4D/Model groups) rather than alphabetising,
// since that's the axis a PM actually thinks in when hunting for a widget.
export const WIDGET_CATEGORIES = [
  'Overview',
  'Schedule',
  'Cost',
  'Risk',
  'Issues, Changes & Decisions',
  'Resources',
  '4D / Model',
] as const
export type WidgetCategory = typeof WIDGET_CATEGORIES[number]

export interface WidgetDefinition {
  label: string
  category: WidgetCategory
  // Sensible default grid size for this widget type specifically — a KPI
  // strip needs full width but is short, Top Risks needs full width and
  // taller, the rest are half-width — used both for the built-in default
  // layout and whenever "+ Add Widget" brings one back onto the board, so
  // a re-added widget isn't stuck at a generic one-size-fits-all guess.
  defaultSize: { w: number; h: number }
  render: (props: WidgetProps) => React.ReactNode
}

// Adding a future widget (S-curve, AI baseline insight, ...) is one entry
// here — DashboardGrid.tsx's own grid/drag/resize mechanics never change.
// Widget types that actually read filterConditions/filterMatchMode
// (2026-09-02) — kept as one shared list so DashboardGrid.tsx's own
// per-widget "Filter" button only appears where it does something, rather
// than on all ~45 registry entries. Must stay in sync with
// propose_create_dashboard_layout's own enumerated field lists
// (backend/app/ai/tools.py) — that's the authoritative source for which
// widget_types support a filter at all.
export const FILTERABLE_WIDGET_TYPES = new Set([
  // Risk (data.risks)
  'top_risks', 'risk_register_table', 'risks_by_category', 'risks_by_owner',
  'threats_vs_opportunities', 'response_strategy_breakdown', 'risk_ageing_table',
  // Cost (data.cost_elements)
  'cost_elements_table', 'cost_breakdown_by_group', 'cost_breakdown_by_owner',
  'budget_utilisation', 'bac_vs_eac_by_group',
  // Issues/Changes/Decisions (data.icd_items)
  'open_items_by_owner', 'issues_by_status', 'issues_ageing_table',
  'decisions_pending_table', 'changes_by_ccb_decision',
  // Resources (data.resource_assignments)
  'resource_assignments_table', 'resource_budget_by_type', 'resource_budget_by_discipline',
  'resource_budget_by_company', 'top_resources_by_budget',
  // Schedule activities (data.schedule_activities)
  'baseline_variance_table', 'critical_activities_table', 'near_critical_watch_list',
  'float_distribution', 'activities_by_category', 'activity_status',
  // Milestones (data.milestones)
  'milestones_table', 'milestone_timeline',
  // Smaller, single-widget data sources
  'lookahead_planner', 'mitigation_actions_table', 'clash_detail_table', 'milestone_trend_chart',
  'milestone_variance',
])

// Export-to-xlsx row extraction (2026-09-07, per Maro: "each dashboard
// needs to be able to be exported to xlsx and printed" — one worksheet per
// widget). This necessarily MIRRORS each widget component's own filter/
// aggregation logic above rather than sharing it directly — the live
// widgets mix data-prep with JSX in one function body, and extracting a
// shared helper out of all ~45 of them was out of scope for this pass. If
// a widget's own filter chain changes above, its mirror here needs the
// same change, or the exported sheet will drift from what's on screen.
// Respects filterConditions/filterMatchMode/crossFilter exactly the same
// way the live widget does, so the sheet reflects what's actually visible
// right now, not a superset. Returns null for a widget with no meaningful
// tabular shape (a gallery of images/video) or whose real data lives behind
// its own async fetch a plain export function can't trigger without a
// hook (the *_trend chart widgets) — deliberately skipped rather than
// exported empty or wrong.
export function getWidgetRows(widgetType: string, props: WidgetProps): { headers: string[]; rows: (string | number)[][] } | null {
  const { data, filterConditions, filterMatchMode, crossFilter } = props
  if (!data) return null
  const fmtCurrency = (v: string | number | null) => v === null ? '' : formatCurrency(v)
  const fmtDate = (v: string | null) => v === null ? '' : formatDate(v)

  switch (widgetType) {
    case 'kpi_strip': {
      const { kpis } = data
      return {
        headers: ['Metric', 'Value'],
        rows: [
          ['Planned Finish', fmtDate(kpis.planned_finish)],
          ['Open Issues', kpis.open_issues],
          ['Open Changes', kpis.open_changes],
          ['Schedule SPI', kpis.schedule_spi !== null ? Number(kpis.schedule_spi).toFixed(2) : ''],
          ['BAC', fmtCurrency(kpis.bac)],
          ['EAC', fmtCurrency(kpis.eac)],
          ['Cost CPI', kpis.cpi !== null ? Number(kpis.cpi).toFixed(2) : ''],
        ],
      }
    }
    case 'schedule_performance': {
      const b = data.schedule_buckets
      return { headers: ['Status', 'Count'], rows: [['On-Time', b.on_time], ['At Risk', b.at_risk], ['Delayed', b.delayed]] }
    }
    case 'risk_overview': {
      const r = data.risk_overview
      return { headers: ['Band', 'Count'], rows: [['High', r.high], ['Medium', r.medium], ['Low', r.low], ['Open', r.open], ['Closed', r.closed]] }
    }
    case 'risk_exposure':
      return { headers: ['Band', 'EMV Cost'], rows: data.risk_exposure.map(b => [b.band, fmtCurrency(b.emv_cost)]) }
    case 'top_risks': {
      const rows = [...data.risks]
        .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
        .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
        .sort((a, b) => Number(b.rating ?? -1) - Number(a.rating ?? -1))
        .slice(0, 5)
      return {
        headers: ['Code', 'Title', 'Status', 'Rating', 'EMV Cost', 'EMV Days'],
        rows: rows.map(r => [r.code, r.title, r.status, r.rating !== null ? Number(r.rating).toFixed(2) : '', fmtCurrency(r.emv_cost), r.emv_schedule_days !== null ? Number(r.emv_schedule_days).toFixed(1) : '']),
      }
    }
    case 'risk_register_table': {
      const rows = data.risks
        .filter(r => r.status !== 'closed')
        .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
        .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
        .sort((a, b) => Number(b.rating ?? -1) - Number(a.rating ?? -1))
      return {
        headers: ['Code', 'Title', 'Category', 'Owner', 'Rating', 'EMV Cost'],
        rows: rows.map(r => [r.code, r.title, r.category ?? '', r.risk_owner ?? '', r.rating !== null ? Number(r.rating).toFixed(2) : '', fmtCurrency(r.emv_cost)]),
      }
    }
    case 'risk_ageing_table': {
      const now = new Date()
      const rows = data.risks
        .filter(r => r.status !== 'closed' && r.date_raised !== null)
        .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
        .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
        .map(r => ({ ...r, daysOpen: Math.floor((now.getTime() - new Date(r.date_raised!).getTime()) / 86_400_000) }))
        .sort((a, b) => b.daysOpen - a.daysOpen)
      return { headers: ['Code', 'Title', 'Owner', 'Days Open'], rows: rows.map(r => [r.code, r.title, r.risk_owner ?? '', r.daysOpen]) }
    }
    case 'risks_by_category': {
      const counts = new Map<string, number>()
      for (const r of data.risks) {
        if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
        const key = r.category ?? 'Uncategorised'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Category', 'Count'], rows: [...counts.entries()].sort(([, a], [, b]) => b - a) }
    }
    case 'risks_by_owner': {
      const counts = new Map<string, number>()
      for (const r of data.risks) {
        if (r.status === 'closed') continue
        if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
        const key = r.risk_owner ?? 'Unassigned'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Owner', 'Count'], rows: [...counts.entries()].sort(([, a], [, b]) => b - a) }
    }
    case 'threats_vs_opportunities': {
      const open = data.risks
        .filter(r => r.status !== 'closed')
        .filter(r => evaluateDashboardFilter(r, filterConditions, filterMatchMode))
        .filter(r => matchesCrossFilter(r.id, 'risk', crossFilter))
      const threats = open.filter(r => r.risk_type === 'threat')
      const opportunities = open.filter(r => r.risk_type === 'opportunity')
      return {
        headers: ['Type', 'Exposure', 'Count'],
        rows: [
          ['Threats', fmtCurrency(threats.reduce((s, r) => s + Math.abs(Number(r.emv_cost ?? 0)), 0)), threats.length],
          ['Opportunities', fmtCurrency(opportunities.reduce((s, r) => s + Number(r.emv_cost ?? 0), 0)), opportunities.length],
        ],
      }
    }
    case 'response_strategy_breakdown': {
      const counts = new Map<string, number>()
      for (const r of data.risks) {
        if (r.status === 'closed') continue
        if (!evaluateDashboardFilter(r, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(r.id, 'risk', crossFilter)) continue
        const key = r.response_strategy ?? 'Not set'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Strategy', 'Count'], rows: [...counts.entries()].sort(([, a], [, b]) => b - a) }
    }
    case 'mitigation_actions_table': {
      const rows = data.mitigation_actions
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.risk_id, 'risk', crossFilter))
      return { headers: ['Code', 'Action', 'Owner', 'Due Date', 'Status', '% Complete'], rows: rows.map(a => [a.code, a.description, a.owner ?? '', fmtDate(a.due_date), a.status, `${a.pct_complete}%`]) }
    }
    case 'cost_breakdown_by_group': {
      const totals = new Map<string, number>()
      for (const el of data.cost_elements) {
        if (el.bac === null) continue
        if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
        const key = el.element_group ?? 'Ungrouped'
        totals.set(key, (totals.get(key) ?? 0) + Number(el.bac))
      }
      return { headers: ['Group', 'BAC'], rows: [...totals.entries()].sort(([, a], [, b]) => b - a).map(([g, v]) => [g, fmtCurrency(v)]) }
    }
    case 'cost_breakdown_by_owner': {
      const totals = new Map<string, number>()
      for (const el of data.cost_elements) {
        if (el.bac === null) continue
        if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
        const key = el.cost_owner ?? 'Unassigned'
        totals.set(key, (totals.get(key) ?? 0) + Number(el.bac))
      }
      return { headers: ['Owner', 'BAC'], rows: [...totals.entries()].sort(([, a], [, b]) => b - a).map(([o, v]) => [o, fmtCurrency(v)]) }
    }
    case 'budget_utilisation': {
      const withBac = data.cost_elements
        .filter(el => el.bac !== null)
        .filter(el => evaluateDashboardFilter(el, filterConditions, filterMatchMode))
        .filter(el => matchesCrossFilter(el.id, 'cost_element', crossFilter))
      const bacTotal = withBac.reduce((s, el) => s + Number(el.bac), 0)
      const acTotal = withBac.reduce((s, el) => s + Number(el.ac ?? 0), 0)
      return { headers: ['Metric', 'Value'], rows: [['Budget (BAC)', fmtCurrency(bacTotal)], ['Actuals (AC)', fmtCurrency(acTotal)], ['% Spent', bacTotal > 0 ? `${Math.round((acTotal / bacTotal) * 100)}%` : '']] }
    }
    case 'bac_vs_eac_by_group': {
      const groups = new Map<string, { bac: number; eac: number }>()
      for (const el of data.cost_elements) {
        if (el.bac === null) continue
        if (!evaluateDashboardFilter(el, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(el.id, 'cost_element', crossFilter)) continue
        const key = el.element_group ?? 'Ungrouped'
        const entry = groups.get(key) ?? { bac: 0, eac: 0 }
        entry.bac += Number(el.bac)
        entry.eac += Number(el.eac ?? el.bac)
        groups.set(key, entry)
      }
      return { headers: ['Group', 'Budget', 'Forecast (EAC)'], rows: [...groups.entries()].sort(([, a], [, b]) => b.bac - a.bac).map(([g, v]) => [g, fmtCurrency(v.bac), fmtCurrency(v.eac)]) }
    }
    case 'cost_elements_table': {
      const rows = data.cost_elements
        .filter(el => evaluateDashboardFilter(el, filterConditions, filterMatchMode))
        .filter(el => matchesCrossFilter(el.id, 'cost_element', crossFilter))
        .sort((a, b) => Number(b.bac ?? 0) - Number(a.bac ?? 0))
      return { headers: ['Code', 'Description', 'Budget', 'Actuals', 'CPI', 'EAC'], rows: rows.map(el => [el.code, el.description, fmtCurrency(el.bac), fmtCurrency(el.ac), el.cpi !== null ? Number(el.cpi).toFixed(3) : '', fmtCurrency(el.eac)]) }
    }
    case 'issues_by_status': {
      const counts = new Map<string, number>()
      for (const i of data.icd_items) {
        if (i.item_type !== 'issue') continue
        if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
        counts.set(i.status, (counts.get(i.status) ?? 0) + 1)
      }
      return { headers: ['Status', 'Count'], rows: [...counts.entries()] }
    }
    case 'issues_ageing_table': {
      const now = new Date()
      const rows = data.icd_items
        .filter(i => i.item_type === 'issue' && i.status !== 'closed' && i.raised_date !== null)
        .filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode))
        .filter(i => matchesCrossFilter(i.id, 'icd_item', crossFilter))
        .map(i => ({ ...i, daysOpen: daysBetween(i.raised_date!, now) }))
        .sort((a, b) => b.daysOpen - a.daysOpen)
      return { headers: ['Code', 'Issue', 'Owner', 'Severity', 'Days Open'], rows: rows.map(i => [i.code, i.title, i.owner ?? '', i.severity ?? '', i.daysOpen]) }
    }
    case 'open_items_by_owner': {
      const counts = new Map<string, number>()
      for (const i of data.icd_items) {
        if (i.status === 'closed') continue
        if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
        const key = i.owner ?? 'Unassigned'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Owner', 'Count'], rows: [...counts.entries()].sort(([, a], [, b]) => b - a) }
    }
    case 'decisions_pending_table': {
      const now = new Date()
      const rows = data.icd_items
        .filter(i => i.item_type === 'decision' && i.status !== 'closed')
        .filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode))
        .filter(i => matchesCrossFilter(i.id, 'icd_item', crossFilter))
        .sort((a, b) => {
          if (a.required_by === null) return 1
          if (b.required_by === null) return -1
          return new Date(a.required_by).getTime() - new Date(b.required_by).getTime()
        })
      return {
        headers: ['Code', 'Decision', 'Decision Maker', 'Required By', 'Overdue'],
        rows: rows.map(i => [i.code, i.title, i.decision_maker ?? '', fmtDate(i.required_by), i.required_by !== null && new Date(i.required_by) < now ? 'Yes' : 'No']),
      }
    }
    case 'changes_by_ccb_decision': {
      const counts = new Map<string, number>()
      for (const i of data.icd_items) {
        if (i.item_type !== 'change') continue
        if (!evaluateDashboardFilter(i, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(i.id, 'icd_item', crossFilter)) continue
        const key = i.ccb_decision ?? 'Pending'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Decision', 'Count'], rows: [...counts.entries()] }
    }
    case 'resource_budget_by_type': {
      const rows = data.resource_assignments
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
      const totals = new Map<string, number>()
      for (const a of rows) totals.set(a.resource_type, (totals.get(a.resource_type) ?? 0) + Number(a.budget))
      return { headers: ['Type', 'Budget'], rows: [...totals.entries()].sort(([, a], [, b]) => b - a).map(([t, v]) => [t, fmtCurrency(v)]) }
    }
    case 'resource_budget_by_discipline': {
      const rows = data.resource_assignments
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
      const totals = new Map<string, number>()
      for (const a of rows) { const key = a.discipline ?? 'Unspecified'; totals.set(key, (totals.get(key) ?? 0) + Number(a.budget)) }
      return { headers: ['Discipline', 'Budget'], rows: [...totals.entries()].sort(([, a], [, b]) => b - a).map(([d, v]) => [d, fmtCurrency(v)]) }
    }
    case 'resource_budget_by_company': {
      const rows = data.resource_assignments
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
      const totals = new Map<string, number>()
      for (const a of rows) { const key = a.company ?? 'Unassigned'; totals.set(key, (totals.get(key) ?? 0) + Number(a.budget)) }
      return { headers: ['Company', 'Budget'], rows: [...totals.entries()].sort(([, a], [, b]) => b - a).map(([c, v]) => [c, fmtCurrency(v)]) }
    }
    case 'resource_assignments_table': {
      const rows = data.resource_assignments
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
        .sort((a, b) => Number(b.budget) - Number(a.budget))
      return { headers: ['Resource', 'Role', 'Activity', 'Budget'], rows: rows.map(a => [a.resource_name, a.role ?? '', a.activity_task_name, fmtCurrency(a.budget)]) }
    }
    case 'top_resources_by_budget': {
      const filtered = data.resource_assignments
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.activity_id, 'activity', crossFilter))
      const byResource = new Map<string, { type: string; budget: number; count: number }>()
      for (const a of filtered) {
        const entry = byResource.get(a.resource_name) ?? { type: a.resource_type, budget: 0, count: 0 }
        entry.budget += Number(a.budget)
        entry.count += 1
        byResource.set(a.resource_name, entry)
      }
      return {
        headers: ['Resource', 'Type', 'Activities', 'Total Budget'],
        rows: [...byResource.entries()].sort(([, a], [, b]) => b.budget - a.budget).map(([name, v]) => [name, v.type, v.count, fmtCurrency(v.budget)]),
      }
    }
    case 'float_distribution': {
      const withFloat = data.schedule_activities
        .filter(a => a.total_float_hours !== null)
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
      return {
        headers: ['Float Bucket (hours)', 'Count'],
        rows: FLOAT_BUCKETS.map(([label, min, max]) => [label, withFloat.filter(a => { const f = Number(a.total_float_hours); return f >= min && f <= max }).length]),
      }
    }
    case 'activities_by_category': {
      const counts = new Map<string, number>()
      for (const a of data.schedule_activities) {
        if (!evaluateDashboardFilter(a, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(a.id, 'activity', crossFilter)) continue
        const key = a.schedule_category ?? 'Unspecified'
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      return { headers: ['Category', 'Count'], rows: [...counts.entries()].sort(([, a], [, b]) => b - a) }
    }
    case 'baseline_variance_table': {
      const rows = data.schedule_activities
        .filter(a => a.variance_days !== null && a.variance_days !== 0)
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
        .sort((a, b) => Math.abs(b.variance_days!) - Math.abs(a.variance_days!))
      return { headers: ['Code', 'Activity', 'Baseline Finish', 'Current Finish', 'Variance (days)'], rows: rows.map(a => [a.code, a.task_name, fmtDate(a.bl_finish), fmtDate(a.finish), a.variance_days!]) }
    }
    case 'critical_activities_table': {
      const rows = data.schedule_activities
        .filter(a => a.is_critical === true)
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
      return { headers: ['Code', 'Activity', 'Finish', '% Complete'], rows: rows.map(a => [a.code, a.task_name, fmtDate(a.finish), a.pct_complete !== null ? `${Number(a.pct_complete).toFixed(0)}%` : '']) }
    }
    case 'near_critical_watch_list': {
      const rows = data.schedule_activities
        .filter(a => a.total_float_hours !== null && Number(a.total_float_hours) > 0 && Number(a.total_float_hours) <= 80)
        .filter(a => evaluateDashboardFilter(a, filterConditions, filterMatchMode))
        .filter(a => matchesCrossFilter(a.id, 'activity', crossFilter))
        .sort((a, b) => Number(a.total_float_hours) - Number(b.total_float_hours))
      return { headers: ['Code', 'Activity', 'Total Float (h)', 'Finish'], rows: rows.map(a => [a.code, a.task_name, Number(a.total_float_hours).toFixed(1), fmtDate(a.finish)]) }
    }
    case 'activity_status': {
      const counts: Record<string, number> = { 'Not Started': 0, 'In Progress': 0, 'Complete': 0, 'Suspended': 0 }
      for (const a of data.schedule_activities) {
        if (!evaluateDashboardFilter(a, filterConditions, filterMatchMode)) continue
        if (!matchesCrossFilter(a.id, 'activity', crossFilter)) continue
        const pct = a.pct_complete !== null ? Number(a.pct_complete) : 0
        if (a.suspend_date !== null && a.resume_date === null) counts.Suspended++
        else if (pct >= 100) counts.Complete++
        else if (pct > 0) counts['In Progress']++
        else counts['Not Started']++
      }
      return { headers: ['Status', 'Count'], rows: Object.entries(counts) }
    }
    case 'milestones_table': {
      const rows = data.milestones
        .filter(m => evaluateDashboardFilter(m, filterConditions, filterMatchMode))
        .filter(m => matchesCrossFilter(m.id, 'activity', crossFilter))
      return { headers: ['Milestone', 'Baseline Finish', 'Current Finish', 'Variance (days)'], rows: rows.map(m => [m.task_name, fmtDate(m.bl_finish), fmtDate(m.finish), m.variance_days ?? '']) }
    }
    case 'milestone_timeline': {
      const rows = data.milestones
        .filter(m => evaluateDashboardFilter(m, filterConditions, filterMatchMode))
        .filter(m => matchesCrossFilter(m.id, 'activity', crossFilter))
      return { headers: ['Milestone', 'Finish', 'Critical', 'Variance (days)'], rows: rows.map(m => [m.task_name, fmtDate(m.finish), m.is_critical ? 'Yes' : 'No', m.variance_days ?? '']) }
    }
    case 'lookahead_planner': {
      const rows = data.lookahead_items.filter(i => evaluateDashboardFilter(i, filterConditions, filterMatchMode)).filter(i => matchesCrossFilter(i.id, 'activity', crossFilter))
      return {
        headers: ['Code', 'Activity', 'Start', '% Complete', 'Status'],
        rows: rows.map(i => [
          i.code, i.task_name, fmtDate(i.start), i.pct_complete !== null ? `${Number(i.pct_complete).toFixed(0)}%` : '',
          i.has_incomplete_predecessor ? 'Predecessor incomplete' : i.is_critical ? 'Critical' : 'Ready',
        ]),
      }
    }
    case 'clash_summary':
      return {
        headers: ['Test', 'Type', 'Total', 'New', 'Reviewed', 'Approved'],
        rows: data.clash_summary.by_test.map(t => [t.test_name, t.test_type, t.total, t.new_count, t.reviewed_count, t.approved_count]),
      }
    case 'clash_detail_table': {
      const rows = data.clash_pairs.filter(p => evaluateDashboardFilter(p, filterConditions, filterMatchMode))
      return { headers: ['Test', 'Element A', 'Element B', 'Distance (mm)', 'Status'], rows: rows.map(p => [p.test_name, p.element_a_label, p.element_b_label, p.distance_mm ?? '', p.status]) }
    }
    case 'dcma_score': {
      const q = data.dcma_quality
      return { headers: ['Metric', 'Value'], rows: [['Passing', q.passing_count], ['Total Checks', q.total_checks], ['Failing', q.failing_count], ['Warning', q.warning_count], ['Logic Score', q.logic_score !== null ? `${q.logic_score.toFixed(0)}%` : '']] }
    }
    case 'eac_forecast_comparison': {
      const { kpis } = data
      return {
        headers: ['Method', 'EAC', 'Assumption'],
        rows: [
          ['EAC = BAC / CPI', fmtCurrency(kpis.eac), 'Past CPI continues'],
          ['EAC = AC + (BAC-EV)', fmtCurrency(kpis.eac_remaining_at_plan), 'Remaining work at plan rate'],
          ['EAC = AC + (BAC-EV)/(SPIxCPI)', fmtCurrency(kpis.eac_composite), 'Composite SPI x CPI'],
          ['EAC = AC + remaining cost for activity', fmtCurrency(kpis.eac_bottom_up), 'Bottom-up, from P6 remaining duration'],
        ],
      }
    }
    case 'earned_value_summary_table': {
      const { kpis } = data
      const spi = kpis.schedule_spi !== null ? Number(kpis.schedule_spi) : null
      const cpi = kpis.cpi !== null ? Number(kpis.cpi) : null
      return {
        headers: ['Metric', 'Value'],
        rows: [
          ['BAC (Budget)', fmtCurrency(kpis.bac)],
          ['SPI', spi !== null ? spi.toFixed(2) : ''],
          ['CPI', cpi !== null ? cpi.toFixed(2) : ''],
          ['EAC (Forecast)', fmtCurrency(kpis.eac)],
        ],
      }
    }
    case 'project_info': {
      const { kpis, project_info } = data
      return {
        headers: ['Metric', 'Value'],
        rows: [
          ['Plan Start', fmtDate(kpis.plan_start)],
          ['Planned Finish', fmtDate(kpis.planned_finish)],
          ['Data Date', fmtDate(project_info.data_date)],
          ['Total Activities', project_info.total_activities],
          ['Relationships', project_info.total_relationships],
          ['Resources', project_info.total_resources],
          ['Baseline', project_info.has_baseline ? 'Yes' : 'No'],
        ],
      }
    }
    case 'project_narrative': {
      const { kpis, dcma_quality, risk_overview, clash_summary } = data
      const bullets: string[] = []
      if (kpis.schedule_spi !== null) {
        const spi = Number(kpis.schedule_spi)
        bullets.push(`Schedule is ${spi >= 1 ? 'on track or ahead' : 'behind plan'} (SPI ${spi.toFixed(2)}).`)
      } else bullets.push('Schedule performance index not yet available — no schedule-linked cost data.')
      if (kpis.cpi !== null) {
        const cpi = Number(kpis.cpi)
        bullets.push(`Cost performance is ${cpi >= 1 ? 'healthy' : 'behind plan'} (CPI ${cpi.toFixed(2)}).`)
      }
      if (kpis.planned_finish_status === 'delayed') bullets.push('Planned finish has slipped past its baseline.')
      bullets.push(`DCMA quality score: ${dcma_quality.passing_count}/${dcma_quality.total_checks} checks passing${dcma_quality.logic_score !== null ? ` (logic score ${dcma_quality.logic_score.toFixed(0)}%)` : ''}.`)
      if (risk_overview.high > 0) bullets.push(`${risk_overview.high} high-severity risk${risk_overview.high === 1 ? '' : 's'} open — prioritise mitigation.`)
      else bullets.push('No high-severity risks currently open.')
      if (clash_summary.total_clashes > 0) bullets.push(`${clash_summary.new_count} of ${clash_summary.total_clashes} clashes still unreviewed.`)
      return { headers: ['Summary'], rows: bullets.map(b => [b]) }
    }
    // No meaningful tabular shape (a gallery of images/video, no rows to
    // export) or the real data lives behind its own async fetch a plain,
    // synchronous export function can't trigger without a React hook
    // (useActiveScheduleVariant, etc.) — deliberately skipped rather than
    // exported empty or silently wrong.
    case 'camera_view_gallery':
    case 'fourd_video_gallery':
    case 'milestone_trend_chart':
    case 'milestone_variance':
    case 'risk_emv_trend':
    case 'cost_cpi_trend':
    case 'cost_eac_trend':
    case 'spi_trend':
    case 'icd_open_items_trend':
    case 'pv_ev_ac_trend':
      return null
    default:
      return null
  }
}

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  kpi_strip: { label: 'KPI Strip', category: 'Overview', defaultSize: { w: 12, h: 2 }, render: props => <KpiStripWidget {...props} /> },
  schedule_performance: { label: 'Schedule Performance', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <SchedulePerformanceWidget {...props} /> },
  risk_overview: { label: 'Risk Overview', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <RiskOverviewWidget {...props} /> },
  // h bumped 4->6 (2026-09-07, per Maro: "everything needs to be visible" —
  // the extra per-row buffer just added (MilestoneTrack's own ROW_STEP_PX)
  // made a real multi-row schedule's stacked labels taller than the old
  // default tile, relying on overflow-auto scrolling to see the top rows
  // rather than showing them all at once. Only affects a freshly-added
  // widget — one already placed on a saved layout keeps its own saved size.
  milestone_timeline: { label: 'Milestone Timeline', category: 'Schedule', defaultSize: { w: 6, h: 6 }, render: props => <MilestoneTimelineWidget {...props} /> },
  milestone_trend_chart: { label: 'Milestone Trend Chart', category: 'Schedule', defaultSize: { w: 8, h: 5 }, render: props => <MilestoneTrendChartWidget {...props} /> },
  milestone_variance: { label: 'Milestone Variance', category: 'Schedule', defaultSize: { w: 8, h: 4 }, render: props => <MilestoneVarianceWidget {...props} /> },
  risk_emv_trend: { label: 'Risk EMV Trend', category: 'Risk', defaultSize: { w: 8, h: 5 }, render: props => <RiskEmvTrendWidget {...props} /> },
  cost_cpi_trend: { label: 'Cost CPI Trend', category: 'Cost', defaultSize: { w: 8, h: 5 }, render: props => <CostCpiTrendWidget {...props} /> },
  cost_eac_trend: { label: 'Cost EAC Trend', category: 'Cost', defaultSize: { w: 8, h: 5 }, render: props => <CostEacTrendWidget {...props} /> },
  spi_trend: { label: 'SPI Trend', category: 'Schedule', defaultSize: { w: 8, h: 5 }, render: props => <SpiTrendWidget {...props} /> },
  icd_open_items_trend: { label: 'Issues/Changes/Decisions Open Trend', category: 'Issues, Changes & Decisions', defaultSize: { w: 8, h: 5 }, render: props => <IcdOpenItemsTrendWidget {...props} /> },
  pv_ev_ac_trend: { label: 'PV/EV/AC Trend (S-Curve)', category: 'Cost', defaultSize: { w: 8, h: 5 }, render: props => <PvEvAcTrendWidget {...props} /> },
  risk_exposure: { label: 'Risk Exposure', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <RiskExposureWidget {...props} /> },
  top_risks: { label: 'Top 5 Risks', category: 'Risk', defaultSize: { w: 12, h: 5 }, render: props => <TopRisksWidget {...props} /> },
  float_distribution: { label: 'Float Distribution', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <FloatDistributionWidget {...props} /> },
  activities_by_category: { label: 'Activities by Category', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <ActivitiesByCategoryWidget {...props} /> },
  baseline_variance_table: { label: 'Baseline Variance', category: 'Schedule', defaultSize: { w: 12, h: 5 }, render: props => <BaselineVarianceTableWidget {...props} /> },
  milestones_table: { label: 'Milestones Table', category: 'Schedule', defaultSize: { w: 6, h: 5 }, render: props => <MilestonesTableWidget {...props} /> },
  critical_activities_table: { label: 'Critical Activities', category: 'Schedule', defaultSize: { w: 6, h: 5 }, render: props => <CriticalActivitiesTableWidget {...props} /> },
  risks_by_category: { label: 'Risks by Category', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <RisksByCategoryWidget {...props} /> },
  risks_by_owner: { label: 'Risks by Owner', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <RisksByOwnerWidget {...props} /> },
  threats_vs_opportunities: { label: 'Threats vs Opportunities', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <ThreatsVsOpportunitiesWidget {...props} /> },
  response_strategy_breakdown: { label: 'Response Strategy Breakdown', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <ResponseStrategyBreakdownWidget {...props} /> },
  risk_register_table: { label: 'Risk Register', category: 'Risk', defaultSize: { w: 12, h: 5 }, render: props => <RiskRegisterTableWidget {...props} /> },
  cost_breakdown_by_group: { label: 'Cost Breakdown by Group', category: 'Cost', defaultSize: { w: 6, h: 4 }, render: props => <CostBreakdownByGroupWidget {...props} /> },
  cost_breakdown_by_owner: { label: 'Cost Breakdown by Owner', category: 'Cost', defaultSize: { w: 6, h: 4 }, render: props => <CostBreakdownByOwnerWidget {...props} /> },
  budget_utilisation: { label: 'Budget Utilisation', category: 'Cost', defaultSize: { w: 6, h: 2 }, render: props => <BudgetUtilisationWidget {...props} /> },
  bac_vs_eac_by_group: { label: 'Budget vs Forecast by Group', category: 'Cost', defaultSize: { w: 6, h: 4 }, render: props => <BacVsEacByGroupWidget {...props} /> },
  cost_elements_table: { label: 'Cost Elements Table', category: 'Cost', defaultSize: { w: 12, h: 5 }, render: props => <CostElementsTableWidget {...props} /> },
  issues_by_status: { label: 'Issues by Status', category: 'Issues, Changes & Decisions', defaultSize: { w: 6, h: 4 }, render: props => <IssuesByStatusWidget {...props} /> },
  issues_ageing_table: { label: 'Issues Ageing', category: 'Issues, Changes & Decisions', defaultSize: { w: 6, h: 5 }, render: props => <IssuesAgeingTableWidget {...props} /> },
  open_items_by_owner: { label: 'Open Items by Owner', category: 'Issues, Changes & Decisions', defaultSize: { w: 6, h: 4 }, render: props => <OpenItemsByOwnerWidget {...props} /> },
  decisions_pending_table: { label: 'Decisions Pending', category: 'Issues, Changes & Decisions', defaultSize: { w: 6, h: 5 }, render: props => <DecisionsPendingTableWidget {...props} /> },
  changes_by_ccb_decision: { label: 'Changes by CCB Decision', category: 'Issues, Changes & Decisions', defaultSize: { w: 6, h: 4 }, render: props => <ChangesByCcbDecisionWidget {...props} /> },
  resource_budget_by_type: { label: 'Resource Budget by Type', category: 'Resources', defaultSize: { w: 6, h: 4 }, render: props => <ResourceBudgetByTypeWidget {...props} /> },
  resource_budget_by_discipline: { label: 'Resource Budget by Discipline', category: 'Resources', defaultSize: { w: 6, h: 4 }, render: props => <ResourceBudgetByDisciplineWidget {...props} /> },
  resource_budget_by_company: { label: 'Resource Budget by Company', category: 'Resources', defaultSize: { w: 6, h: 4 }, render: props => <ResourceBudgetByCompanyWidget {...props} /> },
  resource_assignments_table: { label: 'Resource Assignments', category: 'Resources', defaultSize: { w: 12, h: 5 }, render: props => <ResourceAssignmentsTableWidget {...props} /> },
  top_resources_by_budget: { label: 'Top Resources by Budget', category: 'Resources', defaultSize: { w: 6, h: 5 }, render: props => <TopResourcesByBudgetWidget {...props} /> },
  dcma_score: { label: 'DCMA Score', category: 'Schedule', defaultSize: { w: 6, h: 3 }, render: props => <DcmaScoreWidget {...props} /> },
  clash_summary: { label: 'Clash Summary', category: '4D / Model', defaultSize: { w: 6, h: 5 }, render: props => <ClashSummaryWidget {...props} /> },
  clash_detail_table: { label: 'Clash Detail Table', category: '4D / Model', defaultSize: { w: 12, h: 5 }, render: props => <ClashDetailTableWidget {...props} /> },
  eac_forecast_comparison: { label: 'EAC Forecast Comparison', category: 'Cost', defaultSize: { w: 12, h: 4 }, render: props => <EacForecastComparisonWidget {...props} /> },
  earned_value_summary_table: { label: 'Earned Value Summary', category: 'Cost', defaultSize: { w: 6, h: 4 }, render: props => <EarnedValueSummaryTableWidget {...props} /> },
  near_critical_watch_list: { label: 'Near-Critical Watch List', category: 'Schedule', defaultSize: { w: 6, h: 5 }, render: props => <NearCriticalWatchListWidget {...props} /> },
  activity_status: { label: 'Activity Status', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <ActivityStatusWidget {...props} /> },
  project_info: { label: 'Project Info', category: 'Overview', defaultSize: { w: 12, h: 2 }, render: props => <ProjectInfoWidget {...props} /> },
  camera_view_gallery: { label: 'Camera Views', category: '4D / Model', defaultSize: { w: 6, h: 6 }, render: props => <CameraViewGalleryWidget {...props} /> },
  fourd_video_gallery: { label: '4D Video', category: '4D / Model', defaultSize: { w: 6, h: 6 }, render: props => <FourDVideoGalleryWidget {...props} /> },
  lookahead_planner: { label: 'Look-Ahead Planner', category: 'Schedule', defaultSize: { w: 12, h: 6 }, render: props => <LookaheadPlannerWidget {...props} /> },
  mitigation_actions_table: { label: 'Mitigation Actions', category: 'Risk', defaultSize: { w: 12, h: 5 }, render: props => <MitigationActionsTableWidget {...props} /> },
  risk_ageing_table: { label: 'Risk Ageing', category: 'Risk', defaultSize: { w: 6, h: 5 }, render: props => <RiskAgeingTableWidget {...props} /> },
  project_narrative: { label: 'Project Narrative', category: 'Overview', defaultSize: { w: 6, h: 4 }, render: props => <ProjectNarrativeWidget {...props} /> },
}
