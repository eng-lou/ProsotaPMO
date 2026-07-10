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
    <div className="bg-white border border-gray-200 rounded-lg p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg">🏗️</span>
        <div className="font-bold text-sm">Sub-Projects</div>
        <div className="text-xs text-gray-400">Give a WBS branch its own scoped critical path, independent of the master schedule</div>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-sm">✕</button>
      </div>

      <table className="w-full text-xs border-collapse mb-2">
        <thead>
          <tr className="bg-gray-50 text-left text-gray-500">
            <th className="px-2 py-1.5 border border-gray-200">Name</th>
            <th className="px-2 py-1.5 border border-gray-200">Root WBS</th>
            <th className="px-2 py-1.5 border border-gray-200"></th>
          </tr>
        </thead>
        <tbody>
          {subprojects.map(sp => {
            const root = activitiesById.get(sp.root_wbs_id)
            return (
              <tr key={sp.id}>
                <td className="px-2 py-1.5 border border-gray-200 font-medium">{sp.name}</td>
                <td className="px-2 py-1.5 border border-gray-200 text-gray-500">
                  {root ? <><span className="font-mono text-gray-400 mr-1">{root.code}:</span>{root.task_name}</> : '—'}
                </td>
                <td className="px-2 py-1.5 border border-gray-200 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(sp)} className="text-blue-600 hover:text-blue-700 mr-2">Edit</button>
                  <button onClick={() => handleDelete(sp)} className="text-gray-400 hover:text-red-600">Untag</button>
                </td>
              </tr>
            )
          })}
          {subprojects.length === 0 && (
            <tr><td colSpan={3} className="px-2 py-3 text-center text-gray-400 border border-gray-200">None yet</td></tr>
          )}
        </tbody>
      </table>

      {formOpen ? (
        <div className={`border rounded p-3 space-y-2 ${editingId ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Sub-project name (e.g. Enabling Works)"
            className="w-full text-xs border border-gray-300 rounded px-2 py-1"
          />
          <ActivityPicker
            activities={eligibleRoots}
            value={rootWbsId}
            onChange={setRootWbsId}
            placeholder="Select the root WBS summary node…"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={resetForm} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !rootWbsId}
              className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {editingId ? 'Save Changes' : 'Tag Sub-Project'}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={startCreate} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Tag Sub-Project</button>
      )}
    </div>
  )
}
