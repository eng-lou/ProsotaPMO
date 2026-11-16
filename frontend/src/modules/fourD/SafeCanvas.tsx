import { Component, useCallback, type ReactNode } from 'react'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import { WebGLRenderer, type WebGLRendererParameters } from 'three'

// Acquire the context before constructing Three: failed constructors can leave
// listeners behind. Preserve section stencil and capture drawing buffers.
export function createViewportRenderer(canvas: HTMLCanvasElement | OffscreenCanvas, options: WebGLRendererParameters = {}) {
  const attempts: WebGLContextAttributes[] = [
    { alpha: true, antialias: true, powerPreference: 'high-performance', ...options },
    { alpha: true, ...options, antialias: false, powerPreference: 'default' },
  ]
  let reason = ''
  const failed = (event: Event) => { reason = (event as WebGLContextEvent).statusMessage || reason }
  canvas.addEventListener('webglcontextcreationerror', failed)
  try {
    for (const attributes of attempts) {
      let context: WebGL2RenderingContext | null = null
      try { context = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null } catch (error) {
        reason = error instanceof Error ? error.message : String(error)
      }
      if (context) return new WebGLRenderer({ ...options, canvas, context })
    }
    throw new Error(`Error creating WebGL context.${reason ? ` ${reason}` : ''}`)
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', failed)
  }
}

class ContextBoundary extends Component<{ children: ReactNode }, { error: Error | null; attempt: number }> {
  state = { error: null as Error | null, attempt: 0 }
  static getDerivedStateFromError(error: Error) {
    if (!/Error creating WebGL context/i.test(error.message)) throw error
    return { error }
  }
  render() {
    if (this.state.error) return <div role="alert" className="flex h-full min-h-48 items-center justify-center p-6 bg-slate-100 dark:bg-slate-900">
      <div className="max-w-lg text-sm text-slate-800 dark:text-slate-100">
        <h2 className="font-semibold text-base mb-2">3D graphics unavailable</h2>
        <p>The browser could not start WebGL. Your project data has not been changed. You can keep using the other workspaces.</p>
        <p className="mt-2">Close other 3D tabs and retry. If this persists, restart the browser and check that graphics acceleration is enabled in its settings.</p>
        <button className="mt-3 rounded bg-blue-600 px-4 py-2 text-white" onClick={() => this.setState(s => ({ error: null, attempt: s.attempt + 1 }))}>Retry 3D view</button>
        <details className="mt-3"><summary>Technical details</summary><pre className="whitespace-pre-wrap">{this.state.error.message}</pre></details>
      </div>
    </div>
    return <div key={this.state.attempt} style={{ width: '100%', height: '100%' }}>{this.props.children}</div>
  }
}

// R3F retains ownership of renderer disposal and context-loss cleanup.
export function SafeCanvas({ gl, ...props }: Omit<CanvasProps, 'gl'> & { gl?: WebGLRendererParameters }) {
  const create = useCallback((canvas: HTMLCanvasElement | OffscreenCanvas) => createViewportRenderer(canvas, gl), [gl])
  return <ContextBoundary><Canvas {...props} gl={create} /></ContextBoundary>
}
