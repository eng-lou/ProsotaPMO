import { useEffect } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
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
    const requestInterceptor = api.interceptors.request.use(async (config) => {
      const token = await getTokenWithRetry(getAccessTokenSilently)
      if (token) config.headers.Authorization = `Bearer ${token}`
      // else: genuinely not authenticated after retrying — let the request
      // go through and the backend will correctly reject it with 403.
      return config
    })

    // A hard refresh fires a whole burst of API calls at once (project
    // list, activities, the 4D module's own restore effect, etc.), each
    // independently hitting the request interceptor above at almost the
    // same instant — right when there's no cached access token yet and a
    // real refresh-token exchange has to happen (2026-07-11, per
    // useRefreshTokens/cacheLocation="localstorage" in main.tsx). The SDK
    // is supposed to dedupe concurrent getAccessTokenSilently() calls
    // internally, but a burst this size at exactly this moment produced a
    // real, reproduced symptom regardless: "hard refresh shows nothing,
    // sign out/in shows it" — the model3d-files list request came back
    // 401/403 and FourD's restore effect (like other callers) treats a
    // failed list as "no files," not "the request failed," so the failure
    // was invisible even after this session's earlier fix for *that*
    // (there was nothing left to show an error about — the list looked
    // like a normal empty result, not a caught exception).
    // This retries a 401/403 exactly once, forcing a real (non-cached)
    // token fetch first — cheap insurance against that race for every API
    // call in the app, not just this one restore effect.
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const status = error.response?.status
        const config = error.config as (InternalAxiosRequestConfig & { _retriedAfterAuth?: boolean }) | undefined
        if ((status === 401 || status === 403) && config && !config._retriedAfterAuth) {
          config._retriedAfterAuth = true
          try {
            const token = await getAccessTokenSilently({ cacheMode: 'off' })
            config.headers.set('Authorization', `Bearer ${token}`)
            return api.request(config)
          } catch (refreshErr) {
            // Fresh fetch failed too — genuinely not authenticated, let the
            // original error surface rather than retrying forever. Logged
            // (2026-07-11, was silently swallowed with nothing at all
            // before) since this is the one spot that would show *why* the
            // token refresh itself failed (e.g. Auth0's own "missing
            // refresh token" / "login_required"), not just that some API
            // call got a 401/403.
            console.error('Forced token refresh failed after a 401/403', refreshErr)
          }
        }
        return Promise.reject(error)
      },
    )

    return () => {
      api.interceptors.request.eject(requestInterceptor)
      api.interceptors.response.eject(responseInterceptor)
    }
  }, [getAccessTokenSilently])

  return <>{children}</>
}
