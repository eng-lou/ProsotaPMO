import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { OrbitControls } from 'three-stdlib'
import { createViewportFrameMetrics, observeViewportRenderer, registerViewportMetrics } from './viewportFrameMetrics'
import { createNavigationSession } from './navigationSession'

// Opt-in, local-only measurements. Updating a DOM text node avoids making the
// entire BIM React tree render in order to measure the renderer.
export function ViewportPerformanceProbe({ output, controlsRef }: {
  output: React.RefObject<HTMLPreElement>
  controlsRef: React.MutableRefObject<OrbitControls | null>
}) {
  const { gl } = useThree()
  const metrics = useMemo(() => createViewportFrameMetrics(), [])
  useFrame(() => metrics.beginFrame(), -1000)
  useEffect(() => {
    const unregister = registerViewportMetrics(gl, metrics)
    const stopObserving = observeViewportRenderer(gl, metrics)
    const controls = controlsRef.current
    // Include settled-camera work: an idle render loop can block buttons just
    // as much as orbiting. Keep wheel bursts active until their frames land.
    metrics.setActive(true)
    let navigating = false
    const session = createNavigationSession(
      () => { navigating = true; metrics.reset() },
      () => { navigating = false; metrics.reset() },
    )
    controls?.addEventListener('start', session.start)
    controls?.addEventListener('end', session.end)
    controls?.addEventListener('change', session.change)
    const context = gl.getContext()
    const debug = context.getExtension('WEBGL_debug_renderer_info')
    const gpu = debug ? String(context.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'Unavailable'
    const multiDraw = gl.extensions.has('WEBGL_multi_draw')
    const publish = () => {
      const sample = metrics.take()
      if (!sample || !output.current) return
      const frameMs = sample.frameMs
      output.current.textContent = [
        navigating
          ? `Navigation: ${(1000 / frameMs).toFixed(1)} FPS · ${frameMs.toFixed(1)} ms/frame`
          : `Camera settled: ${(1000 / frameMs).toFixed(1)} renders/sec (lower is normal when idle)`,
        `Before first render: ${sample.updatesMs.toFixed(1)} ms/frame`,
        `Measured updates: ${Object.entries(sample.phases).map(([name, ms]) => `${name} ${ms.toFixed(1)} ms`).join(' · ') || 'none'}`,
        `CPU render submission: ${sample.submitMs.toFixed(1)} ms/frame · ${sample.passes.toFixed(1)} passes`,
        `All passes: ${Math.round(sample.draws).toLocaleString()} draws · ${Math.round(sample.triangles).toLocaleString()} triangles/frame`,
        `Multi-draw: ${multiDraw ? 'available' : 'unavailable'} · Buffer: ${gl.domElement.width} × ${gl.domElement.height}`,
        `GPU: ${gpu}`,
      ].join('\n')
    }
    const timer = setInterval(publish, 1000)
    return () => {
      clearInterval(timer)
      unregister()
      controls?.removeEventListener('start', session.start)
      controls?.removeEventListener('end', session.end)
      controls?.removeEventListener('change', session.change)
      session.finish()
      stopObserving()
    }
  }, [gl, output, controlsRef, metrics])
  return null
}
