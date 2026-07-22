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
// there's no Assign/Unassign (no bl_* columns on risks/cost elements/ICD
// items for a baseline to drive the way Activity.bl_start/bl_finish work),
// no cross-variant "baseline from" source (Risk/Cost/ICD have no sibling-
// variant concept the way Scheduling does), and no Promote to Schedule
// equivalent — just capture, list, and delete, matching exactly what
// risk-baselines/cost-baselines/icd-baselines' own APIs actually expose
// (list/create/delete/snapshot, confirmed identical across all three
// backend/app/api/*_baselines.py routers, no assign endpoint on any of
// them). A captured baseline still shows up in the Dashboard's Baseline
// Comparison the moment it's linked into a BaselineSet — this widget just
// gives each module its own place to build that history, the same way
// Scheduling's tab already does for schedule baselines.
export function BaselineManagerWidget({
  apiBasePath, periodId, itemNounPlural, moduleLabel, dismissKeyPrefix, onClose,
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
}) {
  const [baselines, setBaselines] = useState<BaselineRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [date, setDate] = useState(today)
  const [error, setError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
      await api.delete(`${apiBasePath}/${b.id}`)
      await load()
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🎯</span>
        <div className="font-bold text-sm">Baseline</div>
        <div className="text-xs text-gray-400">Capture a named, dated snapshot of {moduleLabel}'s current state — also available to the Dashboard's Baseline Comparison</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-3">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Date</th>
            <th className="px-2 py-1.5 border border-gray-200 text-right">{itemNounPlural}</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {baselines.map(b => (
            <tr key={b.id}>
              <td className="px-2 py-1.5 border border-gray-200 font-medium">{b.name}</td>
              <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{b.baseline_date}</td>
              <td className="px-2 py-1.5 border border-gray-200 text-right text-gray-500">{b.item_count}</td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap text-gray-400" title="Baseline Sets are managed from the Dashboard's Baseline Comparison, not here">
                {b.baseline_set_id ? '📦 In a Baseline Set' : '—'}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-right">
                <button onClick={() => handleDelete(b)} disabled={deletingId === b.id} className="text-gray-400 hover:text-red-600 disabled:opacity-40">Delete</button>
              </td>
            </tr>
          ))}
          {baselines.length === 0 && !loading && (
            <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400 border border-gray-200">No baselines saved yet for this period</td></tr>
          )}
        </tbody>
      </table>

      {creating ? (
        <div className="border border-gray-200 rounded p-3 flex items-end gap-2 flex-wrap">
          <label className="text-xs text-gray-600">
            Name
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Contract Baseline"
              autoFocus
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5 w-48"
            />
          </label>
          <label className="text-xs text-gray-600">
            Date
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="block border border-gray-300 rounded px-2 py-1 text-xs mt-0.5"
            />
          </label>
          {error && <p className="text-xs text-red-600 w-full">{error}</p>}
          <button onClick={handleCreate} className="text-xs px-2 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700">Save</button>
          <button
            onClick={() => { setCreating(false); setName(''); setDate(today()); setError(null) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-1 py-1.5"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Set a new baseline</button>
      )}
    </div>
  )
}
