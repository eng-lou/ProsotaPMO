import { useEffect } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { api } from './api'

// A couple of retries with a short backoff — not a fixed one-shot try.
// getAccessTokenSilently() needs a real round-trip (a silent iframe auth
// check) the very first time it's called in a session, and that first call
// usually happens right when the app's first API request fires (e.g. the
// Project Selector loading projects immediately after sign-in) — so a
// single transient slowness/failure here used to silently fall through to
// an unauthenticated request, which the backend correctly rejects with 403,
// which then read as "you have no projects" (2026-07-05, per Maro:
// "sometimes when I sign in, I don't see my other projects"). Nothing in
// this app actually redirects on 401/403 despite what the old comment here
// claimed, so that fallback was never a safety net to begin with.
async function getTokenWithRetry(getAccessTokenSilently: () => Promise<string>, attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await getAccessTokenSilently()
    } catch {
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 400))
    }
  }
  return null
}

export function AuthTokenProvider({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently } = useAuth0()

  useEffect(() => {
    const interceptor = api.interceptors.request.use(async (config) => {
      const token = await getTokenWithRetry(getAccessTokenSilently)
      if (token) config.headers.Authorization = `Bearer ${token}`
      // else: genuinely not authenticated after retrying — let the request
      // go through and the backend will correctly reject it with 403.
      return config
    })
    return () => api.interceptors.request.eject(interceptor)
  }, [getAccessTokenSilently])

  return <>{children}</>
}
