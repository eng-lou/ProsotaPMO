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

interface CurrentUserSummary {
  id: string
  email: string
  display_name: string
  role: string
  is_super_user: boolean
  // Named after how they're originally collected (a pending request's own
  // fields) but real, current values for an approved user too — never
  // cleared on approval (2026-08-30, per Maro: "i still want to see their
  // role/organisation details" for the current-users roster, not just
  // pending requests).
  requested_title: string | null
  requested_organisation: string | null
  last_active_at: string | null
  total_active_seconds: number
  created_at: string
}

// Mirrors the email fallback below — display_name defaults to the same
// synthetic string at first-login (backend/app/core/auth.py) and self-heals
// the same way, but only once that account's own next request runs through
// it; shows a plain placeholder in the meantime rather than the raw string.
function displayName(name: string) {
  return name.endsWith('@prosotapmo.local') ? 'Unnamed user' : name
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// "3m ago" / "5h ago" / "2d ago" etc. — coarse on purpose, this is a "who's
// actually using this" glance, not a precise audit log.
function formatRelative(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

// Total time spent in the app, all-time (2026-08-30, per Maro: "i also
// want to see how long they've spent on the app") — accumulated
// server-side from a throttled activity heartbeat (see get_db_user in
// app/core/auth.py), not a precise session log, so this stays similarly
// coarse to formatRelative above: at most two units, biggest first.
function formatDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return '<1m'
  const mins = Math.floor(totalSeconds / 60)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins}m`
}

// Authenticated CSV download (2026-08-30, per Maro: "i want to be able to
// export the log too") — same shape as feedback_tickets.py's own
// downloadFeedbackLog, the precedent for "download the log" already
// elsewhere in this app: a plain <a href> can't carry the Bearer token, so
// the file is fetched via the shared axios instance and handed to the
// browser as a Blob download instead.
async function downloadAccessLog(): Promise<void> {
  const res = await api.get('/api/v1/access-requests/export', { responseType: 'blob' })
  const url = URL.createObjectURL(res.data as Blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'access-manager-users.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Super-user-only admin panel (2026-08-25, trial/beta access gate; renamed
// and moved 2026-08-27 per Maro — was "Access requests" in the Sidebar,
// only reachable once inside a project; now "Access Manager" on the
// Project Selector page itself, since it's an account-level concern, not
// a project one, and a super user shouldn't need to already be in a
// project to review who has access). Two sections: pending requests
// (Approve/Deny, unchanged from the original panel) and a roster of
// everyone already approved, with when they last used the app, how long
// they've spent in it all-time, and (still 2026-08-30) the same title/
// organisation a pending request already showed — never actually cleared
// on approval, just not surfaced here until now. That roster can also be
// exported as a CSV (same "download the log" pattern feedback_tickets.py's
// own export already established).
export function AccessManagerPanel({ onClose }: { onClose: () => void }) {
  const [requests, setRequests] = useState<PendingUser[] | null>(null)
  const [currentUsers, setCurrentUsers] = useState<CurrentUserSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [denyingId, setDenyingId] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await downloadAccessLog()
    } catch {
      setError('Could not export the current-users log.')
    } finally {
      setExporting(false)
    }
  }

  const refresh = () => {
    api.get<PendingUser[]>('/api/v1/access-requests/')
      .then(res => setRequests(res.data))
      .catch(() => setError('Could not load access requests.'))
    api.get<CurrentUserSummary[]>('/api/v1/access-requests/users')
      .then(res => setCurrentUsers(res.data))
      .catch(() => setError('Could not load current users.'))
  }

  useEffect(() => { refresh() }, [])

  const handleApprove = async (id: string) => {
    setApprovingId(id)
    try {
      await api.post(`/api/v1/access-requests/${id}/approve`)
      setRequests(prev => prev?.filter(r => r.id !== id) ?? null)
      // Re-fetch rather than optimistically splicing a constructed row in —
      // the just-approved account now belongs in the current-users list too.
      api.get<CurrentUserSummary[]>('/api/v1/access-requests/users').then(res => setCurrentUsers(res.data))
    } catch {
      setError('Could not approve that request.')
    } finally {
      setApprovingId(null)
    }
  }

  const handleDeny = async (r: PendingUser) => {
    const ok = await confirmWithDontAsk(
      'access-requests.deny',
      `Deny access for ${displayName(r.display_name)}? They'll need to sign in again to request access a second time.`,
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
      <div className="bg-white dark:bg-prosota-panel rounded-lg shadow-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-prosota-paper">Access Manager</h2>
          <button onClick={onClose} className="text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper">
            Close
          </button>
        </div>

        {error && <p className="text-xs text-red-600 mb-3">{error}</p>}

        <h3 className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide mb-2">
          Pending requests{requests && requests.length > 0 ? ` (${requests.length})` : ''}
        </h3>
        {requests === null ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted mb-5">Loading…</p>
        ) : requests.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted mb-5">No pending requests.</p>
        ) : (
          <div className="space-y-3 mb-5">
            {requests.map(r => (
              <div key={r.id} className="border border-gray-200 dark:border-prosota-line rounded-md p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">{displayName(r.display_name)}</p>
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

        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-prosota-muted uppercase tracking-wide">
            Current users{currentUsers && currentUsers.length > 0 ? ` (${currentUsers.length})` : ''}
          </h3>
          {currentUsers && currentUsers.length > 0 && (
            <button
              onClick={handleExport}
              disabled={exporting}
              title="Download this roster (email, role, title/organisation, last active, total time) as a CSV"
              className="text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper disabled:opacity-50"
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
            </button>
          )}
        </div>
        {currentUsers === null ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">Loading…</p>
        ) : currentUsers.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-prosota-muted">No approved users yet.</p>
        ) : (
          <div className="space-y-2">
            {currentUsers.map(u => (
              <div key={u.id} className="border border-gray-200 dark:border-prosota-line rounded-md p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-prosota-paper truncate">
                    {displayName(u.display_name)}
                    {u.is_super_user && (
                      <span className="ml-1.5 text-[10px] font-semibold text-blue-600 dark:text-prosota-azure align-middle">SUPER</span>
                    )}
                  </p>
                  {!u.email.endsWith('@prosotapmo.local') && (
                    <p className="text-xs text-gray-500 dark:text-prosota-muted truncate">{u.email}</p>
                  )}
                  {u.requested_title && (
                    <p className="text-xs text-gray-500 dark:text-prosota-muted mt-1 truncate">
                      {u.requested_title}{u.requested_organisation ? ` · ${u.requested_organisation}` : ''}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  {u.last_active_at ? (
                    <>
                      <p className="text-xs text-gray-700 dark:text-prosota-paper">{formatRelative(u.last_active_at)}</p>
                      <p className="text-[10px] text-gray-400 dark:text-prosota-muted">{formatDateTime(u.last_active_at)}</p>
                    </>
                  ) : (
                    <p className="text-xs text-gray-400 dark:text-prosota-muted italic">Never</p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-prosota-muted mt-0.5" title="Total time spent in the app, all-time — a coarse estimate, not a precise audit log">
                    {formatDuration(u.total_active_seconds)} total
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
