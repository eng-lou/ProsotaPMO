import type { IcdItem } from './types'

interface IcdKpiStripProps {
  items: IcdItem[]
}

function formatCurrency(value: number) {
  return value < 0 ? `-£${Math.abs(value).toLocaleString()}` : `£${value.toLocaleString()}`
}

interface Kpi {
  label: string
  value: string
  tone: 'neutral' | 'warn' | 'good'
}

const TONE_STYLES: Record<Kpi['tone'], string> = {
  neutral: 'text-gray-900 dark:text-prosota-paper',
  warn: 'text-red-600 dark:text-red-400',
  good: 'text-green-600',
}

// Pure client-side aggregation over the already-loaded items list — same
// complexity as the Risk Register's group-by counts, no new endpoints.
// Always reflects the full item set (not the current search/filter), so it
// reads like a stable dashboard header rather than shifting under filtering.
export function IcdKpiStrip({ items }: IcdKpiStripProps) {
  const issues = items.filter(i => i.item_type === 'issue')
  const changes = items.filter(i => i.item_type === 'change')
  const decisions = items.filter(i => i.item_type === 'decision')

  const openIssues = issues.filter(i => i.status !== 'closed').length
  const overdueIssues = issues.filter(i => i.status === 'overdue').length

  // A change is "approved" if either the Status field or the separate CCB
  // decision field says so — the two overlap in practice (Status offers the
  // same pending_approval/approved/rejected states), and editing just one of
  // them shouldn't leave the KPI stuck on the other's stale value.
  const isApproved = (c: IcdItem) => c.status === 'approved' || c.ccb_decision === 'approved'
  const isRejected = (c: IcdItem) => c.status === 'rejected' || c.ccb_decision === 'rejected'
  const approvedChanges = changes.filter(isApproved)
  const pendingChanges = changes.filter(c => !isApproved(c) && !isRejected(c)).length
  const netCostImpact = approvedChanges.reduce((sum, c) => sum + (c.cost_impact ? Number(c.cost_impact) : 0), 0)
  const netScheduleImpact = approvedChanges.reduce((sum, c) => sum + (c.schedule_impact_days ?? 0), 0)

  const pendingDecisions = decisions.filter(d => d.status !== 'decided').length
  const decisionsMade = decisions.filter(d => d.status === 'decided').length

  const kpis: Kpi[] = [
    { label: 'Open Issues', value: String(openIssues), tone: 'neutral' },
    { label: 'Overdue Issues', value: String(overdueIssues), tone: overdueIssues > 0 ? 'warn' : 'neutral' },
    { label: 'Pending Changes', value: String(pendingChanges), tone: 'neutral' },
    { label: 'Approved Changes', value: String(approvedChanges.length), tone: 'good' },
    { label: 'Net Approved Impact', value: `${formatCurrency(netCostImpact)} · ${netScheduleImpact >= 0 ? '+' : ''}${netScheduleImpact}d`, tone: 'neutral' },
    { label: 'Pending Decisions', value: String(pendingDecisions), tone: pendingDecisions > 0 ? 'warn' : 'neutral' },
    { label: 'Decisions Made', value: String(decisionsMade), tone: 'good' },
  ]

  return (
    <div className="grid grid-cols-4 md:grid-cols-7 gap-3 mb-4">
      {kpis.map(k => (
        <div key={k.label} className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg px-3 py-2.5">
          <div className={`text-lg font-bold ${TONE_STYLES[k.tone]}`}>{k.value}</div>
          <div className="text-xs text-gray-500 dark:text-prosota-muted">{k.label}</div>
        </div>
      ))}
    </div>
  )
}
