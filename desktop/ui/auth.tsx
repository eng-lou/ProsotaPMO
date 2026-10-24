import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type User = { sub: string; name: string; email: string }
const bridge = (window as unknown as { prosotaDesktop: { identity(): Promise<User>; signOut(): Promise<void> } }).prosotaDesktop
const Auth = createContext({ isLoading: true, isAuthenticated: false, user: undefined as User | undefined,
  getAccessTokenSilently: async () => 'desktop-local', loginWithRedirect: async (_options?: unknown) => {},
  logout: (_options?: unknown) => { void bridge.signOut() } })
export const useAuth0 = () => useContext(Auth)
export function Auth0Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User>()
  const [error, setError] = useState(false)
  useEffect(() => { bridge.identity().then(setUser).catch(() => setError(true)) }, [])
  if (error) return <p>Could not verify your desktop session. Please restart Prosota.</p>
  if (!user) return <p>Opening your workspace…</p>
  return <Auth.Provider value={{ isLoading: !user, isAuthenticated: Boolean(user), user,
    getAccessTokenSilently: async () => 'desktop-local', loginWithRedirect: async () => {},
    logout: () => { void bridge.signOut() } }}>{children}</Auth.Provider>
}
