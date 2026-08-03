import { useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { Activity } from './types'

export interface PasteFieldOption {
  key: 'task_name' | 'activity_type' | 'duration_hours' | 'start' | 'finish'
    | 'pct_complete' | 'constraint' | 'calendar_id'
  label: string
  hint?: string
  defaultChecked: boolean
}

interface Props {
  source: Activity
  targets: Activity[]
  options: PasteFieldOption[]
  onApplied: () => Promise<void>
  onClose: () => void
}

// Lets you pick exactly which of the copied row's fields actually get pasted
// (2026-07-04, per Maro — previously all-or-nothing). Start date and Finish
// date carry the same side effects inline-editing them does (a soft
// constraint / a recomputed duration), so they default unchecked rather than
// bundled in with the routine fields.
export function PasteFieldsWidget({ source, targets, options, onApplied, onClose }: Props) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(options.map(o => [o.key, o.defaultChecked]))
  )
  const [applying, setApplying] = useState(false)

  const toggle = (key: string) => setChecked(prev => ({ ...prev, [key]: !prev[key] }))
  const anyChecked = Object.values(checked).some(Boolean)

  const handleApply = async () => {
    const fieldLabels = options.filter(o => checked[o.key]).map(o => o.label)
    if (!(await confirmWithDontAsk(
      'scheduling.bulk-paste',
      `Paste ${fieldLabels.join(', ')} from "${source.code}: ${source.task_name}" onto ${targets.length} selected ` +
      `activit${targets.length === 1 ? 'y' : 'ies'}?\n\nThis overwrites their current values for those fields.`
    ))) return

    const payload: Record<string, unknown> = {}
    if (checked.task_name) payload.task_name = source.task_name
    if (checked.activity_type) payload.activity_type = source.activity_type
    if (checked.duration_hours) payload.duration_hours = source.duration_hours
    if (checked.pct_complete) payload.pct_complete = source.pct_complete
    if (checked.constraint) {
      payload.constraint_type = source.constraint_type
      payload.constraint_date = source.constraint_date
    }
    if (checked.calendar_id) payload.calendar_id = source.calendar_id
    // Applied last so they take precedence over the generic fields above if
    // both happen to be ticked at once (finish overrides duration server-side
    // anyway; start overrides a copied constraint since it's the more specific,
    // more deliberate of the two actions).
    if (checked.finish) payload.finish = source.finish
    if (checked.start) {
      payload.constraint_type = 'snet'
      payload.constraint_date = source.start
    }

    setApplying(true)
    try {
      for (const t of targets) {
        await api.patch(`/api/v1/activities/${t.id}`, payload)
      }
      await onApplied()
      onClose()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">📋</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Paste from "{source.code}: {source.task_name}"</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Choose which fields to apply to {targets.length} selected</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-x-4 gap-y-1.5 mb-4">
        {options.map(o => (
          <label key={o.key} className="flex items-start gap-1.5 text-xs text-gray-600 dark:text-prosota-muted" title={o.hint}>
            <input type="checkbox" checked={!!checked[o.key]} onChange={() => toggle(o.key)} className="mt-0.5" />
            <span>
              {o.label}
              {o.hint && <span className="block text-[10px] text-gray-400 dark:text-prosota-muted">{o.hint}</span>}
            </span>
          </label>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={!anyChecked || applying}
          className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-50"
        >
          {applying ? 'Applying…' : `Apply to ${targets.length}`}
        </button>
        <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          Cancel
        </button>
      </div>
    </div>
  )
}
