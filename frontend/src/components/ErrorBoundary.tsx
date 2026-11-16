import { Component, type ErrorInfo, type ReactNode } from 'react'
import { isStaleChunkError, reloadOnceForStaleChunk } from '@/lib/staleChunkReload'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  // Shown on screen, not just logged (2026-09-25): a minified React error
  // (e.g. #185, an update loop) says nothing about *where* it happened, and
  // the component stack was only in the console, which is much harder to
  // get at from a user's screenshot of this screen.
  componentStack: string | null
}

// This app previously had no error boundary anywhere — any uncaught error
// during rendering (not just a failed API call) unmounted the entire React
// tree, leaving a blank white page with no indication of what happened
// (2026-07-04, per Maro: clicking Add Exception "went all white"). Error
// boundaries only work as class components — there's no hook equivalent.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, componentStack: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack)
    this.setState({ componentStack: info.componentStack ?? null })
    // Fallback path for a stale post-deploy chunk 404 (see
    // staleChunkReload.ts's own header) — the primary path is that file's
    // `vite:preloadError` listener, installed in main.tsx; this catches it
    // here too in case some dynamic import fails without going through
    // Vite's own preload machinery. reloadOnceForStaleChunk reloads the
    // tab immediately if it hasn't already tried once this session, so the
    // static "Something went wrong" UI below never actually gets seen for
    // this specific case — it stays as the fallback for every other kind
    // of render error, which this isn't.
    if (isStaleChunkError(error)) reloadOnceForStaleChunk()
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-prosota-ink p-8">
          <div className="max-w-lg w-full bg-white dark:bg-prosota-panel border border-red-200 dark:border-red-500/30 rounded-lg shadow-sm p-6">
            <h1 className="text-lg font-bold text-red-700 dark:text-red-400 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-600 dark:text-prosota-muted mb-4">
              This screen hit an unexpected error and couldn't continue. Reload to retry. If it keeps happening,
              please share the details below. Reload does not clear your saved project or material settings.
            </p>
            <pre className="text-xs bg-gray-50 dark:bg-prosota-panel2 border border-gray-200 dark:border-prosota-line dark:text-prosota-paper rounded p-3 overflow-auto max-h-48 mb-4 whitespace-pre-wrap">
              {this.state.error.message}
              {this.state.componentStack && `\n\nWhere:${this.state.componentStack.split('\n').slice(0, 12).join('\n')}`}
            </pre>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => window.location.reload()}
                className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700 dark:bg-prosota-azure dark:hover:bg-prosota-azure/80"
              >
                Reload
              </button>

            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
