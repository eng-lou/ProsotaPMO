import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { LINK_TYPES, type RecordLink, type RecordType } from '@/lib/types'

export interface LinkCandidate {
  id: string
  type: RecordType
  label: string
}

interface RecordLinksProps {
  recordType: RecordType
  recordId: string
  candidates: LinkCandidate[]
}

// Shows and manages entries in the shared `record_links` graph (see ARCHITECTURE.md
// Section 4.3), so any record (risk, cost element, ...) can be linked to any other,
// typed as causes/impacts/mitigates/relates_to. `candidates` is the pool of other
// records this record could link to — passed in by the caller since only modules
// with a frontend list built so far can be picked from.
export function RecordLinks({ recordType, recordId, candidates }: RecordLinksProps) {
  const [links, setLinks] = useState<RecordLink[]>([])
  const [loading, setLoading] = useState(true)
  const [targetId, setTargetId] = useState('')
  const [linkType, setLinkType] = useState<string>(LINK_TYPES[0])
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    api.get<RecordLink[]>('/api/v1/record-links/', {
      params: { record_type: recordType, record_id: recordId },
    })
      .then(r => setLinks(r.data))
      .catch(() => setError('Failed to load links'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [recordType, recordId])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const target = candidates.find(c => c.id === targetId)
    if (!target) return
    try {
      await api.post('/api/v1/record-links/', {
        source_type: recordType,
        source_id: recordId,
        target_type: target.type,
        target_id: target.id,
        link_type: linkType,
      })
      setTargetId('')
      load()
    } catch {
      setError('Failed to create link')
    }
  }

  const handleDelete = async (linkId: string) => {
    await api.delete(`/api/v1/record-links/${linkId}`)
    load()
  }

  const labelFor = (type: string, id: string) =>
    candidates.find(c => c.type === type && c.id === id)?.label ?? `${type} (${id.slice(0, 8)})`

  if (loading) return <p className="text-xs text-gray-400 dark:text-prosota-muted px-4 py-3">Loading links…</p>

  return (
    <div className="px-4 py-3 bg-gray-50 dark:bg-prosota-panel2 border-t border-gray-100 dark:border-prosota-line">
      {error && <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>}

      {links.length === 0 ? (
        <p className="text-xs text-gray-400 dark:text-prosota-muted mb-3">No linked records yet.</p>
      ) : (
        <ul className="text-xs text-gray-700 dark:text-prosota-paper space-y-1 mb-3">
          {links.map(link => {
            const isSource = link.source_id === recordId
            const otherType = isSource ? link.target_type : link.source_type
            const otherId = isSource ? link.target_id : link.source_id
            return (
              <li key={link.id} className="flex items-center justify-between">
                <span>
                  {isSource ? 'This' : labelFor(otherType, otherId)}{' '}
                  <span className="font-medium">{link.link_type}</span>{' '}
                  {isSource ? labelFor(otherType, otherId) : 'this'}
                </span>
                <button onClick={() => handleDelete(link.id)} className="text-gray-400 dark:text-prosota-muted hover:text-red-600 dark:hover:text-red-400">
                  remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <form onSubmit={handleAdd} className="flex items-center gap-2">
        <select
          value={linkType}
          onChange={e => setLinkType(e.target.value)}
          className="border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
        >
          {LINK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select
          value={targetId}
          onChange={e => setTargetId(e.target.value)}
          className="flex-1 border border-gray-300 dark:border-prosota-line dark:bg-prosota-panel dark:text-prosota-paper rounded-md px-2 py-1.5 text-xs"
        >
          <option value="">Link to another record…</option>
          {candidates.map(c => (
            <option key={`${c.type}:${c.id}`} value={c.id}>{c.type}: {c.label}</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!targetId}
          className="text-xs bg-gray-800 text-white px-3 py-1.5 rounded-md hover:bg-gray-900 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80 disabled:opacity-40"
        >
          Add link
        </button>
      </form>
    </div>
  )
}
