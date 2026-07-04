import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { CODE_HISTORY_REASON_LABELS, type ActivityCodeHistory } from './types'

interface Props {
  activityId: string
  // Re-fetches whenever the activity's own code changes — covers both a
  // manual rename and an automatic promote/demote, without depending on an
  // unrelated refresh counter from elsewhere in the panel.
  code: string
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Read-only audit trail of every code this activity has ever had (2026-07-04,
// per Maro: "so we know what it was before and now") — auto-logged by the
// backend (promote/demote via indent/outdent, or a manual rename), never
// user-prompted like ReassessmentLog, so there's nothing to add/edit/delete
// here, just a record.
export function CodeHistory({ activityId, code }: Props) {
  const [entries, setEntries] = useState<ActivityCodeHistory[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get<ActivityCodeHistory[]>(`/api/v1/activities/${activityId}/code-history`)
      .then(res => setEntries(res.data))
      .finally(() => setLoading(false))
  }, [activityId, code])

  if (loading) return null
  if (entries.length === 0) return null

  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Code History</div>
      <ul className="space-y-1">
        {entries.map(e => (
          <li key={e.id} className="text-xs text-gray-600">
            <span className="text-gray-400">{e.old_code ?? '—'}</span>
            <span className="mx-1 text-gray-300">→</span>
            <span className="font-medium text-gray-800">{e.new_code}</span>
            <span className="text-gray-400"> · {CODE_HISTORY_REASON_LABELS[e.reason]} · {formatDateTime(e.created_at)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
