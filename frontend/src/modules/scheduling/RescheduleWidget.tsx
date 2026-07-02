import { useState } from 'react'
import { api } from '@/lib/api'

interface Props {
  periodId: string
  onApplied: () => Promise<void>
  onClose: () => void
}

interface RescheduleResult {
  shift_days: number
  old_project_finish: string | null
  new_project_finish: string | null
  new_anchor_date: string
}

const UNIT_DAYS: Record<string, number> = { days: 1, weeks: 7, months: 30 }

export function RescheduleWidget({ periodId, onApplied, onClose }: Props) {
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<'days' | 'weeks' | 'months'>('weeks')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<RescheduleResult | null>(null)

  const shiftDays = (Number(amount) || 0) * UNIT_DAYS[unit] * (direction === 'forward' ? 1 : -1)

  const handleApply = async () => {
    if (shiftDays === 0) return
    if (!window.confirm(
      `Shift the whole schedule ${direction === 'forward' ? 'forward' : 'backward'} by ${amount} ${unit}?\n\n` +
      `Activities pinned by a hard constraint (Mandatory Start / Finish On or Before) won't move — that's correct, not a bug.`
    )) return
    setApplying(true)
    try {
      const { data } = await api.post<RescheduleResult>('/api/v1/activities/reschedule', null, {
        params: { period_id: periodId, shift_days: shiftDays },
      })
      setResult(data)
      await onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔄</span>
        <div className="font-bold text-sm">Reschedule</div>
        <div className="text-xs text-gray-400">Shift the whole programme forward or backward</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Direction</div>
          <select
            value={direction}
            onChange={e => setDirection(e.target.value as 'forward' | 'backward')}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="forward">Forward (+)</option>
            <option value="backward">Backward (–)</option>
          </select>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Shift By</div>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="w-16 border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            />
            <select
              value={unit}
              onChange={e => setUnit(e.target.value as 'days' | 'weeks' | 'months')}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            >
              <option value="days">Days</option>
              <option value="weeks">Weeks</option>
              <option value="months">Months (≈30d)</option>
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-600 mb-1">Apply To</div>
          <div className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-gray-50 text-gray-500">
            All unconstrained activities
          </div>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 mb-3">
        Shifts the schedule anchor by {amount} {unit} and re-runs the critical path engine. Activities with a hard
        constraint (Mandatory Start / Finish On or Before) deliberately don't move — dates are computed from
        duration + logic + calendar, not typed in, so there's no other honest way to "move" a constrained date.
      </div>

      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-800 mb-3">
          Project finish: <strong>{result.old_project_finish ?? '—'}</strong> → <strong>{result.new_project_finish ?? '—'}</strong>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={applying || shiftDays === 0}
          className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : '✓ Apply Reschedule'}
        </button>
        <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50">
          Close
        </button>
      </div>
    </div>
  )
}
