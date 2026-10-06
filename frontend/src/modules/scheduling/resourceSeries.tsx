import { useState } from 'react'

export type ResourceSeries = 'budget' | 'actual' | 'earned'
export const SERIES: { key: ResourceSeries; label: string; short: string }[] = [
  { key: 'budget', label: 'Budgeted', short: 'B' },
  { key: 'actual', label: 'Actuals', short: 'A' },
  { key: 'earned', label: 'Earned Value', short: 'EV' },
]

// Tracking and profile use the same time scale even with independent series selections.
export function resourcePeriodWidth(unit: 'hours' | 'days' | 'cost', seriesCount: number, print = false) {
  return (print ? 60 : unit === 'cost' ? 104 : 80) * Math.max(1, seriesCount)
}

export function useResourceSeries(key: string, defaults: ResourceSeries[]) {
  const [selected, setSelected] = useState<ResourceSeries[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
      const valid = SERIES.filter(s => Array.isArray(saved) && saved.includes(s.key)).map(s => s.key)
      return valid.length ? valid : defaults
    } catch { return defaults }
  })
  const change = (next: ResourceSeries[]) => {
    setSelected(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Preferences are optional. */ }
  }
  return [selected, change] as const
}

export function useOverallocationPreference(key: string) {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem(key) !== 'false' } catch { return true }
  })
  const change = (value: boolean) => {
    setEnabled(value)
    try { localStorage.setItem(key, String(value)) } catch { /* Optional preference. */ }
  }
  return [enabled, change] as const
}

export function OverallocationControl({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
  return <label className="inline-flex items-center gap-1 text-xs text-gray-600 dark:text-prosota-muted whitespace-nowrap">
    <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked)} />Show overallocation
  </label>
}

export function ResourceSeriesControls({ selected, onChange }: { selected: ResourceSeries[]; onChange: (next: ResourceSeries[]) => void }) {
  return <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-prosota-muted" role="group" aria-label="Displayed figures">
    {SERIES.map(s => <label key={s.key} className="inline-flex items-center gap-1 whitespace-nowrap">
      <input type="checkbox" checked={selected.includes(s.key)} disabled={selected.length === 1 && selected.includes(s.key)}
        onChange={() => onChange(SERIES.filter(item => item.key === s.key ? !selected.includes(s.key) : selected.includes(item.key)).map(item => item.key))} />
      {s.label}
    </label>)}
  </div>
}

export function formatResourceFigure(value: number | null, unit: 'hours' | 'days' | 'cost') {
  if (value === null) return ''
  return unit === 'cost' ? `£${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

export function ResourceFigures({ selected, budget, actual, earned, unit, overallocated = false }: {
  overallocated?: boolean
  selected: ResourceSeries[]; budget: number; actual: number | null; earned: number | null; unit: 'hours' | 'days' | 'cost'
}) {
  const values = { budget, actual, earned }
  return <div className="flex items-center justify-end gap-2 whitespace-nowrap">
    {selected.map(key => <span key={key} className={`flex-1 text-right ${key === 'budget' && overallocated ? 'text-red-600 dark:text-red-300 font-bold' : ''}`} title={SERIES.find(s => s.key === key)!.label}>
      {selected.length > 1 && <span className="opacity-70 mr-1">{SERIES.find(s => s.key === key)!.short}</span>}
      {key === 'budget' && values[key] === 0 ? '' : formatResourceFigure(values[key], unit)}
    </span>)}
  </div>
}
