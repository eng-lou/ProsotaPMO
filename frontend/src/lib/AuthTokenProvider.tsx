import { useEffect, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { api } from './api'

// TOKEN_CALL_TIMEOUT_MS / withTimeout (2026-09-16, per Maro: on a work
// laptop, every module was stuck on "Loading…" forever, even after api.ts
// got its own 25s request timeout) — getAccessTokenSilently() is a network
// call to Auth0's own domain (a silent-auth iframe, or a refresh-token POST
// when the cached access token has expired), completely outside axios and
// outside its timeout. The request interceptor below `await`s it before
// every single API call, and axios never dispatches the actual request
// until that interceptor's promise settles — so if Auth0's own call hangs
// (exactly what a corporate proxy doing TLS inspection on a third-party
// auth domain can do), the request never leaves the browser at all, and
// api.ts's own timeout never gets the chance to start its clock. Racing
// every such call against a hard local deadline is what actually bounds
// this — the retry loop's own `catch` already assumes getAccessTokenSilently
// can fail, so a rejection from the race is the exact same recoverable case.
const TOKEN_CALL_TIMEOUT_MS = 8_000

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Auth token request timed out')), ms)
    promise.then(
      value => { clearTimeout(timer); resolve(value) },
      err => { clearTimeout(timer); reject(err) },
    )
  })
}

// REAUTH_FLAG / clearAuth0CacheAndReauth (2026-09-16, per Maro: on a work
// laptop, every module besides FourD looked permanently stuck — the actual
// console showed the real cause fast, not a hang: `/periods/bootstrap` and
// `/schedule-variants/bootstrap` both 403, then this file's own forced
// token refresh (below) failing with Auth0's "Missing Refresh Token").
// auth0-react's own cached tokens (cacheLocation="localstorage" in
// main.tsx) can go stale in a way a silent refresh can never recover from
// — no refresh token in the cache at all, which a corporate laptop clearing
// site data between sessions, or a login that predates this app's own
// offline_access scope, both produce. Before this, that case fell through
// to `Promise.reject(error)` below with nothing else — every subsequent
// request hit the exact same unrecoverable 401/403, forever, which is what
// actually looked like a stuck loading screen (the request settles fine,
// nothing ever shows why). This is the same fix already validated manually
// for this bug (see feedback_auth0_missing_refresh_token — clearing
// browser localStorage, not an Auth0 logout, is what actually clears it),
// just automatic: remove the SDK's own stale cache entries — scoped to its
// own key prefixes, not a blanket localStorage.clear(), so this doesn't
// touch unrelated stored state like the theme toggle — and send the user
// through a real top-level login redirect, which reliably issues a fresh
// refresh token the same way the very first sign-in did. sessionStorage
// (not an in-memory flag) guards against multiple requests failing at
// once each independently triggering their own redirect.
const REAUTH_FLAG = 'prosota-reauth-after-missing-refresh-token'

function clearAuth0LocalStorageCache() {
  const staleKeys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && (key.startsWith('@@auth0spajs@@') || key.startsWith('a0.spajs.'))) staleKeys.push(key)
  }
  staleKeys.forEach(key => localStorage.removeItem(key))
}

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
      return await withTimeout(getAccessTokenSilently(), TOKEN_CALL_TIMEOUT_MS)
    } catch {
      if (i < attempts - 1) await new Promise(resolve => setTimeout(resolve, 400))
    }
  }
  return null
}

export function AuthTokenProvider({ children }: { children: React.ReactNode }) {
  const { getAccessTokenSilently, loginWithRedirect } = useAuth0()
  // Gates `children` (and everything they mount) until a token has been
  // fetched at least once (2026-07-12, per Maro: "when i hard refresh...
  // literally have to log out then log back in to see what i was working
  // on"). React fires a *child's* mount effects before its parent's — so
  // without this gate, a descendant like FourD's own model-restore effect
  // could fire its first API call before the interceptors below were even
  // registered, let alone before any token existed to attach. That request
  // goes out with no Authorization header and no response-interceptor retry
  // to catch the resulting 401 (nothing was listening yet), which is
  // indistinguishable downstream from "you have no saved models" — exactly
  // the reported symptom. Signing out/in "fixed" it only by coincidence: a
  // full remount happens to land in a state where a token's already warm by
  // the time anything renders. This makes that reliable by construction
  // instead: nothing below can mount, so nothing below can race, until a
  // real token fetch has resolved (success or exhausted failure — see
  // getTokenWithRetry's own header on why a failure still lets requests
  // through rather than blocking forever).
  const [ready, setReady] = useState(false)

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
            const token = await withTimeout(getAccessTokenSilently({ cacheMode: 'off' }), TOKEN_CALL_TIMEOUT_MS)
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
            // See REAUTH_FLAG's own header — this is the case that used to
            // just dead-end here, forever, for every subsequent request.
            if (!sessionStorage.getItem(REAUTH_FLAG)) {
              sessionStorage.setItem(REAUTH_FLAG, '1')
              clearAuth0LocalStorageCache()
              loginWithRedirect()
            }
          }
        }
        return Promise.reject(error)
      },
    )

    // Fired synchronously in this same effect (i.e. after the two
    // interceptor registrations above, both of which are synchronous calls
    // — only this token fetch itself is actually async), so by the time it
    // resolves the interceptors are guaranteed already attached. `finally`,
    // not `then`: a genuinely-unauthenticated user (retries exhausted)
    // should still fall through to `ready`, same as every other call in
    // this file — this is only closing the startup race, not adding a new
    // way to get stuck on a blank screen.
    getTokenWithRetry(getAccessTokenSilently).finally(() => setReady(true))

    return () => {
      api.interceptors.request.eject(requestInterceptor)
      api.interceptors.response.eject(responseInterceptor)
    }
  }, [getAccessTokenSilently])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink">
        <span className="text-gray-400 dark:text-prosota-muted text-sm">Loading…</span>
      </div>
    )
  }

  return <>{children}</>
}
