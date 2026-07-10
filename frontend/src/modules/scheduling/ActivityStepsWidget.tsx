import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { ActivityStep } from './types'

interface Props {
  activityId: string
}

// P6's per-activity ordered checklist (docs/SCHEDULING_GAPS_PLAN.md Phase 10)
// — checkbox + name + manual up/down reordering, deliberately minimal (no
// weighted % complete or per-step dates, unlike P6 itself — extend only if
// asked). Self-contained state, same as CodeHistory/ResourceAssignments —
// nothing else in the panel needs to see this list.
export function ActivityStepsWidget({ activityId }: Props) {
  const [steps, setSteps] = useState<ActivityStep[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = () => {
    setLoading(true)
    api.get<ActivityStep[]>('/api/v1/activity-steps/', { params: { activity_id: activityId } })
      .then(res => setSteps(res.data))
      .finally(() => setLoading(false))
  }

  useEffect(load, [activityId])

  const handleAdd = async () => {
    if (!newName.trim()) return
    await api.post('/api/v1/activity-steps/', { activity_id: activityId, name: newName.trim() })
    setNewName('')
    load()
  }

  const toggleComplete = async (step: ActivityStep) => {
    await api.patch(`/api/v1/activity-steps/${step.id}`, { is_complete: !step.is_complete })
    load()
  }

  const startEdit = (step: ActivityStep) => {
    setEditingId(step.id)
    setEditName(step.name)
  }

  const commitEdit = async (step: ActivityStep) => {
    setEditingId(null)
    if (!editName.trim() || editName.trim() === step.name) return
    await api.patch(`/api/v1/activity-steps/${step.id}`, { name: editName.trim() })
    load()
  }

  const move = async (step: ActivityStep, direction: 'up' | 'down') => {
    await api.post(`/api/v1/activity-steps/${step.id}/move`, { direction })
    load()
  }

  const handleDelete = async (step: ActivityStep) => {
    if (!(await confirmWithDontAsk('scheduling.activity-step-delete', `Delete step "${step.name}"? This cannot be undone.`))) return
    await api.delete(`/api/v1/activity-steps/${step.id}`)
    load()
  }

  if (loading) return null

  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Steps</div>
      {steps.length > 0 && (
        <ul className="space-y-1 mb-2">
          {steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-1.5 text-xs text-gray-600 group">
              <input type="checkbox" checked={step.is_complete} onChange={() => toggleComplete(step)} />
              {editingId === step.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => commitEdit(step)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(step); if (e.key === 'Escape') setEditingId(null) }}
                  className="flex-1 border border-blue-400 rounded px-1 py-0.5 text-xs"
                />
              ) : (
                <span
                  onDoubleClick={() => startEdit(step)}
                  title="Double-click to rename"
                  className={`flex-1 ${step.is_complete ? 'line-through text-gray-400' : ''}`}
                >
                  {step.name}
                </span>
              )}
              <button onClick={() => move(step, 'up')} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300">▲</button>
              <button onClick={() => move(step, 'down')} disabled={i === steps.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 disabled:hover:text-gray-300">▼</button>
              <button onClick={() => handleDelete(step)} className="text-gray-300 hover:text-red-600 opacity-0 group-hover:opacity-100">✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-1.5">
        <input
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd() }}
          placeholder="Add step…"
          className="flex-1 border border-gray-300 rounded px-1.5 py-0.5 text-xs"
        />
        <button onClick={handleAdd} className="text-xs text-blue-600 hover:text-blue-700 font-medium">+ Add</button>
      </div>
    </div>
  )
}
