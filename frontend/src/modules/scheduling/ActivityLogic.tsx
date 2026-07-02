import { useState } from 'react'
import { api } from '@/lib/api'
import { RELATIONSHIP_TYPES, type Activity, type ActivityRelationship, type RelationshipType } from './types'

interface Props {
  activity: Activity
  activities: Activity[]
  relationships: ActivityRelationship[]
  onChange: () => Promise<void>
}

function LinkTable({
  title,
  rows,
  otherIdField,
  activitiesById,
  onDelete,
}: {
  title: string
  rows: ActivityRelationship[]
  otherIdField: 'predecessor_id' | 'successor_id'
  activitiesById: Map<string, Activity>
  onDelete: (id: string) => void
}) {
  return (
    <div>
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">{title}</div>
      {rows.length === 0 ? (
        <div className="text-xs text-gray-400 mb-2">None</div>
      ) : (
        <table className="w-full text-xs border-collapse mb-2">
          <tbody>
            {rows.map(r => {
              const other = activitiesById.get(r[otherIdField])
              return (
                <tr key={r.id} className="border-b border-gray-100 last:border-0">
                  <td className="py-1 pr-2 font-mono text-gray-500 whitespace-nowrap">{other?.code ?? '—'}</td>
                  <td className="py-1 pr-2 text-gray-700 truncate max-w-[10rem]">{other?.task_name ?? 'Unknown'}</td>
                  <td className="py-1 pr-2">
                    <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">{r.relationship_type}</span>
                  </td>
                  <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">
                    {r.lag_hours === 0 ? '—' : r.lag_hours > 0 ? `+${r.lag_hours}h` : `${r.lag_hours}h`}
                  </td>
                  <td className="py-1 text-right">
                    <button onClick={() => onDelete(r.id)} className="text-gray-400 hover:text-red-600">✕</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function ActivityLogic({ activity, activities, relationships, onChange }: Props) {
  const [addingPred, setAddingPred] = useState(false)
  const [addingSucc, setAddingSucc] = useState(false)
  const [candidateId, setCandidateId] = useState('')
  const [relType, setRelType] = useState<RelationshipType>('FS')
  const [lagHours, setLagHours] = useState('0')

  const activitiesById = new Map(activities.map(a => [a.id, a]))
  const predecessors = relationships.filter(r => r.successor_id === activity.id)
  const successors = relationships.filter(r => r.predecessor_id === activity.id)
  const candidates = activities.filter(a => a.id !== activity.id)

  const resetAddForm = () => {
    setAddingPred(false)
    setAddingSucc(false)
    setCandidateId('')
    setRelType('FS')
    setLagHours('0')
  }

  const handleAdd = async (mode: 'predecessor' | 'successor') => {
    if (!candidateId) return
    const payload = mode === 'predecessor'
      ? { predecessor_id: candidateId, successor_id: activity.id, relationship_type: relType, lag_hours: Number(lagHours) || 0 }
      : { predecessor_id: activity.id, successor_id: candidateId, relationship_type: relType, lag_hours: Number(lagHours) || 0 }
    await api.post('/api/v1/activity-relationships/', payload)
    resetAddForm()
    await onChange()
  }

  const handleDelete = async (id: string) => {
    await api.delete(`/api/v1/activity-relationships/${id}`)
    await onChange()
  }

  const AddForm = ({ mode, onCancel }: { mode: 'predecessor' | 'successor'; onCancel: () => void }) => (
    <div className="flex items-center gap-2 mb-2 flex-wrap">
      <select value={candidateId} onChange={e => setCandidateId(e.target.value)} className="text-xs border border-gray-300 rounded px-2 py-1">
        <option value="">Select activity…</option>
        {candidates.map(a => <option key={a.id} value={a.id}>{a.code}: {a.task_name}</option>)}
      </select>
      <select value={relType} onChange={e => setRelType(e.target.value as RelationshipType)} className="text-xs border border-gray-300 rounded px-2 py-1">
        {RELATIONSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <input
        type="number"
        value={lagHours}
        onChange={e => setLagHours(e.target.value)}
        title="Lag (hours) — positive = lag, negative = lead"
        className="text-xs border border-gray-300 rounded px-2 py-1 w-16"
      />
      <button onClick={() => handleAdd(mode)} className="text-xs px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700">Add</button>
      <button onClick={onCancel} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
    </div>
  )

  return (
    <div className="grid grid-cols-2 gap-6 px-4 py-4 bg-gray-50 border-t border-gray-100 text-xs">
      <div>
        <LinkTable
          title="Predecessors"
          rows={predecessors}
          otherIdField="predecessor_id"
          activitiesById={activitiesById}
          onDelete={handleDelete}
        />
        {addingPred ? (
          <AddForm mode="predecessor" onCancel={resetAddForm} />
        ) : (
          <button onClick={() => setAddingPred(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            + Add Predecessor
          </button>
        )}
      </div>
      <div>
        <LinkTable
          title="Successors"
          rows={successors}
          otherIdField="successor_id"
          activitiesById={activitiesById}
          onDelete={handleDelete}
        />
        {addingSucc ? (
          <AddForm mode="successor" onCancel={resetAddForm} />
        ) : (
          <button onClick={() => setAddingSucc(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            + Add Successor
          </button>
        )}
      </div>
    </div>
  )
}
