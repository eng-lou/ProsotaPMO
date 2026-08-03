import axios from 'axios'
import { useState } from 'react'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { ActivityPicker } from './ActivityPicker'
import type { Activity, ScheduleSubproject } from './types'

function apiErrorDetail(err: unknown): string | undefined {
  return axios.isAxiosError(err) ? (err.response?.data as { detail?: string } | undefined)?.detail : undefined
}

interface Props {
  activities: Activity[]
  subprojects: ScheduleSubproject[]
  onCreate: (name: string, rootWbsId: string) => Promise<void>
  onUpdate: (id: string, name: string, rootWbsId: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onClose: () => void
}

export function SubProjectsWidget({ activities, subprojects, onCreate, onUpdate, onDelete, onClose }: Props) {
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [rootWbsId, setRootWbsId] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Only a nested WBS summary can be tagged as a sub-project's root — not the
  // top-level project root, not the reserved Archive container (backend
  // enforces this too; pre-filtering here just keeps a bad pick from ever
  // reaching that 422 in the first place) — docs/SUBPROJECT_FLOAT_PLAN.md §E.
  const eligibleRoots = activities.filter(
    a => a.activity_type === 'wbs_summary' && a.parent_id !== null && !a.is_archive_container
  )
  const activitiesById = new Map(activities.map(a => [a.id, a]))

  const resetForm = () => {
    setCreating(false)
    setEditingId(null)
    setName('')
    setRootWbsId('')
    setError(null)
  }

  const startCreate = () => {
    resetForm()
    setCreating(true)
  }

  const startEdit = (sp: ScheduleSubproject) => {
    resetForm()
    setEditingId(sp.id)
    setName(sp.name)
    setRootWbsId(sp.root_wbs_id)
  }

  const handleSave = async () => {
    if (!name.trim() || !rootWbsId) return
    setError(null)
    try {
      if (editingId) {
        await onUpdate(editingId, name, rootWbsId)
      } else {
        await onCreate(name, rootWbsId)
      }
    } catch (err) {
      setError(apiErrorDetail(err) ?? 'Could not save that sub-project — check your connection and try again.')
      return
    }
    resetForm()
  }

  const handleDelete = async (sp: ScheduleSubproject) => {
    if (!(await confirmWithDontAsk(
      'scheduling.subproject-delete',
      `Untag "${sp.name}"? Its root's SP-#### code stays as-is (like Archive) — this only stops the sub-critical float calculation.`,
    ))) return
    await onDelete(sp.id)
    if (editingId === sp.id) resetForm()
  }

  const formOpen = creating || editingId !== null

  return (
    <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🏗️</span>
        <div className="font-bold text-sm dark:text-prosota-paper">Sub-Projects</div>
        <div className="text-xs text-gray-400 dark:text-prosota-muted">Give a WBS branch its own scoped critical path, independent of the master schedule</div>
        <button onClick={onClose} className="ml-auto text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-2">
        <thead>
          <tr className="bg-gray-50 dark:bg-prosota-panel2 text-left text-gray-500 dark:text-prosota-muted">
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Name</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line">Root WBS</th>
            <th className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line"></th>
          </tr>
        </thead>
        <tbody>
          {subprojects.map(sp => {
            const root = activitiesById.get(sp.root_wbs_id)
            return (
              <tr key={sp.id}>
                <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line font-medium dark:text-prosota-paper">{sp.name}</td>
                <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-gray-500 dark:text-prosota-muted">
                  {root ? <><span className="font-mono text-gray-400 dark:text-prosota-muted mr-1">{root.code}:</span>{root.task_name}</> : '—'}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 dark:border-prosota-line text-right whitespace-nowrap">
                  <button onClick={() => startEdit(sp)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan mr-2">Edit</button>
                  <button onClick={() => handleDelete(sp)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">Untag</button>
                </td>
              </tr>
            )
          })}
          {subprojects.length === 0 && (
            <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 dark:text-prosota-muted border border-gray-200 dark:border-prosota-line">None yet</td></tr>
          )}
        </tbody>
      </table>

      {formOpen ? (
        <div className={`border rounded p-3 space-y-2 ${editingId ? 'border-blue-200 dark:border-prosota-azure/40 bg-blue-50/30 dark:bg-prosota-azure/10' : 'border-gray-200 dark:border-prosota-line'}`}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Sub-project name (e.g. Enabling Works)"
            className="w-full text-xs border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-2 py-1"
          />
          <ActivityPicker
            activities={eligibleRoots}
            value={rootWbsId}
            onChange={setRootWbsId}
            placeholder="Select the root WBS summary node…"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="text-xs text-gray-400 dark:text-prosota-muted hover:text-gray-600 dark:hover:text-prosota-paper">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !rootWbsId}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? 'Save Changes' : 'Tag Sub-Project'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ Tag Sub-Project</button>
      )}
    </div>
  )
}
