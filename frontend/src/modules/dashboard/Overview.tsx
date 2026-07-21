import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { useScheduleSubprojects } from '@/lib/scheduleSubprojects'
import { DashboardGrid } from './DashboardGrid'
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

      <DashboardGrid
        projectId={selectedProject?.id}
        widgetProps={{ data, onNavigateToRisks: () => navigate('/risks'), projectId: selectedProject?.id }}
      />
    </div>
  )
}
