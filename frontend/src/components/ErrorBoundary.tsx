import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

// This app previously had no error boundary anywhere — any uncaught error
// during rendering (not just a failed API call) unmounted the entire React
// tree, leaving a blank white page with no indication of what happened
// (2026-07-04, per Maro: clicking Add Exception "went all white"). Error
// boundaries only work as class components — there's no hook equivalent.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught render error:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8">
          <div className="max-w-lg w-full bg-white border border-red-200 rounded-lg shadow-sm p-6">
            <h1 className="text-lg font-bold text-red-700 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-600 mb-4">
              This screen hit an unexpected error and couldn't continue. Reloading usually fixes it — if it keeps
              happening, screenshot the details below.
            </p>
            <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-3 overflow-auto max-h-48 mb-4 whitespace-pre-wrap">
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              className="text-sm px-4 py-1.5 rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Reload
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
