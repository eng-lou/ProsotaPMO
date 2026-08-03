import axios from 'axios'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { ScheduleBaseline, ScheduleVariant } from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

interface Props {
  periodId: string
  // Every *other* schedule variant in the project (not the one this widget
  // is currently open against) — offered as a source to baseline FROM
  // (docs/SCHEDULE_VARIANTS_PLAN.md §D.7 — Maro: "the ability to use the
  // second programme and assign the original schedule as a baseline is
  // important and vice versa"). Empty on a project with only one schedule —
  // the cross-variant option simply doesn't show.
  otherVariants: ScheduleVariant[]
  onChange: () => Promise<void>
  // "Open a baseline as a working schedule" (docs/SCHEDULING_GAPS_PLAN.md
  // Phase 6) — forks a new, editable ScheduleVariant from a baseline's own
  // captured snapshot and switches to it. See useScheduleVariant.ts.
  onPromote: (baselineId: string, name: string) => Promise<{ variant: ScheduleVariant; relationships_from_baseline_snapshot: boolean }>
  onClose: () => void
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// '' = baseline this schedule's own current state (the original, same-variant
// capture) — matches the native <select>'s own empty-string convention
// rather than inventing a sentinel, same pattern already used for
// SchedulingQualityWidget's scope selector.
const CURRENT_SCHEDULE = ''

export function BaselineWidget({ periodId, otherVariants, onChange, onPromote, onClose }: Props) {
  const [baselines, setBaselines] = useState<ScheduleBaseline[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [sourceVariantId, setSourceVariantId] = useState(CURRENT_SCHEDULE)
  const [error, setError] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const [promoteName, setPromoteName] = useState('')
  const [promoteBusy, setPromoteBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await api.get<ScheduleBaseline[]>('/api/v1/schedule-baselines/', { params: { schedule_period_id: periodId } })
    setBaselines(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [periodId])

  const handleCreate = async () => {
    if (!name.trim() || !date) return
    setError(null)
    try {
      if (sourceVariantId === CURRENT_SCHEDULE) {
        await api.post('/api/v1/schedule-baselines/', { schedule_period_id: periodId, name, baseline_date: date })
      } else {
        await api.post('/api/v1/schedule-baselines/from-variant', {
          schedule_period_id: periodId, source_schedule_variant_id: sourceVariantId, name, baseline_date: date,
        })
      }
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not save that baseline — check your connection and try again.')
      return
    }
    setCreating(false)
    setName('')
    setDate(today())
    setSourceVariantId(CURRENT_SCHEDULE)
    await load()
  }

  const handleAssign = async (b: ScheduleBaseline) => {
    if (!(await confirmWithDontAsk(
      'scheduling.baseline-assign',
      `Assign "${b.name}" as the active baseline? This overwrites BL Start/BL Finish/Fin. Var (d) on every activity in this period with ${b.name}'s captured dates.`
    ))) return
    setAssigningId(b.id)
    try {
      await api.post(`/api/v1/schedule-baselines/${b.id}/assign`)
      await Promise.all([load(), onChange()])
    } finally {
      setAssigningId(null)
    }
  }

  const handleUnassign = async (b: ScheduleBaseline) => {
    if (!(await confirmWithDontAsk(
      'scheduling.baseline-unassign',
      `Unassign "${b.name}"? BL Start/BL Finish/Fin. Var (d) clear on every activity in this period. The saved baseline itself isn't deleted — you can assign it again later.`
    ))) return
    setAssigningId(b.id)
    try {
      await api.post(`/api/v1/schedule-baselines/${b.id}/unassign`)
      await Promise.all([load(), onChange()])
    } finally {
      setAssigningId(null)
    }
  }

  const handleConfirmPromote = async (b: ScheduleBaseline) => {
    if (!promoteName.trim()) return
    setPromoteBusy(true)
    try {
      const result = await onPromote(b.id, promoteName.trim())
      if (!result.relationships_from_baseline_snapshot) {
        window.alert(
          `"${b.name}" was captured before baselines saved relationship logic, so "${promoteName.trim()}" was seeded ` +
          'with the current live relationships between its matched activities instead of a true historical snapshot.'
        )
      }
      setPromotingId(null)
      setPromoteName('')
      onClose()
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not promote that baseline — check your connection and try again.')
    } finally {
      setPromoteBusy(false)
    }
  }

  const handleDelete = async (b: ScheduleBaseline) => {
    if (!(await confirmWithDontAsk(
      'scheduling.baseline-delete',
      `Delete the saved baseline "${b.name}"? This cannot be undone.${
        b.is_active ? '\n\nIt is currently assigned — deleting it clears BL Start/BL Finish/Fin. Var (d) on every activity in this period, since there\'d be no baseline left for them to reflect.' : ''
      }`
    ))) return
    await api.delete(`/api/v1/schedule-baselines/${b.id}`)
    await Promise.all([load(), onChange()])
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Baseline</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Capture a named, dated snapshot of the current schedule, then choose which saved one is assigned</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Date</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right">Activities</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(b => (
            <tr key={b.id} className={b.is_active ? 'bg-blue-50/50 dark:bg-prosota-azure/10' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium">{b.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted">{b.baseline_date}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right text-gray-500 dark:text-prosota-muted">{b.activity_count}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                {b.is_active ? (
                  <span className="flex items-center gap-2">
                    <span className="text-blue-600 dark:text-prosota-azure font-medium">✓ Assigned</span>
                    <button
                      onClick={() => handleUnassign(b)}
                      disabled={assigningId === b.id}
                      className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper disabled:opacity-40"
                    >
                      Unassign
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => handleAssign(b)}
                    disabled={assigningId === b.id}
                    className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan disabled:opacity-40"
                  >
                    Assign
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                {promotingId === b.id ? (
                  <span className="flex items-center gap-1">
                    <input
                      value={promoteName}
                      onChange={e => setPromoteName(e.target.value)}
                      placeholder="New schedule name"
                      autoFocus
                      className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs w-36"
                    />
                    <button
                      onClick={() => handleConfirmPromote(b)}
                      disabled={promoteBusy || !promoteName.trim()}
                      className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan disabled:opacity-40"
                    >
                      Go
                    </button>
                    <button
                      onClick={() => { setPromotingId(null); setPromoteName('') }}
                      className="text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper"
                    >
                      ✕
                    </button>
                  </span>
                ) : (
                  <button
                    onClick={() => { setPromotingId(b.id); setPromoteName(`${b.name} (Schedule)`) }}
                    title="Fork a brand new, editable schedule seeded from this baseline's captured snapshot"
                    className="text-gray-500 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper"
                  >
                    Promote to Schedule
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right">
                <button onClick={() => handleDelete(b)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">Delete</button>
              </td>
            </tr>
          ))}
          {baselines.length === 0 && !loading && (
            <tr><td colSpan={6} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted border border-gray-200 dark:border-prosota-line">No baselines saved yet for this period</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 dark:border-prosota-line rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600 dark:text-prosota-muted">
            Name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Contract Baseline"
              autoFocus
              className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5 w-48"
            />
          </label>
          <label className="text-xs text-gray-600 dark:text-prosota-muted">
            Date
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5"
            />
          </label>
          {otherVariants.length > 0 && (
            <label className="text-xs text-gray-600 dark:text-prosota-muted">
              Baseline from
              <select
                value={sourceVariantId}
                onChange={e => setSourceVariantId(e.target.value)}
                title="Capture this baseline from a different schedule's current dates instead of this one's own"
                className="block border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1 text-xs mt-0.5"
              >
                <option value={CURRENT_SCHEDULE}>This schedule (current state)</option>
                {otherVariants.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400 w-full">{error}</p>}
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">Save</button>
          <button
            onClick={() => { setCreating(false); setName(''); setDate(today()); setSourceVariantId(CURRENT_SCHEDULE); setError(null) }}
            className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper px-1 py-1.5"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ Set a new baseline</button>
      )}
    </div>
  )
}
