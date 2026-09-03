import axios from 'axios'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

// Risk/Cost/ICD baseline records all share this exact shape server-side
// (RiskBaselineResponse/CostBaselineResponse/IcdBaselineResponse — verified
// byte-for-byte identical in backend/app/schemas/) — one generic widget
// instead of three near-duplicate files, parameterized by which API this
// instance talks to.
interface BaselineRecord {
  id: string
  period_id: string
  name: string
  baseline_date: string
  baseline_set_id: string | null
  item_count: number
  // Only present on Cost Baselines (2026-09-03, per Maro's domain
  // correction: Cost gained the same deliberate Assign step Schedule
  // already had — see cost_baselines' own is_active column). Undefined for
  // Risk/ICD, which still have no bl_* columns for a baseline to drive.
  is_active?: boolean
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// A trimmed sibling of scheduling/BaselineWidget.tsx (2026-07-21, per Maro:
// "in schedule module i have a baseline manager but for the rest of the
// modules i dont" — Risk/Cost/ICD already had full backend baseline
// capture/storage from the Controls Dashboard Phase 1a/1b work, wired into
// the Dashboard's own cross-module Baseline Comparison, but no per-module
// UI of their own; only reachable indirectly via the Dashboard's
// "Capture All Now"). Deliberately simpler than Scheduling's own widget —
// no cross-variant "baseline from" source (Risk/Cost/ICD have no sibling-
// variant concept the way Scheduling does) and no Promote to Schedule
// equivalent. A captured baseline still shows up in the Dashboard's
// Baseline Comparison the moment it's linked into a BaselineSet — this
// widget just gives each module its own place to build that history, the
// same way Scheduling's tab already does for schedule baselines.
//
// Assign/Unassign (2026-09-03, per Maro's domain correction: "the budget
// field in cost plan is a forecast... the baseline of the figures becomes
// the approved budget... we can create multiple baselines and choose to
// assign a particular baseline") is now supported too, but ONLY when
// `supportsAssign` is passed — Risk/ICD still have no bl_* columns on their
// own records for a baseline to drive (only Cost gained bl_budget), so
// they keep the original capture/list/delete-only behaviour unchanged.
export function BaselineManagerWidget({
  apiBasePath, periodId, itemNounPlural, moduleLabel, dismissKeyPrefix, onClose,
  supportsAssign, onAssignedChange,
}: {
  // e.g. '/api/v1/risk-baselines'
  apiBasePath: string
  periodId: string
  // e.g. "risks", "cost elements", "ICD items" — the item_count column's label
  itemNounPlural: string
  // e.g. "Risk Register" — only used in the delete-confirm copy
  moduleLabel: string
  // e.g. "risk" — namespaces this module's own confirmWithDontAsk key so
  // dismissing "don't ask again" here doesn't also silence Cost's or ICD's
  dismissKeyPrefix: string
  onClose: () => void
  // Only Cost passes this — see the module docstring above.
  supportsAssign?: boolean
  // Fires with the assign/unassign endpoint's own response body (the
  // records it just updated, e.g. every cost element in the period with
  // fresh bl_budget/bac/EVM) so the parent screen can refresh its own list
  // without a second round-trip.
  onAssignedChange?: (updated: unknown[]) => void
}) {
  const [baselines, setBaselines] = useState<BaselineRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [assigningId, setAssigningId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const res = await api.get<BaselineRecord[]>(`${apiBasePath}/`, { params: { period_id: periodId } })
    setBaselines(res.data)
    setLoading(false)
  }

  useEffect(() => { load() }, [periodId, apiBasePath])

  const handleCreate = async () => {
    if (!name.trim() || !date) return
    setError(null)
    try {
      await api.post(`${apiBasePath}/`, { period_id: periodId, name, baseline_date: date })
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not save that baseline — check your connection and try again.')
      return
    }
    setCreating(false)
    setName('')
    setDate(today())
    await load()
  }

  const handleDelete = async (b: BaselineRecord) => {
    if (!(await confirmWithDontAsk(
      `${dismissKeyPrefix}.baseline-delete`,
      `Delete the saved baseline "${b.name}"? This cannot be undone. If it's part of a Baseline Set, it drops out of the Dashboard's Baseline Comparison too.`
    ))) return
    setDeletingId(b.id)
    try {
      // Deleting an *active* baseline clears bl_budget server-side (same as
      // an explicit Unassign) — call unassign first, purely to get its
      // response body (the freshly-updated elements) back to the parent via
      // onAssignedChange, since DELETE itself returns no body. The server
      // would clear bl_budget on delete regardless; this just keeps the
      // screen in sync with what the DB already did.
      if (supportsAssign && b.is_active) {
        const { data } = await api.post<unknown[]>(`${apiBasePath}/${b.id}/unassign`)
        onAssignedChange?.(data)
      }
      await api.delete(`${apiBasePath}/${b.id}`)
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  const handleAssign = async (b: BaselineRecord) => {
    if (!(await confirmWithDontAsk(
      `${dismissKeyPrefix}.baseline-assign`,
      `Assign "${b.name}" as the approved budget? This becomes the fixed BAC every EVM figure (CPI/EAC/VAC/etc.) measures against, replacing whichever baseline (if any) is currently assigned.`
    ))) return
    setAssigningId(b.id)
    try {
      const { data } = await api.post<unknown[]>(`${apiBasePath}/${b.id}/assign`)
      onAssignedChange?.(data)
      await load()
    } finally {
      setAssigningId(null)
    }
  }

  const handleUnassign = async (b: BaselineRecord) => {
    if (!(await confirmWithDontAsk(
      `${dismissKeyPrefix}.baseline-unassign`,
      `Unassign "${b.name}"? The approved budget clears back to each element's own live Budget until a baseline is assigned again.`
    ))) return
    setAssigningId(b.id)
    try {
      const { data } = await api.post<unknown[]>(`${apiBasePath}/${b.id}/unassign`)
      onAssignedChange?.(data)
      await load()
    } finally {
      setAssigningId(null)
    }
  }

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Baseline</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Capture a named, dated snapshot of {moduleLabel}'s current state — also available to the Dashboard's Baseline Comparison</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Date</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right">{itemNounPlural}</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            {supportsAssign && <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>}
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(b => (
            <tr key={b.id}>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium dark:text-prosota-paper">
                {b.name}
                {b.is_active && <span className="ml-1.5 text-green-600 dark:text-green-400" title="Currently the approved budget">✓ Assigned</span>}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted">{b.baseline_date}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right text-gray-500 dark:text-prosota-muted">{b.item_count}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap text-gray-400 dark:text-prosota-muted" title="Baseline Sets are managed from the Dashboard's Baseline Comparison, not here">
                {b.baseline_set_id ? '📦 In a Baseline Set' : '—'}
              </td>
              {supportsAssign && (
                <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right whitespace-nowrap">
                  {b.is_active ? (
                    <button onClick={() => handleUnassign(b)} disabled={assigningId === b.id} className="text-gray-400 dark:text-prosota-muted hover:text-orange-600 dark:hover:text-orange-400 disabled:opacity-40">Unassign</button>
                  ) : (
                    <button onClick={() => handleAssign(b)} disabled={assigningId === b.id} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium disabled:opacity-40">Assign</button>
                  )}
                </td>
              )}
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right">
                <button onClick={() => handleDelete(b)} disabled={deletingId === b.id} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40">Delete</button>
              </td>
            </tr>
          ))}
          {baselines.length === 0 && !loading && (
            <tr><td colSpan={supportsAssign ? 6 : 5} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted border border-gray-200 dark:border-prosota-line">No baselines saved yet for this period</td></tr>
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
          {error && <p className="text-xs text-red-600 dark:text-red-400 w-full">{error}</p>}
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">Save</button>
          <button
            onClick={() => { setCreating(false); setName(''); setDate(today()); setError(null) }}
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
