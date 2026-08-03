import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'
import type { CostCommitment } from './types'

interface NewCommitmentForm {
  po_reference: string
  description: string
  amount: string
}

const EMPTY_FORM: NewCommitmentForm = { po_reference: '', description: '', amount: '' }

interface CostCommitmentsProps {
  costElementId: string
}

function formatCurrency(value: string) {
  return `£${Number(value).toLocaleString()}`
}

// Open purchase-order-level commitments against a cost element, matching the
// prototype's Actuals & Commitments tab — feeds "Total Commitments".
export function CostCommitments({ costElementId }: CostCommitmentsProps) {
  const [commitments, setCommitments] = useState<CostCommitment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<NewCommitmentForm>(EMPTY_FORM)

  const load = () => {
    setLoading(true)
    api.get<CostCommitment[]>('/api/v1/cost-commitments/', { params: { cost_element_id: costElementId } })
      .then(r => setCommitments(r.data))
      .catch(() => setError('Failed to load commitments'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [costElementId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.description.trim() || form.amount === '') return
    try {
      await api.post('/api/v1/cost-commitments/', {
        cost_element_id: costElementId,
        po_reference: form.po_reference.trim() || null,
        description: form.description.trim(),
        amount: form.amount,
      })
      setForm(EMPTY_FORM)
      setAdding(false)
      load()
    } catch {
      setError('Failed to add commitment')
    }
  }

  const deleteCommitment = async (commitment: CostCommitment) => {
    if (!(await confirmWithDontAsk('cost.commitment-delete', `Delete "${commitment.description}"?`))) return
    await api.delete(`/api/v1/cost-commitments/${commitment.id}`)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 dark:text-prosota-muted px-4 py-3">Loading commitments…</p>

  const totalCommitments = commitments.reduce((sum, c) => sum + Number(c.amount), 0)

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line">
      <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">Open commitments</div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {commitments.length === 0 && !adding && (
        <p className="text-xs text-gray-400 dark:text-prosota-muted mb-2">No open commitments yet.</p>
      )}

      {commitments.length > 0 && (
        <div className="space-y-1.5 mb-2">
          {commitments.map(c => (
            <div key={c.id} className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md px-3 py-2 text-xs flex items-center justify-between">
              <span>{c.po_reference && <span className="font-mono text-gray-500 dark:text-prosota-muted mr-2">{c.po_reference}</span>}{c.description}</span>
              <span className="flex items-center gap-3">
                <span className="font-medium">{formatCurrency(c.amount)}</span>
                <button onClick={() => deleteCommitment(c)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">remove</button>
              </span>
            </div>
          ))}
          <div className="flex items-center justify-between px-3 py-1 text-xs font-semibold">
            <span>Total commitments</span>
            <span>{formatCurrency(totalCommitments.toString())}</span>
          </div>
        </div>
      )}

      {adding ? (
        <form onSubmit={handleAdd} className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md p-3 space-y-2">
          <div className="flex gap-2">
            <input
              autoFocus
              type="text"
              value={form.po_reference}
              onChange={e => setForm(prev => ({ ...prev, po_reference: e.target.value }))}
              className="w-32 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
              placeholder="PO ref"
            />
            <input
              type="text"
              value={form.description}
              onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
              className="flex-1 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
              placeholder="Description"
            />
            <input
              type="number" step="0.01"
              value={form.amount}
              onChange={e => setForm(prev => ({ ...prev, amount: e.target.value }))}
              className="w-32 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
              placeholder="Amount (£)"
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900">
              Add commitment
            </button>
            <button type="button" onClick={() => { setAdding(false); setForm(EMPTY_FORM) }} className="text-xs text-gray-500 dark:text-prosota-muted px-3 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
          + Add commitment
        </button>
      )}
    </div>
  )
}
