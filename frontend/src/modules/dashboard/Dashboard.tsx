import { useState } from 'react'
import { BaselineComparison } from './BaselineComparison'
import { Overview } from './Overview'
import { useProject } from '@/lib/ProjectContext'
import { useActivePeriod } from '@/lib/usePeriod'
import { useActiveScheduleVariant } from '@/lib/useScheduleVariant'
import { IntegratedIfcExportDialog } from '../fourD/IntegratedIfcExportDialog'

const TABS = ['Overview', 'Baseline Comparison'] as const
type Tab = (typeof TABS)[number]

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview')
  const [powerBI, setPowerBI] = useState(false)
  const { selectedProject } = useProject()
  const { period } = useActivePeriod(selectedProject?.id)
  const { period: schedule } = useActiveScheduleVariant(selectedProject?.id)

  return (
    <div className="p-6 space-y-4">
      <div className="no-print flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-prosota-paper">Reporting &amp; Controls</h1>
        <button
          disabled={!selectedProject || !period || !schedule} onClick={() => setPowerBI(true)}
          className="rounded bg-blue-600 text-white px-3 py-2 text-sm disabled:opacity-50">
          Open in Power BI
        </button>
      </div>
      {powerBI && selectedProject && period && schedule && <IntegratedIfcExportDialog
        key={selectedProject.id} project={selectedProject} schedulePeriodId={schedule.id}
        costPeriodId={period.id} destination="powerbi" onClose={() => setPowerBI(false)} />}

      <div className="no-print flex gap-1 border-b border-gray-200 dark:border-prosota-line">
        {TABS.map(t => (
          <button
            key={t}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600 dark:text-prosota-azure' : 'border-transparent text-gray-500 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper'}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? <Overview /> : <BaselineComparison />}
    </div>
  )
}
