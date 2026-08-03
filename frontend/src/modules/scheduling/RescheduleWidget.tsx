import axios from 'axios'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { SchedulePeriod } from './types'
import { formatDateTime } from './dateTime'

interface Props {
  period: SchedulePeriod
  onApplied: () => Promise<void>
  onClose: () => void
}

interface RescheduleResult {
  shift_days: number | null
  old_project_finish: string | null
  new_project_finish: string | null
  new_anchor_date: string
  new_anchor_time: string | null
}

const UNIT_DAYS: Record<string, number> = { days: 1, weeks: 7, months: 30 }

function formatDataDate(dateIso: string | null, timeIso?: string | null): string {
  if (!dateIso) return '—'
  const d = new Date(`${dateIso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return '—'
  const datePart = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  return timeIso ? `${datePart}, ${timeIso.slice(0, 5)}` : datePart
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
  // Blank = "use the default calendar's day start" (2026-07-03, per Maro —
  // wants the option to pick a time too, "similar to the calendar").
  const [targetTime, setTargetTime] = useState(period.start_time?.slice(0, 5) ?? '')
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<RescheduleResult | null>(null)
  // The tool's own record of the data date — updated after each apply so repeated
  // reschedules within one open session show the right "current" value even before
  // the parent's own Period re-fetch (triggered via onApplied) resolves.
  // previousDataDate captures what it was right before the most recent apply, for
  // the before/after summary line.
  const [currentDataDate, setCurrentDataDate] = useState(period.start_date)
  const [currentDataTime, setCurrentDataTime] = useState(period.start_time)
  const [previousDataDate, setPreviousDataDate] = useState<string | null>(null)
  const [previousDataTime, setPreviousDataTime] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keeps the widget's own "current data date" display in sync with the real
  // Period record whenever the parent's own fetch of it changes — not just
  // the mount-time snapshot the useState initializers above captured. Belt-
  // and-braces alongside handleApply's own explicit setters below, so
  // there's no window where this widget could be comparing targetDate
  // against a value that's gone stale relative to the server's own record
  // (2026-07-04, per Maro: a reported "first apply does nothing" case).
  useEffect(() => {
    setCurrentDataDate(period.start_date)
    setCurrentDataTime(period.start_time)
  }, [period.start_date, period.start_time])

  const shiftDays = mode === 'shift'
    ? (Number(amount) || 0) * UNIT_DAYS[unit] * (direction === 'forward' ? 1 : -1)
    : Math.round(
        (new Date(`${targetDate}T00:00:00`).getTime() - new Date(`${currentDataDate ?? toIsoDate(new Date())}T00:00:00`).getTime())
        / 86_400_000
      )
  const timeChanged = mode === 'date' && targetTime !== (currentDataTime?.slice(0, 5) ?? '')
  const canApply = mode === 'shift' ? shiftDays !== 0 : (shiftDays !== 0 || timeChanged)

  const describeShift = () => mode === 'shift'
    ? `${direction === 'forward' ? 'forward' : 'backward'} by ${amount} ${unit}`
    : `to ${formatDataDate(targetDate, targetTime ? `${targetTime}:00` : null)}`

  const handleApply = async () => {
    if (!canApply) return
    if (!(await confirmWithDontAsk(
      'scheduling.reschedule-apply',
      `Shift the whole schedule ${describeShift()}?\n\n` +
      `Activities already in progress (% Complete > 0) keep their Start — only their Finish updates, based on ` +
      `remaining duration. Activities pinned by a hard constraint (Mandatory Start / Finish On or Before) won't ` +
      `move either — that's correct, not a bug.`
    ))) return
    setApplying(true)
    setError(null)
    try {
      const { data } = mode === 'shift'
        ? await api.post<RescheduleResult>('/api/v1/activities/reschedule', null, {
            params: { schedule_period_id: period.id, shift_days: shiftDays },
          })
        : await api.post<RescheduleResult>(
            '/api/v1/activities/set-data-date',
            { date: targetDate, time: targetTime ? `${targetTime}:00` : null },
            { params: { schedule_period_id: period.id } },
          )
      setResult(data)
      setPreviousDataDate(currentDataDate)
      setPreviousDataTime(currentDataTime)
      setCurrentDataDate(data.new_anchor_date)
      setCurrentDataTime(data.new_anchor_time)
      setTargetDate(data.new_anchor_date)
      setTargetTime(data.new_anchor_time?.slice(0, 5) ?? '')
      await onApplied()
    } catch (err) {
      // Previously swallowed silently (no catch at all) — a failed apply
      // (e.g. a validation error) looked exactly like "nothing happens,"
      // indistinguishable from a real bug. Now it says so.
      const detail = axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
      setError(detail ?? 'Could not apply the reschedule — check your connection and try again.')
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🔄</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Reschedule</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Shift the whole programme forward or backward</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <div className="flex items-center gap-2 mb-3 bg-gray-50 dark:bg-prosota-panel2 border border-gray-200 dark:border-prosota-line rounded-md px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide">Data Date</span>
        <span className="text-sm font-bold text-gray-900 dark:text-prosota-paper">{formatDataDate(currentDataDate, currentDataTime)}</span>
        <span className="text-xs text-gray-400 dark:text-prosota-muted ml-1">
          — the anchor unconstrained, not-yet-started activities can't start earlier than; this is what Reschedule
          actually moves. No time set means the default calendar's day start.
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
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Direction</div>
            <select
              value={direction}
              onChange={e => setDirection(e.target.value as 'forward' | 'backward')}
              className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
            >
              <option value="forward">Forward (+)</option>
              <option value="backward">Backward (–)</option>
            </select>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Shift By</div>
            <div className="flex gap-2">
              <input
                type="number"
                min={1}
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-16 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-sm"
              />
              <select
                value={unit}
                onChange={e => setUnit(e.target.value as 'days' | 'weeks' | 'months')}
                className="flex-1 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-sm"
              >
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
                <option value="months">Months (≈30d)</option>
              </select>
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Apply To</div>
            <div className="w-full border border-gray-200 dark:border-prosota-line rounded-md px-3 py-1.5 text-sm bg-gray-50 dark:bg-prosota-panel2 text-gray-500 dark:text-prosota-muted">
              All unconstrained activities
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">New Data Date</div>
            <input
              type="date"
              value={targetDate}
              onChange={e => setTargetDate(e.target.value)}
              className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Time (optional)</div>
            <input
              type="time"
              value={targetTime}
              onChange={e => setTargetTime(e.target.value)}
              title="Leave blank to use the default calendar's day start"
              className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-1">Apply To</div>
            <div className="w-full border border-gray-200 dark:border-prosota-line rounded-md px-3 py-1.5 text-sm bg-gray-50 dark:bg-prosota-panel2 text-gray-500 dark:text-prosota-muted">
              All unconstrained activities
            </div>
          </div>
        </div>
      )}

      <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-md px-3 py-2 text-xs text-amber-800 dark:text-amber-400 mb-3">
        Moves the data date {describeShift()} and re-runs the critical path engine. Activities already in progress
        (% Complete &gt; 0) keep their Start — only their Finish updates, from remaining duration. Activities with a
        hard constraint (Mandatory Start / Finish On or Before) don't move either — dates are computed from
        duration + logic + calendar, not typed in, so there's no other honest way to "move" a constrained date.
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-md px-3 py-2 text-xs text-red-800 dark:text-red-400 mb-3">{error}</div>
      )}

      {result && (
        <div className="bg-blue-50 border border-blue-200 dark:border-prosota-azure/30 rounded-md px-3 py-2 text-xs text-blue-800 mb-3 space-y-1">
          <div>Data date: <strong>{formatDataDate(previousDataDate, previousDataTime)}</strong> → <strong>{formatDataDate(result.new_anchor_date, result.new_anchor_time)}</strong></div>
          <div>Project finish: <strong>{formatDateTime(result.old_project_finish)}</strong> → <strong>{formatDateTime(result.new_project_finish)}</strong></div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={handleApply}
          disabled={applying || !canApply}
          className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-50"
        >
          {applying ? 'Applying…' : '✓ Apply Reschedule'}
        </button>
        <button onClick={onClose} className="text-sm px-4 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-panel2">
          Close
        </button>
      </div>
    </div>
  )
}
