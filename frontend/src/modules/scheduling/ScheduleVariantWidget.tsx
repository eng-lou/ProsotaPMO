import axios from 'axios'
import { useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
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
    try {
      await onPromote(v.id)
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not promote that schedule — check your connection and try again.')
    } finally {
      setBusyId(null)
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
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🗂️</span>
        <div className="font-bold text-sm">Schedules</div>
        <div className="text-xs text-gray-400">More than one schedule per project — Working Schedule, Recovery Schedule, scenarios, ...</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-2">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Type</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {variants.map(v => (
            <tr key={v.id} className={v.id === activeVariantId ? 'bg-blue-50/50' : undefined}>
              <td className="px-2 py-1.5 border border-gray-200 font-medium">
                {v.name}
                {v.is_master && (
                  <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-blue-600 bg-blue-50 rounded px-1 py-0.5">Master</span>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-gray-500">{v.variant_type ?? '—'}</td>
              <td className="px-2 py-1.5 border border-gray-200 whitespace-nowrap">
                {v.id === activeVariantId ? (
                  <span className="text-blue-600 font-medium">✓ Viewing</span>
                ) : (
                  <button
                    onClick={() => handleSelect(v)}
                    disabled={busyId === v.id}
                    className="text-blue-600 hover:text-blue-700 disabled:opacity-40"
                  >
                    Switch to
                  </button>
                )}
              </td>
              <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                <button onClick={() => startEdit(v)} className="text-gray-500 hover:text-gray-700 mr-2">Rename</button>
                {!v.is_master && (
                  <button
                    onClick={() => handlePromote(v)}
                    disabled={busyId === v.id}
                    title="Make this the master schedule — Risk/Cost/ICD links follow, matched by activity code"
                    className="text-gray-500 hover:text-gray-700 mr-2 disabled:opacity-40"
                  >
                    Promote
                  </button>
                )}
                {v.is_master ? (
                  <span className="text-gray-300" title="The master schedule can't be deleted directly — create or duplicate another schedule and promote it to master first">
                    Delete
                  </span>
                ) : (
                  <button
                    onClick={() => handleDelete(v)}
                    disabled={busyId === v.id}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-40"
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
        <div className={`border rounded p-3 space-y-2 ${editingId ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Schedule name (e.g. Recovery Schedule)"
            autoFocus
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          <input
            value={variantType}
            onChange={e => setVariantType(e.target.value)}
            placeholder="Type (optional, e.g. Mitigation, Contractor, Scenario)"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          {!editingId && active && (
            <label className="flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={duplicateCurrent} onChange={e => setDuplicateCurrent(e.target.checked)} />
              Duplicate {active.name}'s current schedule (activities, relationships, resources, baselines, sub-projects) — leave unchecked to start blank
            </label>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? 'Save Changes' : 'Create Schedule'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ New Schedule</button>
      )}
    </div>
  )
}
