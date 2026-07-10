import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  onError: (message: string) => void
}

interface State {
  hasError: boolean
}

// Scoped around <Environment> in Viewport3D.tsx (2026-07-11 fix — the
// drei "apartment" preset's CDN fetch failed with "Failed to fetch" and,
// uncaught, took down the entire app to the top-level ErrorBoundary/"reload
// the page" screen). A regular React error boundary works fine inside a
// react-three-fiber <Canvas> — it's a real React reconciler, not DOM — so
// this catches a failed environment load (CDN unreachable, or a corrupt
// uploaded .hdr/.exr) and renders nothing for it instead, while the rest of
// the scene (grid, imported models, gizmo) keeps working. Give this a `key`
// tied to whatever environment source is active (see Viewport3D.tsx) so
// switching sources gets a fresh boundary instead of staying stuck
// reporting a now-stale error.
export class ViewportErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    this.props.onError(error instanceof Error ? error.message : 'Failed to load the environment map')
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}
