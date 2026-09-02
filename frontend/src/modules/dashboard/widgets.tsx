import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { listCameraViews, type CameraView } from '../fourD/cameraViews'
import { downloadFourDVideo, listFourDVideos, type FourDVideo } from '../fourD/fourDVideos'
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
  // flexibility to those widgets" — round 1 of the widget-flexibility
  // work, before any generic/custom widget type). A plain string-keyed
  // dict rather than a typed shape per widget, matching this app's own
  // "shape owned by the frontend, opaque JSONB at rest" convention
  // (Zone.points, MaterialPreset.config) — DashboardGrid.tsx passes each
  // widget's own w.filter through here unchanged; only the widgets that
  // actually support one (currently TopRisksWidget/
  // RiskRegisterTableWidget/CostElementsTableWidget/
  // ResourceAssignmentsTableWidget/OpenItemsByOwnerWidget) read specific
  // keys out of it, everything else ignores it. Undefined = no filter, same
  // as never having narrowed the widget at all.
  filter?: Record<string, string>
}

const RISK_BAND_COLORS: Record<string, string> = { Low: '#16a34a', Medium: '#d97706', High: '#dc2626' }

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

export function MilestoneTimelineWidget({ data }: WidgetProps) {
  return (
    <div className="h-full overflow-auto">
      <MilestoneTrack milestones={data.milestones} />
    </div>
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

export function TopRisksWidget({ data, onNavigateToRisks, filter }: WidgetProps) {
  // Filterable (2026-09-02) — recomputed from data.risks (the raw list)
  // rather than data.top_risks (a fixed, unfiltered server-side top-5) so
  // an optional risk_type narrowing can apply before picking the top 5;
  // same rating-desc ordering data.top_risks itself uses server-side
  // (dashboard.py), just reproduced client-side here so filtering doesn't
  // need a second backend field.
  const topRisks = [...data.risks]
    .filter(r => !filter?.risk_type || r.risk_type === filter.risk_type)
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

export function FloatDistributionWidget({ data }: WidgetProps) {
  const withFloat = data.schedule_activities.filter(a => a.total_float_hours !== null)
  const chartData = FLOAT_BUCKETS.map(([label, min, max]) => ({
    label,
    count: withFloat.filter(a => {
      const f = Number(a.total_float_hours)
      return f >= min && f <= max
    }).length,
  }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} label={{ value: 'Total float (hours)', position: 'insideBottom', offset: -5, fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#2563eb" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ActivitiesByCategoryWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const a of data.schedule_activities) {
    const key = a.schedule_category ?? 'Unspecified'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar dataKey="count" fill="#0891b2" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BaselineVarianceTableWidget({ data }: WidgetProps) {
  const ranked = data.schedule_activities
    .filter(a => a.variance_days !== null && a.variance_days !== 0)
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
        {ranked.map(a => (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
            <td className="py-1.5 pr-2">{a.task_name}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.bl_finish)}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
            <td className={`py-1.5 pr-2 font-medium ${a.variance_days! > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600'}`}>
              {a.variance_days! > 0 ? `+${a.variance_days}` : a.variance_days}d
            </td>
          </tr>
        ))}
        {ranked.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No baseline variance yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function MilestonesTableWidget({ data }: WidgetProps) {
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
        {data.milestones.map(m => (
          <tr key={m.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2">{m.task_name}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(m.bl_finish)}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(m.finish)}</td>
            <td className={`py-1.5 pr-2 font-medium ${m.variance_days !== null && m.variance_days > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-prosota-muted'}`}>
              {m.variance_days === null ? '—' : m.variance_days > 0 ? `+${m.variance_days}d` : `${m.variance_days}d`}
            </td>
          </tr>
        ))}
        {data.milestones.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No milestones yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function CriticalActivitiesTableWidget({ data }: WidgetProps) {
  const critical = data.schedule_activities.filter(a => a.is_critical === true)
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
        {critical.map(a => (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
            <td className="py-1.5 pr-2">{a.task_name}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
            <td className="py-1.5 pr-2">{a.pct_complete !== null ? `${Number(a.pct_complete).toFixed(0)}%` : '—'}</td>
          </tr>
        ))}
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

export function RisksByCategoryWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const r of data.risks) {
    const key = r.category ?? 'Uncategorised'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="category" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#7c3aed" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RisksByOwnerWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const r of data.risks) {
    if (r.status === 'closed') continue
    const key = r.risk_owner ?? 'Unassigned'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar dataKey="count" fill="#d97706" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ThreatsVsOpportunitiesWidget({ data }: WidgetProps) {
  // emv_cost is signed (threats negative, opportunities positive — see
  // RiskExposureWidget's own note) — magnitude is what's worth comparing
  // here, the sign is already implied by which bar it is.
  const open = data.risks.filter(r => r.status !== 'closed')
  const threatExposure = open.filter(r => r.risk_type === 'threat').reduce((sum, r) => sum + Math.abs(Number(r.emv_cost ?? 0)), 0)
  const opportunityExposure = open.filter(r => r.risk_type === 'opportunity').reduce((sum, r) => sum + Number(r.emv_cost ?? 0), 0)
  const chartData = [
    { type: 'Threats', exposure: threatExposure, count: open.filter(r => r.risk_type === 'threat').length },
    { type: 'Opportunities', exposure: opportunityExposure, count: open.filter(r => r.risk_type === 'opportunity').length },
  ]
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="type" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v: number, _n, item) => `${formatCurrency(v)} (${item.payload.count} risks)`} />
        <Bar dataKey="exposure">
          <Cell fill="#dc2626" />
          <Cell fill="#16a34a" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ResponseStrategyBreakdownWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const r of data.risks) {
    if (r.status === 'closed') continue
    const key = r.response_strategy ?? 'Not set'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()].map(([strategy, count]) => ({ strategy, count })).sort((a, b) => b.count - a.count)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="strategy" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#0891b2" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function RiskRegisterTableWidget({ data, onNavigateToRisks, filter }: WidgetProps) {
  // Filterable (2026-09-02) — risk_type/category narrowing on top of the
  // existing open-only filter, e.g. "Cost risks only" or "opportunities only".
  const open = data.risks
    .filter(r => r.status !== 'closed')
    .filter(r => !filter?.risk_type || r.risk_type === filter.risk_type)
    .filter(r => !filter?.category || r.category === filter.category)
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

export function CostBreakdownByGroupWidget({ data }: WidgetProps) {
  const totals = new Map<string, number>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    const key = el.element_group ?? 'Ungrouped'
    totals.set(key, (totals.get(key) ?? 0) + Number(el.bac))
  }
  const chartData = [...totals.entries()]
    .map(([group, bac]) => ({ group, bac }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="group" tick={{ fontSize: 11 }} width={100} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="bac" fill="#2563eb" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CostBreakdownByOwnerWidget({ data }: WidgetProps) {
  const totals = new Map<string, number>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    const key = el.cost_owner ?? 'Unassigned'
    totals.set(key, (totals.get(key) ?? 0) + Number(el.bac))
  }
  const chartData = [...totals.entries()]
    .map(([owner, bac]) => ({ owner, bac }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="bac" fill="#d97706" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function BudgetUtilisationWidget({ data }: WidgetProps) {
  const withBac = data.cost_elements.filter(el => el.bac !== null)
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

export function BacVsEacByGroupWidget({ data }: WidgetProps) {
  const groups = new Map<string, { bac: number; eac: number }>()
  for (const el of data.cost_elements) {
    if (el.bac === null) continue
    const key = el.element_group ?? 'Ungrouped'
    const entry = groups.get(key) ?? { bac: 0, eac: 0 }
    entry.bac += Number(el.bac)
    entry.eac += Number(el.eac ?? el.bac)
    groups.set(key, entry)
  }
  const chartData = [...groups.entries()]
    .map(([group, v]) => ({ group, ...v }))
    .sort((a, b) => b.bac - a.bac)
    .slice(0, 8)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="group" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
        <Tooltip formatter={(v: number) => formatCurrency(v)} />
        <Bar dataKey="bac" name="Budget" fill="#94a3b8" />
        <Bar dataKey="eac" name="Forecast (EAC)" fill="#dc2626" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CostElementsTableWidget({ data, filter }: WidgetProps) {
  // Filterable (2026-09-02) — narrow to one cost group, e.g. "Prelims only".
  const rows = data.cost_elements
    .filter(el => !filter?.element_group || el.element_group === filter.element_group)
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
        {rows.map(el => (
          <tr key={el.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{el.code}</td>
            <td className="py-1.5 pr-2">{el.description}</td>
            <td className="py-1.5 pr-2">{el.bac !== null ? formatCurrency(el.bac) : '—'}</td>
            <td className="py-1.5 pr-2">{el.ac !== null ? formatCurrency(el.ac) : '—'}</td>
            <td className={`py-1.5 pr-2 ${el.cpi !== null && Number(el.cpi) < 1 ? 'text-orange-600' : ''}`}>
              {el.cpi !== null ? Number(el.cpi).toFixed(2) : '—'}
            </td>
            <td className="py-1.5 pr-2">{el.eac !== null ? formatCurrency(el.eac) : '—'}</td>
          </tr>
        ))}
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

export function IssuesByStatusWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const i of data.icd_items) {
    if (i.item_type !== 'issue') continue
    counts.set(i.status, (counts.get(i.status) ?? 0) + 1)
  }
  const chartData = [...counts.entries()].map(([status, count]) => ({ status, count }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#dc2626" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function IssuesAgeingTableWidget({ data }: WidgetProps) {
  const now = new Date()
  const rows = data.icd_items
    .filter(i => i.item_type === 'issue' && i.status !== 'closed' && i.raised_date !== null)
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
        {rows.map(i => (
          <tr key={i.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.code}</td>
            <td className="py-1.5 pr-2">{i.title}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.owner ?? '—'}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{i.severity ?? '—'}</td>
            <td className={`py-1.5 pr-2 font-medium ${i.daysOpen > 30 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>{i.daysOpen}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={5} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No open issues.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function OpenItemsByOwnerWidget({ data, filter }: WidgetProps) {
  // Filterable (2026-09-02) — narrow to one item_type ('issue'|'change'|'decision').
  const counts = new Map<string, number>()
  for (const i of data.icd_items) {
    if (i.status === 'closed') continue
    if (filter?.item_type && i.item_type !== filter.item_type) continue
    const key = i.owner ?? 'Unassigned'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()]
    .map(([owner, count]) => ({ owner, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData} layout="vertical" margin={{ left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 12 }} allowDecimals={false} />
        <YAxis type="category" dataKey="owner" tick={{ fontSize: 11 }} width={90} />
        <Tooltip />
        <Bar dataKey="count" fill="#0891b2" />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function DecisionsPendingTableWidget({ data }: WidgetProps) {
  const now = new Date()
  const rows = data.icd_items
    .filter(i => i.item_type === 'decision' && i.status !== 'closed')
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
          return (
            <tr key={i.id} className="border-b border-gray-50">
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

export function ChangesByCcbDecisionWidget({ data }: WidgetProps) {
  const counts = new Map<string, number>()
  for (const i of data.icd_items) {
    if (i.item_type !== 'change') continue
    const key = i.ccb_decision ?? 'Pending'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const chartData = [...counts.entries()].map(([decision, count]) => ({ decision, count }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="decision" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#7c3aed" />
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

export function ResourceBudgetByTypeWidget({ data }: WidgetProps) {
  const chartData = sumBudgetBy(data.resource_assignments, a => a.resource_type)
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

export function ResourceBudgetByDisciplineWidget({ data }: WidgetProps) {
  const chartData = sumBudgetBy(data.resource_assignments, a => a.discipline ?? 'Unspecified').slice(0, 10)
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

export function ResourceBudgetByCompanyWidget({ data }: WidgetProps) {
  const chartData = sumBudgetBy(data.resource_assignments, a => a.company ?? 'Unassigned').slice(0, 10)
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

export function ResourceAssignmentsTableWidget({ data, filter }: WidgetProps) {
  // Filterable (2026-09-02, resource_name added same day — a real gap Poe
  // hit live: asked to narrow to one named resource, "Concrete Finishing
  // Crew," and could only offer a resource_type slice since no per-resource
  // filter existed). Exact match, not partial — same "never guess, use the
  // real value" discipline find_records already enforces for the id itself.
  const rows = data.resource_assignments
    .filter(a => !filter?.resource_type || a.resource_type === filter.resource_type)
    .filter(a => !filter?.resource_name || a.resource_name === filter.resource_name)
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
        {rows.map(a => (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2">{a.resource_name}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.role ?? '—'}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.activity_task_name}</td>
            <td className="py-1.5 pr-2">{formatCurrency(a.budget)}</td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={4} className="py-3 text-center text-gray-400 dark:text-prosota-muted">No resource assignments yet.</td></tr>
        )}
      </tbody>
    </table>
  )
}

export function TopResourcesByBudgetWidget({ data }: WidgetProps) {
  const byResource = new Map<string, { type: string; budget: number; activityCount: number }>()
  for (const a of data.resource_assignments) {
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

export function ClashDetailTableWidget({ data }: WidgetProps) {
  const rows = [...data.clash_pairs].sort((a, b) => {
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

export function NearCriticalWatchListWidget({ data }: WidgetProps) {
  const rows = data.schedule_activities
    .filter(a => a.total_float_hours !== null && Number(a.total_float_hours) > 0 && Number(a.total_float_hours) <= 80)
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
        {rows.map(a => (
          <tr key={a.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{a.code}</td>
            <td className="py-1.5 pr-2">{a.task_name}</td>
            <td className="py-1.5 pr-2 font-medium text-amber-600">{Number(a.total_float_hours).toFixed(1)}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{formatDate(a.finish)}</td>
          </tr>
        ))}
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

export function ActivityStatusWidget({ data }: WidgetProps) {
  const counts = { 'Not Started': 0, 'In Progress': 0, 'Complete': 0, 'Suspended': 0 }
  for (const a of data.schedule_activities) {
    const pct = a.pct_complete !== null ? Number(a.pct_complete) : 0
    if (a.suspend_date !== null && a.resume_date === null) counts.Suspended++
    else if (pct >= 100) counts.Complete++
    else if (pct > 0) counts['In Progress']++
    else counts['Not Started']++
  }
  const chartData = Object.entries(counts).map(([status, count]) => ({ status, count }))
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="status" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count">
          {chartData.map(d => <Cell key={d.status} fill={ACTIVITY_STATUS_COLORS[d.status]} />)}
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

export function LookaheadPlannerWidget({ data }: WidgetProps) {
  const [windowWeeks, setWindowWeeks] = useState<2 | 4 | 6>(4)
  const now = new Date()
  const cutoff = new Date(now.getTime() + windowWeeks * 7 * 86_400_000)
  // Sub-filters the same 6-week fetch rather than three separate ones —
  // same "one fetch, many views" split every other batch uses.
  const rows = data.lookahead_items
    .filter(i => i.start !== null && new Date(i.start) <= cutoff)
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

export function MitigationActionsTableWidget({ data }: WidgetProps) {
  const rows = [...data.mitigation_actions].sort((a, b) => {
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

export function RiskAgeingTableWidget({ data }: WidgetProps) {
  const now = new Date()
  const rows = data.risks
    .filter(r => r.status !== 'closed' && r.date_raised !== null)
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
        {rows.map(r => (
          <tr key={r.id} className="border-b border-gray-50">
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.code}</td>
            <td className="py-1.5 pr-2">{r.title}</td>
            <td className="py-1.5 pr-2 text-gray-500 dark:text-prosota-muted">{r.risk_owner ?? '—'}</td>
            <td className={`py-1.5 pr-2 font-medium ${r.daysOpen > 90 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-prosota-muted'}`}>{r.daysOpen}</td>
          </tr>
        ))}
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
export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  kpi_strip: { label: 'KPI Strip', category: 'Overview', defaultSize: { w: 12, h: 2 }, render: props => <KpiStripWidget {...props} /> },
  schedule_performance: { label: 'Schedule Performance', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <SchedulePerformanceWidget {...props} /> },
  risk_overview: { label: 'Risk Overview', category: 'Risk', defaultSize: { w: 6, h: 4 }, render: props => <RiskOverviewWidget {...props} /> },
  milestone_timeline: { label: 'Milestone Timeline', category: 'Schedule', defaultSize: { w: 6, h: 4 }, render: props => <MilestoneTimelineWidget {...props} /> },
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
