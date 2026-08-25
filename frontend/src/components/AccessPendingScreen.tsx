import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import axios from 'axios'
import { api } from '@/lib/api'
import { useCurrentUser } from '@/lib/CurrentUserContext'
import { ProsotaLogo } from './ProsotaLogo'

// Shown instead of the app for any signed-in Auth0 user whose backend
// User.status isn't "approved" yet (2026-08-25, trial/beta access gate,
// per Maro: Google sign-in is open to anyone, but only pre-approved emails
// should get real access — everyone else lands here). Replaces Sidebar
// entirely, so it's the only place left with a sign-out option.
export function AccessPendingScreen() {
  const { user, logout } = useAuth0()
  const { currentUser, refetch } = useCurrentUser()
  const [name, setName] = useState(user?.name ?? '')
  const [title, setTitle] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const alreadyRequested = !!currentUser?.requested_at
  // Prefer the Auth0 SDK's own `user.email` (from the ID token / userinfo,
  // reliably populated) over the backend's `currentUser.email` for display
  // — the backend's copy comes off the *access* token, which for a custom
  // API audience doesn't always carry an email claim (2026-08-25, found via
  // Maro's own pre-existing account: it had fallen back to a synthetic
  // `user+<sub>@...local` placeholder). Login identity is still keyed on
  // auth0_sub either way, so this is purely a display fix, not a security one.
  const displayEmail = user?.email ?? currentUser?.email

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.post('/api/v1/access-requests/', { name, title, organisation: organisation || null })
      await refetch()
    } catch (err) {
      setError(axios.isAxiosError(err) ? err.response?.data?.detail ?? 'Could not send your request.' : 'Could not send your request.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSignOut = () => logout({ logoutParams: { returnTo: window.location.origin } })

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink px-4">
      <div className="max-w-md w-full text-center">
        <ProsotaLogo size={40} className="mx-auto mb-3" />
        <h1 className="font-display text-2xl font-bold text-gray-900 dark:text-prosota-paper mb-1">Prosota</h1>
        <p className="text-gray-500 dark:text-prosota-muted mb-6 text-sm">
          Prosota is currently in private beta — access is by approval only.
        </p>

        {alreadyRequested ? (
          <div className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 text-left">
            <p className="text-sm text-gray-800 dark:text-prosota-paper font-medium mb-1">Request sent</p>
            <p className="text-sm text-gray-500 dark:text-prosota-muted">
              You'll get access as soon as it's approved. Signed in as <span className="font-medium">{displayEmail}</span>.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white dark:bg-prosota-panel border border-gray-200 dark:border-prosota-line rounded-lg p-5 text-left space-y-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-prosota-muted mb-1">Email</label>
              <p className="text-sm text-gray-700 dark:text-prosota-paper">{displayEmail}</p>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-prosota-muted mb-1">Name</label>
              <input
                required
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-prosota-line rounded-md px-3 py-1.5 bg-white dark:bg-prosota-ink text-gray-900 dark:text-prosota-paper"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-prosota-muted mb-1">Role / title</label>
              <input
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. Project Manager"
                className="w-full text-sm border border-gray-300 dark:border-prosota-line rounded-md px-3 py-1.5 bg-white dark:bg-prosota-ink text-gray-900 dark:text-prosota-paper"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-prosota-muted mb-1">Organisation (optional)</label>
              <input
                value={organisation}
                onChange={e => setOrganisation(e.target.value)}
                className="w-full text-sm border border-gray-300 dark:border-prosota-line rounded-md px-3 py-1.5 bg-white dark:bg-prosota-ink text-gray-900 dark:text-prosota-paper"
              />
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 dark:bg-prosota-azure text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Sending…' : 'Request access'}
            </button>
          </form>
        )}

        <button onClick={handleSignOut} className="text-xs text-gray-500 dark:text-prosota-muted hover:text-gray-900 dark:hover:text-prosota-paper mt-4">
          Sign out
        </button>
      </div>
    </div>
  )
}
