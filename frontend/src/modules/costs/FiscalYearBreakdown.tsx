import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { FyBreakdownResponse } from './types'

interface Props {
  projectId: string
  periodId: string
}

function formatCurrency(value: string | null) {
  if (value === null) return '—'
  const n = Number(value)
  const formatted = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-£${formatted}` : `£${formatted}`
}

// Portfolio-wide Budget/BL Budget/Actuals/Forecast, one column per UK fiscal
// year (2026-09-08, per Maro: "I'd like to see it per year... FY 10/11
// Budget, FY 11/12... this should apply to Budgets (Baselines too), Actuals
// and Forecast"). Budget/BL Budget are real — day-weighted from the
// schedule (see backend's own get_fy_breakdown for the full derivation).
// Actuals/Forecast are never invented: a past year's figures come verbatim
// from whichever real Cost Baseline was captured in it (blank if none was),
// and only the one "current" year mixes real live actuals-to-date with a
// reprofiled share of the remaining forecast — both clearly flagged below,
// per Maro's own distinction ("these should just be saved when baselines
// exist... I'm not saying you should magic any number" for actuals, vs "no,
// forecast can be reprofiled" — a forecast is a projection, actuals isn't).
export function FiscalYearBreakdown({ projectId, periodId }: Props) {
  const [data, setData] = useState<FyBreakdownResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<FyBreakdownResponse>('/api/v1/cost-elements/fy-breakdown', { params: { project_id: projectId, period_id: periodId } })
      .then(r => { if (!cancelled) setData(r.data) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, periodId])

  if (loading || !data || data.points.length === 0) return null

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg mb-4">
      <button
        onClick={() => setExpanded(prev => !prev)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="font-bold text-sm dark:text-prosota-paper">By Fiscal Year</span>
        <span className="text-xs text-gray-400 dark:text-prosota-muted">{expanded ? '▲ Collapse' : '▼ Expand'}</span>
      </button>
      {expanded && (
        <div className="overflow-x-auto border-t border-gray-200 dark:border-prosota-line">
          <table className="w-full text-xs text-left">
            <thead className="text-gray-500 dark:text-prosota-muted border-b border-gray-200 dark:border-prosota-line">
              <tr>
                <th className="px-4 py-2 font-medium">Fiscal Year</th>
                <th className="px-4 py-2 font-medium" title="Real, day-weighted from the resource-loaded schedule">Budget</th>
                <th className="px-4 py-2 font-medium" title="Real, day-weighted from the resource-loaded schedule, using the approved (bl_budget) baseline figure">BL Budget</th>
                <th className="px-4 py-2 font-medium" title="Real recorded actuals — from a saved Cost Baseline snapshot for a past year, or live-to-date for the current year">Actuals</th>
                <th className="px-4 py-2 font-medium" title="A real snapshot's own EAC for a past year; for the current year, real actuals-to-date plus a reprofiled share of the remaining forecast">Forecast</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map(p => (
                <tr key={p.label} className="border-b border-gray-100 dark:border-prosota-line/50">
                  <td className="px-4 py-2 font-medium text-gray-900 dark:text-prosota-paper">{p.label}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">{formatCurrency(p.budget)}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">{formatCurrency(p.bl_budget)}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">
                    {formatCurrency(p.actuals)}{p.actuals_is_ytd && p.actuals !== null && <span className="ml-1 text-[10px] text-prosota-amber" title="Cumulative to today, not yet a closed year">YTD</span>}
                  </td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">
                    {formatCurrency(p.forecast)}{p.forecast_is_reprofiled && p.forecast !== null && <span className="ml-1 text-[10px] text-prosota-amber" title="Includes a reprofiled share of the remaining forecast, not purely a saved snapshot">est.</span>}
                  </td>
                </tr>
              ))}
              {(data.unscheduled_budget !== null || data.unscheduled_bl_budget !== null) && (
                <tr>
                  <td className="px-4 py-2 font-medium text-gray-500 dark:text-prosota-muted" title="Cost lines with no linked, dated activity — can't honestly be assigned to any one year">Unscheduled</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">{formatCurrency(data.unscheduled_budget)}</td>
                  <td className="px-4 py-2 text-gray-600 dark:text-prosota-muted">{formatCurrency(data.unscheduled_bl_budget)}</td>
                  <td className="px-4 py-2">—</td>
                  <td className="px-4 py-2">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
