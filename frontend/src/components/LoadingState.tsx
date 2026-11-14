import { useEffect, useState } from 'react'

/** A readable fallback while a route or account check is pending. Never reloads automatically. */
export function LoadingState({ label, fullPage = false }: { label: string; fullPage?: boolean }) {
  const [slow, setSlow] = useState(false)
  const [offline, setOffline] = useState(() => !navigator.onLine)

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 12000)
    const updateConnection = () => setOffline(!navigator.onLine)
    window.addEventListener('online', updateConnection)
    window.addEventListener('offline', updateConnection)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('online', updateConnection)
      window.removeEventListener('offline', updateConnection)
    }
  }, [])

  return <div className={fullPage ? 'min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink p-8' : 'p-8'}>
    <div className="max-w-md text-sm">
      <p role="status" aria-live="polite" className="font-medium text-gray-700 dark:text-prosota-paper">{label}</p>
      {(slow || offline) && <div className="mt-3 text-gray-500 dark:text-prosota-muted">
        <p>{offline ? 'You appear to be offline. Reconnect to continue.' : 'This is taking longer than usual. Check your connection, or reload to try again.'}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-3 rounded border border-gray-300 dark:border-prosota-line px-3 py-2 text-gray-700 dark:text-prosota-paper hover:bg-gray-100 dark:hover:bg-prosota-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500">Reload page</button>
      </div>}
    </div>
  </div>
}
