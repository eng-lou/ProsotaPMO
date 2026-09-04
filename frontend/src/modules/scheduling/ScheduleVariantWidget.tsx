import axios from 'axios'
import { useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { useElapsedSeconds } from '@/lib/useElapsedSeconds'
import type { ScheduleVariant } from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

interface Props {
  variants: ScheduleVariant[]
  activeVariantId: string | undefined
  onSelect: (v: ScheduleVariant) => Promise<void>
  onCreate: (name: string, variantType: string | null, duplicateFromVariantId?: string) => Promise<ScheduleVariant>
  onRename: (id: string, name: string, variantType: string | null) => Promise<ScheduleVariant>
  onDelete: (id: string) => Promise<void>
  onPromote: (id: string) => Promise<{ variant: ScheduleVariant; unmatched_codes: string[] }>
  onClose: () => void
}

// Mirrors SubProjectsWidget's own list/create/rename/delete shape
// (docs/SCHEDULE_VARIANTS_PLAN.md §E) — a project can have more than one
// schedule (Working Schedule, Recovery Schedule, ...), exactly one flagged
// master at a time. Switching here changes which schedule the whole
// Scheduling module (grid/Gantt/Baseline/Reschedule/Quality) is currently
// looking at.
export function ScheduleVariantWidget({
  variants, activeVariantId, onSelect, onCreate, onRename, onDelete, onPromote, onClose,
}: Props) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [variantType, setVariantType] = useState('')
  const [duplicateCurrent, setDuplicateCurrent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // Separate from busyId (2026-09-04, per Maro: "the promote to master
  // schedule process takes quite a long time") — busyId also covers the
  // instant Select/Delete, which never need a timer; this tracks only a
  // genuine in-flight promote so the elapsed counter never shows for those.
  const [promotingId, setPromotingId] = useState<string | null>(null)
  const promoteElapsed = useElapsedSeconds(promotingId !== null)

  const active = variants.find(v => v.id === activeVariantId) ?? null

  const resetForm = () => {
    setCreating(false)
    setEditingId(null)
    setName('')
    setVariantType('')
    setDuplicateCurrent(false)
    setError(null)
  }

  const startCreate = () => {
    resetForm()
    setCreating(true)
  }

  const startEdit = (v: ScheduleVariant) => {
    resetForm()
    setEditingId(v.id)
    setName(v.name)
    setVariantType(v.variant_type ?? '')
  }

  const handleSave = async () => {
    if (!name.trim()) return
    setError(null)
    try {
      if (editingId) {
        await onRename(editingId, name.trim(), variantType.trim() || null)
      } else {
        await onCreate(name.trim(), variantType.trim() || null, duplicateCurrent ? activeVariantId : undefined)
      }
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not save that schedule — check your connection and try again.')
      return
    }
    resetForm()
  }

  const handleSelect = async (v: ScheduleVariant) => {
    if (v.id === activeVariantId) return
    setBusyId(v.id)
    try {
      await onSelect(v)
    } finally {
      setBusyId(null)
    }
  }

  const handlePromote = async (v: ScheduleVariant) => {
    if (!(await confirmWithDontAsk(
      'scheduling.variant-promote',
      `Promote "${v.name}" to the master schedule? Risk/Cost/ICD linked to activities in the current master (${
        variants.find(x => x.is_master)?.name ?? 'the master'
      }) will be re-linked onto "${v.name}"'s matching activity codes — anything with no matching code will be unlinked and reported.`
    ))) return
    setBusyId(v.id)
    setPromotingId(v.id)
    try {
      await onPromote(v.id)
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not promote that schedule — check your connection and try again.')
    } finally {
      setBusyId(null)
      setPromotingId(null)
    }
  }

  const handleDelete = async (v: ScheduleVariant) => {
    if (!(await confirmWithDontAsk(
      'scheduling.variant-delete',
      `Delete the schedule "${v.name}"? This removes its activities, relationships, resource assignments, baselines, and saved quality runs — Risk/Cost/ICD data is untouched. This cannot be undone.`
    ))) return
    setBusyId(v.id)
    try {
      await onDelete(v.id)
      if (editingId === v.id) resetForm()
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not delete that schedule — check your connection and try again.')
    } finally {
      setBusyId(null)
    }
  }

  const formOpen = creating || editingId !== null

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🗂️</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Schedules</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">More than one schedule per project — Working Schedule, Recovery Schedule, scenarios, ...</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-2">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Type</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {variants.map(v => (
            <tr key={v.id} className={v.id === activeVariantId ? 'bg-blue-50/50 dark:bg-prosota-azure/10' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium">
                {v.name}
                {v.is_master && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 dark:text-prosota-azure bg-blue-50 rounded px-1 py-0.5">Master</span>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted">{v.variant_type ?? '—'}</td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line whitespace-nowrap">
                {v.id === activeVariantId ? (
                  <span className="text-blue-600 dark:text-prosota-azure font-medium">✓ Viewing</span>
                ) : (
                  <button
                    onClick={() => handleSelect(v)}
                    disabled={busyId === v.id}
                    className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan disabled:opacity-40"
                  >
                    Switch to
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right whitespace-nowrap">
                <button onClick={() => startEdit(v)} className="text-gray-500 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper mr-2">Rename</button>
                {!v.is_master && (
                  <button
                    onClick={() => handlePromote(v)}
                    disabled={busyId === v.id}
                    title="Make this the master schedule — Risk/Cost/ICD links follow, matched by activity code"
                    className="text-gray-500 dark:text-prosota-muted hover:text-gray-700 dark:hover:text-prosota-paper mr-2 disabled:opacity-40"
                  >
                    {promotingId === v.id ? `Promoting… (${promoteElapsed}s)` : 'Promote'}
                  </button>
                )}
                {promotingId === v.id && promoteElapsed >= 15 && (
                  <span className="block text-[10px] text-gray-400 dark:text-prosota-muted mt-0.5">
                    Larger schedules can take a minute or two, still working
                  </span>
                )}
                {v.is_master ? (
                  <span className="text-gray-300 dark:text-prosota-line" title="The master schedule can't be deleted directly — create or duplicate another schedule and promote it to master first">
                    Delete
                  </span>
                ) : (
                  <button
                    onClick={() => handleDelete(v)}
                    disabled={busyId === v.id}
                    className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40"
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {formOpen ? (
        <div className={`border rounded p-3 space-y-2 ${editingId ? 'border-blue-200 dark:border-prosota-azure/30 bg-blue-50/30 dark:bg-prosota-azure/10' : 'border-gray-200 dark:border-prosota-line'}`}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Schedule name (e.g. Recovery Schedule)"
            autoFocus
            className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
          />
          <input
            value={variantType}
            onChange={e => setVariantType(e.target.value)}
            placeholder="Type (optional, e.g. Mitigation, Contractor, Scenario)"
            className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
          />
          {!editingId && active && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted">
              <input type="checkbox" checked={duplicateCurrent} onChange={e => setDuplicateCurrent(e.target.checked)} />
              Duplicate {active.name}'s current schedule (activities, relationships, resources, baselines, sub-projects) — leave unchecked to start blank
            </label>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? 'Save Changes' : 'Create Schedule'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ New Schedule</button>
      )}
    </div>
  )
}
