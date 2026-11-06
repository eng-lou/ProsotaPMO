import { useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { ActivityStep } from './types'

interface Props {
  activityId: string
}

// Checklist editing remains simple; reusable operational definitions open in Simulator.
export function ActivityStepsWidget({ activityId }: Props) {
  const navigate=useNavigate()
  const [simulation,setSimulation]=useState<{programme_hours:number;derived_hours:number|null;variance_hours:number|null;status:string;scenario_id:string|null;scenario_name:string|null;calculated_at:string|null}|null>(null)
  const [simulationError,setSimulationError]=useState('')
  const [steps, setSteps] = useState<ActivityStep[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = () => {
    setLoading(true)
    api.get('/api/v1/simulations/activity/'+activityId).then(r=>{setSimulation(r.data);setSimulationError('')}).catch(()=>setSimulationError('Could not read the simulation status. Open Simulator to retry.'))
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
      <button type="button" className="text-xs text-blue-500 mb-2" onClick={()=>{sessionStorage.setItem('prosota-simulator-activity',activityId);if(simulation?.scenario_id)sessionStorage.setItem('prosota-simulator-scenario',simulation.scenario_id);navigate('/4d');window.dispatchEvent(new CustomEvent('prosota-open-simulator',{detail:{activityId}}))}}>Open operational steps in Simulator</button>
      {simulation&&<div className="text-xs border rounded p-2 mb-3 space-y-1"><strong>Operational simulation · {({current:'Calculated',stale:'Requires recalculation',incomplete:'Incomplete',not_configured:'Not configured'} as Record<string,string>)[simulation.status]??simulation.status}</strong><div>Programme: {simulation.programme_hours.toFixed(2)} h · Steps: {simulation.derived_hours==null?'—':simulation.derived_hours.toFixed(2)+' h'}</div><div>Variance: {simulation.variance_hours==null?'—':simulation.variance_hours.toFixed(2)+' h'}</div>{simulation.scenario_name&&<div>{simulation.scenario_name}{simulation.calculated_at?' · '+new Date(simulation.calculated_at).toLocaleString():''}</div>}</div>}{simulationError&&<p className="text-xs text-red-500">{simulationError}</p>}
      <div className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2">Steps</div>
      {steps.length > 0 && (
        <ul className="space-y-1 mb-2">
          {steps.map((step, i) => (
            <li key={step.id} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-prosota-muted group">
              <input type="checkbox" checked={step.is_complete} onChange={() => toggleComplete(step)} />
              {editingId === step.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onBlur={() => commitEdit(step)}
                  onKeyDown={e => { if (e.key === 'Enter') commitEdit(step); if (e.key === 'Escape') setEditingId(null) }}
                  className="flex-1 border border-blue-400 dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1 py-0.5 text-xs"
                />
              ) : (
                <span
                  onDoubleClick={() => startEdit(step)}
                  title="Double-click to rename"
                  className={`flex-1 ${step.is_complete ? 'line-through text-gray-400 dark:text-prosota-muted' : ''}`}
                >
                  {step.name}
                </span>
              )}
              <button onClick={() => move(step, 'up')} disabled={i === 0} className="text-gray-300 dark:text-prosota-line hover:text-gray-600 dark:hover:text-prosota-paper disabled:opacity-30 disabled:hover:text-gray-300">▲</button>
              <button onClick={() => move(step, 'down')} disabled={i === steps.length - 1} className="text-gray-300 dark:text-prosota-line hover:text-gray-600 dark:hover:text-prosota-paper disabled:opacity-30 disabled:hover:text-gray-300">▼</button>
              <button onClick={() => handleDelete(step)} className="text-gray-300 dark:text-prosota-line hover:text-red-600 dark:hover:text-red-400 opacity-0 group-hover:opacity-100">✕</button>
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
          className="flex-1 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded px-1.5 py-0.5 text-xs"
        />
        <button onClick={handleAdd} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">+ Add</button>
      </div>
    </div>
  )
}
