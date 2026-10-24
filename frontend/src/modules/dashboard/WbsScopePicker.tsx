import { ActivityPicker } from '@/modules/scheduling/ActivityPicker'
import type { useWbsOptions } from '@/lib/useWbsOptions'

export function WbsScopePicker({ lookup }: { lookup: ReturnType<typeof useWbsOptions> }) {
  if (lookup.loading) return <span role="status" className="text-xs text-gray-500 dark:text-prosota-muted">Loading WBS…</span>
  if (lookup.error) return <span role="alert" className="text-xs text-amber-700 dark:text-prosota-amber">
    WBS choices couldn’t load.{' '}<button className="underline" onClick={lookup.retry}>Retry WBS</button>
  </span>
  return <div className="w-56"><ActivityPicker activities={lookup.options} value={lookup.selectedId} onChange={lookup.select} placeholder="Whole schedule" /></div>
}
