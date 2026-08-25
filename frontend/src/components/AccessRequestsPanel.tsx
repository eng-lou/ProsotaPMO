import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { confirmWithDontAsk } from '@/lib/confirmWithDontAsk'

interface PendingUser {
  id: string
  email: string
  display_name: string
  requested_title: string | null
  requested_organisation: string | null
  requested_at: string | null
  created_at: string
}

// Super-user-only admin panel (2026-08-25, trial/beta access gate) — lists
// everyone whose backend User.status is still "pending" so Maro can approve
// them himself. Modal, not a routed page: same lightweight-overlay pattern
// as ConfirmHost (frontend/src/lib/confirmWithDontAsk.tsx), triggered from
// Sidebar's existing account section rather than a new nav item — there's
// no other settings/admin page in the app yet to fit this into.
export function AccessRequestsPanel({ onClose }: { onClose: () => void }) {
  const [requests, setRequests] = useState<PendingUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [denyingId, setDenyingId] = useState<string | null>(null)

  const refresh = () => {
    api.get<PendingUser[]>('/api/v1/access-requests/')
      .then(res => setRequests(res.data))
      .catch(() => setError('Could not load access requests.'))
  }

  useEffect(() => { refresh() }, [])

  const handleApprove = async (id: string) => {
    setApprovingId(id)
    try {
      await api.post(`/api/v1/access-requests/${id}/approve`)
      setRequests(prev => prev?.filter(r => r.id !== id) ?? null)
    } catch {
      setError('Could not approve that request.')
    } finally {
      setApprovingId(null)
    }
  }

  const handleDeny = async (r: PendingUser) => {
    const ok = await confirmWithDontAsk(
      'access-requests.deny',
      `Deny access for ${r.display_name}? They'll need to sign in again to request access a second time.`,
    )
    if (!ok) return
    setDenyingId(r.id)
    try {
      await api.delete(`/api/v1/access-requests/${r.id}`)
      setRequests(prev => prev?.filter(x => x.id !== r.id) ?? null)
    } catch {
      setError('Could not deny that request.')
    } finally {
      setDenyingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 no-print">
      <div className="bg-white dark:bg-prosota-panel rounded-lg shadow-xl max-w-lg w-full p-5 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-prosota-paper">Access requests</h2>
          <button onClick={onClose} className="text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper">
            Close
          </button>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        {requests === null ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">No pending requests.</p>
        ) : (
          <div className="space-y-3">
            {requests.map(r => (
              <div key={r.id} className="border border-gray-200 dark:border-prosota-line rounded-md p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{r.display_name}</p>
                  {/* Auth0 access tokens on this tenant don't reliably carry an email
                      claim (see get_db_user in backend/app/core/auth.py) — until that
                      self-heals on the requester's next login, r.email can still be the
                      synthetic `user+<sub>@prosotapmo.local` placeholder. Showing that
                      raw string here just reads as garbled text, so hide it rather than
                      display it; the real email shows up automatically once resolved. */}
                  {!r.email.endsWith('@prosotapmo.local') && (
                    <p className="text-xs text-gray-500 dark:text-prosota-muted truncate">{r.email}</p>
                  )}
                  {r.requested_title && (
                    <p className="text-xs text-gray-500 dark:text-prosota-muted mt-1">
                      {r.requested_title}{r.requested_organisation ? ` · ${r.requested_organisation}` : ''}
                    </p>
                  )}
                  {!r.requested_at && (
                    <p className="text-xs text-gray-400 dark:text-prosota-muted mt-1 italic">Signed up, hasn't requested access yet</p>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={() => handleDeny(r)}
                    disabled={approvingId === r.id || denyingId === r.id}
                    className="text-xs px-3 py-1.5 rounded-md border border-gray-300 dark:border-prosota-line text-gray-600 dark:text-prosota-muted hover:bg-gray-50 dark:hover:bg-prosota-ink disabled:opacity-50"
                  >
                    {denyingId === r.id ? 'Denying…' : 'Deny'}
                  </button>
                  <button
                    onClick={() => handleApprove(r.id)}
                    disabled={approvingId === r.id || denyingId === r.id}
                    className="text-xs px-3 py-1.5 rounded-md bg-blue-600 dark:bg-prosota-azure text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {approvingId === r.id ? 'Approving…' : 'Approve'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
