import React from 'react'
import ReactDOM from 'react-dom/client'
import { Auth0Provider } from '@auth0/auth0-react'
import { QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary } from './components/ErrorBoundary'
import { queryClient } from './lib/query'
import App from './App'
import './index.css'

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
  </Auth0Provider>,
)
