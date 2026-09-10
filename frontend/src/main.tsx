import React from 'react'
import ReactDOM from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installStaleChunkReload } from './lib/staleChunkReload'
import { queryClient } from './lib/query'
import App from './App'
import './index.css'

// Stale-deploy chunk recovery (2026-08-30, per Maro hitting "Failed to
// fetch dynamically imported module" live on prosota.com) — see
// staleChunkReload.ts's own header for the full explanation. Installed
// before the render call so it's listening from the very first paint.
installStaleChunkReload()

// Auth0Provider is deliberately OUTSIDE StrictMode, not inside it. StrictMode
// intentionally double-invokes effects in development, and Auth0Provider's
// post-login effect exchanges a one-time-use authorization code for a token
// — a second invocation of that same exchange fails outright (the code's
// already spent), which surfaced as needing to sign in twice in a row
// (2026-07-05, per Maro). This is a documented conflict between
// @auth0/auth0-react and StrictMode; keeping StrictMode's double-render
// checks for the rest of the app while excluding just the auth callback
// handling is the standard fix.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <Auth0Provider
    domain={import.meta.env.VITE_AUTH0_DOMAIN}
    clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
    authorizationParams={{
      redirect_uri: window.location.origin,
      audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      scope: 'openid profile email offline_access',
    }}
    useRefreshTokens
    cacheLocation="localstorage"
  >
    {/* useRefreshTokens+localStorage: avoids relying on third-party-cookie iframe silent auth, which browsers increasingly block (see AuthTokenProvider.tsx) */}
    <React.StrictMode>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </ErrorBoundary>
    </React.StrictMode>
    {/* route (2026-09-11, per Maro chasing a real field LCP on Speed
        Insights): without it every beacon landed in a single "Unknown"
        bucket in the dashboard's Routes view — this app rewrites every
        path to this same index.html (vercel.json), so unlike a
        server-rendered app there's nothing in the request itself telling
        Vercel which page was actually loaded. Read directly off
        window.location rather than a router hook: this renders once,
        outside any router (the marketing homepage has none at all — see
        HomePage.tsx), and only needs the hard-navigation's own path, which
        is exactly what a page-load metric like LCP/FCP is attributed to
        (matches this component's own doc: data points are collected on
        hard navigations). Doesn't track subsequent in-app SPA navigation
        — a real limitation for attributing later CLS/INP within one
        session to the specific in-app route, not attempted here. */}
    <SpeedInsights route={window.location.pathname} />
  </Auth0Provider>,
)
