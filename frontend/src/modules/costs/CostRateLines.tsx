import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { CostRateLine } from './types'

interface NewLineForm {
  description: string
  qty: string
  unit: string
  rate: string
}

const EMPTY_FORM: NewLineForm = { description: '', qty: '', unit: '', rate: '' }

interface CostRateLinesProps {
  costElementId: string
  // Resources module: rate lines under a "schedule"-sourced element are normally
  // auto-managed from resource assignments in Scheduling. Adding/deleting one
  // directly here unlinks the parent element permanently — confirm first, same
  // as CostForm.tsx does for editing budget directly.
  isScheduleLinked?: boolean
}

function formatCurrency(value: string) {
  return `£${Number(value).toLocaleString()}`
}

const UNLINK_WARNING =
  'This element\'s rate lines are currently managed automatically from Scheduling resource assignments. ' +
  'Editing them directly will unlink it permanently — future resource assignment changes won\'t update it anymore. Continue?'

// Qty x Unit x Rate build-up per cost element (e.g. "CFA piles to 8.5m x267 @
// £576/nr"), matching the prototype's Budget & Versions tab Rate Card.
export function CostRateLines({ costElementId, isScheduleLinked = false }: CostRateLinesProps) {
  const [lines, setLines] = useState<CostRateLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<NewLineForm>(EMPTY_FORM)

  const load = () => {
    setLoading(true)
    api.get<CostRateLine[]>('/api/v1/cost-rate-lines/', { params: { cost_element_id: costElementId } })
      .then(r => setLines(r.data))
      .catch(() => setError('Failed to load rate card'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [costElementId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim() || form.qty === '' || form.rate === '') return
    if (isScheduleLinked && !(await confirmWithDontAsk('cost.rateline-add-unlink', UNLINK_WARNING))) return
    try {
      await api.post('/api/v1/cost-rate-lines/', {
        cost_element_id: costElementId,
        description: form.description.trim(),
        qty: form.qty,
        unit: form.unit.trim() || null,
        rate: form.rate,
      })
      setForm(EMPTY_FORM)
      setAdding(false)
      load()
    } catch {
      setError('Failed to add rate line')
    }
  }

  const deleteLine = async (line: CostRateLine) => {
    const message = isScheduleLinked ? `${UNLINK_WARNING}\n\n(This will also delete "${line.description}".)` : `Delete "${line.description}"?`
    if (!(await confirmWithDontAsk(isScheduleLinked ? 'cost.rateline-delete-unlink' : 'cost.rateline-delete', message))) return
    await api.delete(`/api/v1/cost-rate-lines/${line.id}`)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 px-4 py-3">Loading rate card…</p>

  const elementTotal = lines.reduce((sum, l) => sum + Number(l.total), 0)

  return (
    <div className="px-4 py-3 bg-gray-50 border-t border-gray-100">
      <div className="text-xs font-semibold text-gray-600 mb-2">Rate card</div>
      {isScheduleLinked && (
        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md px-2 py-1.5 mb-2">
          🔗 Managed automatically from Scheduling resource assignments — editing a line directly unlinks it.
        </p>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {lines.length === 0 && !adding && (
        <p className="text-xs text-gray-400 mb-2">No rate lines yet.</p>
      )}

      {lines.length > 0 && (
        <table className="w-full text-xs mb-2">
          <thead>
            <tr className="text-left text-gray-400">
              <th className="pb-1">Description</th>
              <th className="pb-1 text-right">Qty</th>
              <th className="pb-1">Unit</th>
              <th className="pb-1 text-right">Rate</th>
              <th className="pb-1 text-right">Total</th>
              <th className="pb-1"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map(line => (
              <tr key={line.id} className="border-t border-gray-100 bg-white">
                <td className="py-1 px-1">{line.description}</td>
                <td className="py-1 px-1 text-right">{line.qty}</td>
                <td className="py-1 px-1">{line.unit ?? '—'}</td>
                <td className="py-1 px-1 text-right">{formatCurrency(line.rate)}</td>
                <td className="py-1 px-1 text-right font-medium">{formatCurrency(line.total)}</td>
                <td className="py-1 px-1 text-right">
                  <button onClick={() => deleteLine(line)} className="text-gray-400 hover:text-red-600">remove</button>
                </td>
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold">
              <td className="py-1 px-1" colSpan={4}>Element total</td>
              <td className="py-1 px-1 text-right">{formatCurrency(elementTotal.toString())}</td>
              <td></td>
            </tr>
          </tbody>
        </table>
      )}

      {adding ? (
        <form onSubmit={handleAdd} className="bg-white border border-gray-200 rounded-md p-3 space-y-2">
          <input
            autoFocus
            type="text"
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-xs"
            placeholder="Line description"
          />
          <div className="flex gap-2">
            <input
              type="number" step="0.01"
              value={form.qty}
              onChange={e => setForm(prev => ({ ...prev, qty: e.target.value }))}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              placeholder="Qty"
            />
            <input
              type="text"
              value={form.unit}
              onChange={e => setForm(prev => ({ ...prev, unit: e.target.value }))}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              placeholder="Unit (e.g. Nr, m2)"
            />
            <input
              type="number" step="0.01"
              value={form.rate}
              onChange={e => setForm(prev => ({ ...prev, rate: e.target.value }))}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-xs"
              placeholder="Rate (£)"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900">
              Add line
            </button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY_FORM) }} className="text-xs text-gray-500 px-3 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
          + Add rate line
        </button>
      )}
    </div>
  )
}
