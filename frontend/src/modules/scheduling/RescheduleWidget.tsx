import { useState } from 'react'
import { api } from '@/lib/api'
import type { Period } from '@/lib/types'
import { formatDateTime } from './dateTime'

interface Props {
  period: Period
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

function formatDataDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// yyyy-mm-dd, matching what a date input and the backend's Date type both use.
function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function RescheduleWidget({ period, onApplied, onClose }: Props) {
  const [mode, setMode] = useState<'shift' | 'date'>('shift')
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward')
  const [amount, setAmount] = useState('1')
  const [unit, setUnit] = useState<'days' | 'weeks' | 'months'>('weeks')
  // Backend falls back to today when a period has never been anchored (see
  // app/services/scheduling_cpm.py:data_date_for_period) — same fallback here
  // so the date picker starts from the same value Reschedule would actually move.
  const [targetDate, setTargetDate] = useState(period.start_date ?? toIsoDate(new Date()))
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<RescheduleResult | null>(null)
  // The tool's own record of the data date — updated after each apply so repeated
  // reschedules within one open session show the right "current" value even before
  // the parent's own Period re-fetch (triggered via onApplied) resolves.
  // previousDataDate captures what it was right before the most recent apply, for
  // the before/after summary line.
  const [currentDataDate, setCurrentDataDate] = useState(period.start_date)
  const [previousDataDate, setPreviousDataDate] = useState<string | null>(null)

  const shiftDays = mode === 'shift'
    ? (Number(amount) || 0) * UNIT_DAYS[unit] * (direction === 'forward' ? 1 : -1)
    : Math.round(
        (new Date(`${targetDate}T00:00:00`).getTime() - new Date(`${currentDataDate ?? toIsoDate(new Date())}T00:00:00`).getTime())
        / 86_400_000
      )

  const describeShift = () => mode === 'shift'
    ? `${direction === 'forward' ? 'forward' : 'backward'} by ${amount} ${unit}`
    : `to ${formatDataDate(targetDate)}`

  const handleApply = async () => {
    if (shiftDays === 0) return
    if (!window.confirm(
      `Shift the whole schedule ${describeShift()}?\n\n` +
      `Activities already in progress (% Complete > 0) keep their Start — only their Finish updates, based on ` +
      `remaining duration. Activities pinned by a hard constraint (Mandatory Start / Finish On or Before) won't ` +
      `move either — that's correct, not a bug.`
    )) return
    setApplying(true)
    try {
      const { data } = await api.post<RescheduleResult>('/api/v1/activities/reschedule', null, {
        params: { period_id: period.id, shift_days: shiftDays },
      })
      setResult(data)
      setPreviousDataDate(currentDataDate)
      setCurrentDataDate(data.new_anchor_date)
      setTargetDate(data.new_anchor_date)
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

      <div className="flex items-center gap-2 mb-3 bg-gray-50 border border-gray-200 rounded-md px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Date</span>
        <span className="text-sm font-bold text-gray-900">{formatDataDate(currentDataDate)}</span>
        <span className="text-xs text-gray-400 ml-1">
          — the anchor unconstrained, not-yet-started activities can't start earlier than; this is what Reschedule
          actually moves.
        </span>
      </div>

      <div className="flex gap-3 mb-3 text-xs">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'shift'} onChange={() => setMode('shift')} />
          Shift by an amount
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={mode === 'date'} onChange={() => setMode('date')} />
          Set data date directly
        </label>
      </div>

      {mode === 'shift' ? (
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
      ) : (
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1">New Data Date</div>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 mb-1">Apply To</div>
            <div className="w-full border border-gray-200 rounded-md px-3 py-1.5 text-sm bg-gray-50 text-gray-500">
              All unconstrained activities
            </div>
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-800 mb-3">
        Moves the data date {describeShift()} and re-runs the critical path engine. Activities already in progress
        (% Complete &gt; 0) keep their Start — only their Finish updates, from remaining duration. Activities with a
        hard constraint (Mandatory Start / Finish On or Before) don't move either — dates are computed from
        duration + logic + calendar, not typed in, so there's no other honest way to "move" a constrained date.
      </div>

      {result && (
        <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-xs text-blue-800 mb-3 space-y-1">
          <div>Data date: <strong>{formatDataDate(previousDataDate)}</strong> → <strong>{formatDataDate(result.new_anchor_date)}</strong></div>
          <div>Project finish: <strong>{formatDateTime(result.old_project_finish)}</strong> → <strong>{formatDateTime(result.new_project_finish)}</strong></div>
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
