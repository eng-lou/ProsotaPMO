import { useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { api } from '../lib/api'

export function desktopSignInRequest(search: string) {
  const params = new URLSearchParams(search)
  const callback = new URL(params.get('callback') || 'https://invalid.invalid')
  const state = params.get('state') || ''
  const challenge = params.get('challenge') || ''
  if (callback.protocol !== 'http:' || callback.hostname !== '127.0.0.1' ||
      !callback.port || Number(callback.port) < 1024 || callback.pathname !== '/callback' ||
      callback.username || callback.password || callback.search || callback.hash ||
      !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null
  return { callback, state, challenge }
}

export function DesktopSignIn({ approved = false }: { approved?: boolean }) {
  const { loginWithRedirect, user, logout } = useAuth0()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  let request: ReturnType<typeof desktopSignInRequest> = null
  try { request = desktopSignInRequest(window.location.search) } catch { /* invalid link */ }
  async function connect() {
    if (!request || busy) return
    setBusy(true); setError('')
    try {
      const { data } = await api.post('/api/v1/desktop-auth/handoff', { challenge: request.challenge })
      request.callback.searchParams.set('code', data.code)
      request.callback.searchParams.set('state', request.state)
      window.location.assign(request.callback.href)
    } catch { setError('Could not connect. Try again, or restart sign-in from Prosota Desktop.'); setBusy(false) }
  }
  return <main className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink p-6">
    <div className="max-w-md w-full bg-white dark:bg-slate-900 dark:text-white rounded-xl border p-8 space-y-5">
      <h1 className="text-xl font-semibold">Prosota Desktop</h1>
      {!request ? <p>Open Prosota Desktop and choose Sign in to continue.</p> : <>
        <p>{approved ? `Continue as ${user?.email || user?.name || 'your Prosota account'}.` : 'Sign in with your Prosota account. New users can request access after signing in.'}</p>
        <button className="bg-blue-600 text-white px-5 py-3 rounded-lg disabled:opacity-50" disabled={busy}
          onClick={() => approved ? connect() : loginWithRedirect({ appState: { returnTo: window.location.pathname + window.location.search } })}>
          {busy ? 'Opening Desktop…' : approved ? 'Continue to Prosota Desktop' : 'Sign in / Create account'}
        </button>
        {approved && <button className="block text-sm text-blue-500" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>Use a different account</button>}
        <p className="text-sm text-gray-500">Your desktop projects and API keys stay on this PC.</p>
      </>}
      {error && <p role="alert" className="text-red-500">{error}</p>}
    </div>
  </main>
}
