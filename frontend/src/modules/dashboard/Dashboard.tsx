import { useState } from 'react'
import { BaselineComparison } from './BaselineComparison'
import { Overview } from './Overview'

const TABS = ['Overview', 'Baseline Comparison'] as const
type Tab = (typeof TABS)[number]

export function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview')

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Controls Dashboard</h1>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
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
