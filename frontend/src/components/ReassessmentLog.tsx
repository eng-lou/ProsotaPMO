import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'

export interface Reassessment {
  id: string
  record_type: string
  record_id: string
  note: string
  reviewed_at: string
}

interface ReassessmentLogProps {
  recordType: string
  recordId: string
  refreshKey: number
  onLogged: () => void
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Shared "what changed and why" log — the third use of this exact pattern
// (Risk, then ICD, now Cost Plan), generalised behind the polymorphic
// /api/v1/reassessments/ endpoint instead of being copied a third time.
// Most entries come from a form's automatic prompt when a trigger field
// changes; the quick-add button covers the case where a review happened but
// nothing actually changed. Editable/deletable — a working log, not a
// strict audit trail.
export function ReassessmentLog({ recordType, recordId, refreshKey, onLogged }: ReassessmentLogProps) {
  const [entries, setEntries] = useState<Reassessment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingNote, setEditingNote] = useState('')

  const load = () => {
    setLoading(true)
    api.get<Reassessment[]>('/api/v1/reassessments/', { params: { record_type: recordType, record_id: recordId } })
      .then(r => setEntries(r.data))
      .catch(() => setError('Failed to load reassessment history'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [recordType, recordId, refreshKey])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!note.trim()) return
    try {
      await api.post('/api/v1/reassessments/', { record_type: recordType, record_id: recordId, note: note.trim() })
      setNote('')
      setAdding(false)
      load()
      onLogged()
    } catch {
      setError('Failed to log reassessment')
    }
  }

  const startEdit = (entry: Reassessment) => {
    setEditingId(entry.id)
    setEditingNote(entry.note)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId || !editingNote.trim()) return
    try {
      await api.patch(`/api/v1/reassessments/${editingId}`, { note: editingNote.trim() })
      setEditingId(null)
      load()
    } catch {
      setError('Failed to update reassessment')
    }
  }

  const handleDelete = async (entry: Reassessment) => {
    if (!(await confirmWithDontAsk('reassessment.delete', 'Delete this reassessment entry? This cannot be undone.'))) return
    await api.delete(`/api/v1/reassessments/${entry.id}`)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 dark:text-prosota-muted px-4 py-3">Loading reassessment history…</p>

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line">
      <div className="text-xs font-semibold text-gray-600 dark:text-prosota-muted mb-2">Reassessment history</div>
      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {entries.length === 0 && !adding && (
        <p className="text-xs text-gray-400 dark:text-prosota-muted mb-2">No reassessments logged yet.</p>
      )}

      <ul className="space-y-1.5 mb-2">
        {entries.map(entry => (
          <li key={entry.id} className="text-xs bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-md px-3 py-2">
            {editingId === entry.id ? (
              <form onSubmit={handleSaveEdit} className="space-y-2">
                <textarea
                  autoFocus
                  value={editingNote}
                  onChange={e => setEditingNote(e.target.value)}
                  className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
                  rows={2}
                />
                <div className="flex gap-2">
                  <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1 rounded-md hover:bg-gray-900 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">
                    Save
                  </button>
                  <button type="button" onClick={() => setEditingId(null)} className="text-xs text-gray-500 dark:text-prosota-muted px-2 py-1">
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-gray-400 dark:text-prosota-muted">{formatDateTime(entry.reviewed_at)}</span>
                  <span className="flex gap-2">
                    <button onClick={() => startEdit(entry)} className="text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan">edit</button>
                    <button onClick={() => handleDelete(entry)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">remove</button>
                  </span>
                </div>
                <div className="text-gray-700 dark:text-prosota-paper">{entry.note}</div>
              </>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <form onSubmit={handleAdd} className="space-y-2">
          <textarea
            autoFocus
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel2 dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
            rows={2}
            placeholder="What was reviewed, and what (if anything) changed?"
          />
          <div className="flex gap-2">
            <button type="submit" className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80">
              Log review
            </button>
            <button type="button" onClick={() => { setAdding(false); setNote('') }} className="text-xs text-gray-500 dark:text-prosota-muted px-3 py-1.5">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 dark:text-prosota-azure hover:text-blue-700 dark:hover:text-prosota-cyan font-medium">
          + Log a review
        </button>
      )}
    </div>
  )
}
