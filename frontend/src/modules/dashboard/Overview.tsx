import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { useScheduleSubprojects } from '@/lib/scheduleSubprojects'
import { MilestoneTrack } from './MilestoneTrack'
import type { DashboardOverviewResponse } from './types'

// EMV is signed (threats negative, opportunities positive) — same convention
// as RiskRegister.tsx's own formatCurrency.
export function formatCurrency(value: string | number) {
  const n = Number(value)
  return n < 0 ? `-£${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : `£${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

export function formatDate(value: string | null) {
  if (value === null) return '—'
  return new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const RISK_BAND_COLORS: Record<string, string> = { Low: '#16a34a', Medium: '#d97706', High: '#dc2626' }

export function Overview() {
  const navigate = useNavigate()
  const { selectedProject } = useProject()
  const { period, loading: periodLoading } = useActivePeriod(selectedProject?.id)
  const { period: schedulePeriod, loading: scheduleLoading } = useActiveScheduleVariant(selectedProject?.id)
  const { subprojects } = useScheduleSubprojects(selectedProject?.id)

  const [subprojectId, setSubprojectId] = useState<string>('whole')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [data, setData] = useState<DashboardOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!selectedProject || !period || !schedulePeriod) return
    setLoading(true)
    api.get<DashboardOverviewResponse>('/api/v1/dashboard/overview', {
      params: {
        project_id: selectedProject.id,
        period_id: period.id,
        schedule_period_id: schedulePeriod.id,
        subproject_id: subprojectId === 'whole' ? undefined : subprojectId,
        critical_only: criticalOnly,
      },
    })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [selectedProject?.id, period?.id, schedulePeriod?.id, subprojectId, criticalOnly])

  if (periodLoading || scheduleLoading || loading || !data) {
    return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  }

  const { kpis, schedule_buckets, milestones, top_risks, risk_overview, risk_exposure } = data
  const bucketPct = (n: number) => (schedule_buckets.total > 0 ? Math.round((n / schedule_buckets.total) * 100) : 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <div className="flex items-center gap-3 text-sm">
          <select
            className="border border-gray-300 rounded-md px-2 py-1.5"
            value={subprojectId}
            onChange={e => setSubprojectId(e.target.value)}
          >
            <option value="whole">Whole schedule</option>
            {subprojects.map(sp => (
              <option key={sp.id} value={sp.id}>{sp.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} />
            Critical path only
          </label>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Planned Finish</div>
          <div className="text-lg font-bold text-gray-900">{formatDate(kpis.planned_finish)}</div>
          {kpis.planned_finish_status !== 'unknown' && (
            <span className={`inline-block mt-1 text-xs px-1.5 py-0.5 rounded ${kpis.planned_finish_status === 'delayed' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
              {kpis.planned_finish_status === 'delayed' ? 'Delayed' : 'On track'}
            </span>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Open Issues</div>
          <div className="text-lg font-bold text-gray-900">{kpis.open_issues}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Open Changes</div>
          <div className="text-lg font-bold text-gray-900">{kpis.open_changes}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Schedule SPI</div>
          <div className="text-lg font-bold text-gray-900">{kpis.schedule_spi !== null ? Number(kpis.schedule_spi).toFixed(2) : '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">BAC</div>
          <div className="text-lg font-bold text-gray-900">{kpis.bac !== null ? formatCurrency(kpis.bac) : '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">EAC</div>
          <div className="text-lg font-bold text-gray-900">{kpis.eac !== null ? formatCurrency(kpis.eac) : '—'}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Cost CPI</div>
          <div className={`text-lg font-bold ${kpis.cpi !== null && Number(kpis.cpi) < 1 ? 'text-orange-600' : 'text-gray-900'}`}>
            {kpis.cpi !== null ? Number(kpis.cpi).toFixed(2) : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Schedule Performance */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="font-semibold text-sm mb-3">Schedule Performance</div>
          <div className="space-y-2 text-xs">
            {([
              ['On-Time', schedule_buckets.on_time, 'bg-green-500'],
              ['At Risk', schedule_buckets.at_risk, 'bg-amber-500'],
              ['Delayed', schedule_buckets.delayed, 'bg-red-500'],
            ] as const).map(([label, count, color]) => (
              <div key={label}>
                <div className="flex justify-between mb-0.5">
                  <span className="text-gray-600">{label}</span>
                  <span className="font-medium">{count} ({bucketPct(count)}%)</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${bucketPct(count)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Overview */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="font-semibold text-sm mb-3">Risk Overview</div>
          <div className="grid grid-cols-3 gap-2 text-center mb-3">
            <div className="bg-red-50 rounded-md p-2.5">
              <div className="text-lg font-bold text-red-700">{risk_overview.high}</div>
              <div className="text-xs text-red-600">High</div>
            </div>
            <div className="bg-amber-50 rounded-md p-2.5">
              <div className="text-lg font-bold text-amber-700">{risk_overview.medium}</div>
              <div className="text-xs text-amber-600">Medium</div>
            </div>
            <div className="bg-green-50 rounded-md p-2.5">
              <div className="text-lg font-bold text-green-700">{risk_overview.low}</div>
              <div className="text-xs text-green-600">Low</div>
            </div>
          </div>
          <div className="flex justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
            <span>Open: {risk_overview.open}</span>
            <span>Closed: {risk_overview.closed}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Milestone Timeline */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="font-semibold text-sm mb-3">Milestone Timeline</div>
          <MilestoneTrack milestones={milestones} />
        </div>

        {/* Schedule vs Risk Exposure */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="font-semibold text-sm mb-3" title="Current period only — a period-over-period trend needs baseline history (see the Baseline Comparison tab).">
            Risk Exposure (this period)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={risk_exposure.map(b => ({ ...b, magnitude: Math.abs(Number(b.emv_cost)) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="band" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `£${(v / 1000).toFixed(0)}k`} />
              <Tooltip formatter={(_v, _n, item) => formatCurrency(item.payload.emv_cost)} />
              <Bar dataKey="magnitude">
                {risk_exposure.map(b => <Cell key={b.band} fill={RISK_BAND_COLORS[b.band]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top 5 Risks */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="font-semibold text-sm mb-3">Top 5 Risks</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              <th className="py-1.5 pr-2">Code</th>
              <th className="py-1.5 pr-2">Title</th>
              <th className="py-1.5 pr-2">Status</th>
              <th className="py-1.5 pr-2">Rating</th>
              <th className="py-1.5 pr-2">EMV Cost</th>
              <th className="py-1.5 pr-2">EMV Days</th>
            </tr>
          </thead>
          <tbody>
            {top_risks.map(r => (
              <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => navigate('/risks')}>
                <td className="py-1.5 pr-2 text-gray-500">{r.code}</td>
                <td className="py-1.5 pr-2">{r.title}</td>
                <td className="py-1.5 pr-2 text-gray-500">{r.status}</td>
                <td className="py-1.5 pr-2">{r.rating !== null ? Number(r.rating).toFixed(2) : '—'}</td>
                <td className="py-1.5 pr-2">{r.emv_cost !== null ? formatCurrency(r.emv_cost) : '—'}</td>
                <td className="py-1.5 pr-2">{r.emv_schedule_days !== null ? Number(r.emv_schedule_days).toFixed(1) : '—'}</td>
              </tr>
            ))}
            {top_risks.length === 0 && (
              <tr><td colSpan={6} className="py-3 text-center text-gray-400">No risks yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
