import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import { ACTION_STATUSES, type RiskMitigationAction } from './types'

const STATUS_STYLES: Record<string, string> = {
  not_started: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-blue-100 text-blue-700',
  complete: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
}

interface NewActionForm {
  description: string
  owner: string
  due_date: string
}

const EMPTY_FORM: NewActionForm = { description: '', owner: '', due_date: '' }

interface MitigationActionsProps {
  riskId: string
}

// Repeatable list of tracked mitigation actions for a risk (own code, owner, due
// date, status, % complete) — matches the prototype's Mitigation & Response tab.
export function MitigationActions({ riskId }: MitigationActionsProps) {
  const [actions, setActions] = useState<RiskMitigationAction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<NewActionForm>(EMPTY_FORM)

  const load = () => {
    setLoading(true)
    api.get<RiskMitigationAction[]>('/api/v1/risk-mitigation-actions/', { params: { risk_id: riskId } })
      .then(r => setActions(r.data))
      .catch(() => setError('Failed to load mitigation actions'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [riskId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim()) return
    try {
      await api.post('/api/v1/risk-mitigation-actions/', {
        risk_id: riskId,
        description: form.description.trim(),
        owner: form.owner.trim() || null,
        due_date: form.due_date || null,
      })
      setForm(EMPTY_FORM)
      setAdding(false)
      load()
    } catch {
      setError('Failed to add mitigation action')
    }
  }

  const updateAction = async (action: RiskMitigationAction, patch: Partial<RiskMitigationAction>) => {
    await api.patch(`/api/v1/risk-mitigation-actions/${action.id}`, patch)
    load()
  }

  const deleteAction = async (action: RiskMitigationAction) => {
    if (!(await confirmWithDontAsk('risk.mitigation-action-delete', `Delete "${action.code} · ${action.description}"?`))) return
    await api.delete(`/api/v1/risk-mitigation-actions/${action.id}`)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 px-4 py-3">Loading mitigation actions…</p>

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
      <div className="text-xs font-semibold text-gray-600 mb-2">Mitigation actions</div>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {actions.length === 0 && !adding && (
        <p className="text-xs text-gray-400 mb-2">No mitigation actions yet.</p>
      )}

      <div className="space-y-2 mb-2">
        {actions.map(action => (
          <div key={action.id} className="bg-white border border-gray-200 rounded-md px-3 py-2 text-xs">
            <div className="flex items-center justify-between mb-1">
              <span className="font-medium text-gray-900">{action.code} · {action.description}</span>
              <div className="flex items-center gap-2">
                <select
                  value={action.status}
                  onChange={e => updateAction(action, { status: e.target.value })}
                  className={`text-xs rounded-full px-2 py-0.5 font-medium border-0 ${STATUS_STYLES[action.status] ?? 'bg-gray-100 text-gray-600'}`}
                >
                  {ACTION_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
                <button onClick={() => deleteAction(action)} className="text-gray-400 hover:text-red-600">remove</button>
              </div>
            </div>
            <div className="text-gray-500 mb-1">
              {action.owner ?? 'Unassigned'}{action.due_date ? ` · Due: ${action.due_date}` : ''}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 bg-gray-100 rounded-full">
                <div className="h-1 bg-teal-500 rounded-full" style={{ width: `${action.pct_complete}%` }} />
              </div>
              <input
                type="number" min={0} max={100}
                value={action.pct_complete}
                onChange={e => updateAction(action, { pct_complete: Number(e.target.value) })}
                className="w-14 border border-gray-200 rounded px-1 py-0.5 text-xs"
              />
              <span className="text-gray-400">%</span>
            </div>
          </div>
        ))}
      </div>

      {adding ? (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
          <input
            autoFocus
            type="text"
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs"
            placeholder="Action description"
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={form.owner}
              onChange={e => setForm(prev => ({ ...prev, owner: e.target.value }))}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              placeholder="Owner"
            />
            <input
              type="date"
              value={form.due_date}
              onChange={e => setForm(prev => ({ ...prev, due_date: e.target.value }))}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-xs"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900">
              Add action
            </button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY_FORM) }} className="text-xs text-gray-500 px-3 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          + Add mitigation action
        </button>
      )}
    </div>
  )
}
