import type { WebGLRenderer } from 'three'

type Frame = { start: number; updatesMs: number | null; submitMs: number; passes: number; draws: number; triangles: number; phases: Record<string, number> }
const probes = new WeakMap<object, ReturnType<typeof createViewportFrameMetrics>>()

export function registerViewportMetrics(renderer: object, metrics: ReturnType<typeof createViewportFrameMetrics>) {
  probes.set(renderer, metrics)
  return () => { if (probes.get(renderer) === metrics) probes.delete(renderer) }
}
export function beginViewportWork(renderer: object) {
  return probes.get(renderer)?.isActive() ? performance.now() : null
}
export function endViewportWork(renderer: object, name: string, start: number | null) {
  if (start !== null) probes.get(renderer)?.addPhase(name, performance.now() - start)
}

export function observeViewportRenderer(renderer: Pick<WebGLRenderer, 'render' | 'info'>, metrics: ReturnType<typeof createViewportFrameMetrics>) {
  const originalRender = renderer.render, originalReset = renderer.info.reset
  let resetCalls = 0, resetTriangles = 0, depth = 0
  // Three resets info *after* its shadow pass. Preserve those counters without
  // changing autoReset or the values other consumers see in renderer.info.
  const reset = function (this: typeof renderer.info) {
    resetCalls += this.render.calls
    resetTriangles += this.render.triangles
    return originalReset.call(this)
  }
  const render: typeof renderer.render = function (this: typeof renderer, ...args) {
    const outermost = depth++ === 0
    const start = outermost ? metrics.beginRender() : 0
    const calls = resetCalls + renderer.info.render.calls
    const triangles = resetTriangles + renderer.info.render.triangles
    try { return originalRender.apply(this, args) }
    finally {
      depth--
      if (outermost) metrics.endRender(start, resetCalls + renderer.info.render.calls - calls,
        resetTriangles + renderer.info.render.triangles - triangles)
    }
  }
  renderer.info.reset = reset
  renderer.render = render
  return () => {
    if (renderer.render === render) renderer.render = originalRender
    if (renderer.info.reset === reset) renderer.info.reset = originalReset
  }
}

// Aggregate whole frames, including every renderer pass. Keep only counters;
// a final fullscreen triangle must not overwrite the scene's draw statistics.
export function createViewportFrameMetrics(now = () => performance.now()) {
  let active = false, previousFrame: number | null = null, frame: Frame | null = null
  const empty = () => ({ frames: 0, intervals: 0, intervalMs: 0, updatesMs: 0, submitMs: 0, passes: 0, draws: 0, triangles: 0, phases: {} as Record<string, number> })
  let totals = empty()
  const finish = () => {
    if (!frame) return
    if (frame.passes) {
      totals.frames++
      totals.updatesMs += frame.updatesMs ?? 0
      totals.submitMs += frame.submitMs
      totals.passes += frame.passes
      totals.draws += frame.draws
      totals.triangles += frame.triangles
      for (const [name, duration] of Object.entries(frame.phases)) totals.phases[name] = (totals.phases[name] ?? 0) + duration
    }
    frame = null
  }
  return {
    isActive: () => active,
    setActive(value: boolean) { active = value; previousFrame = null },
    reset() { totals = empty(); previousFrame = null; frame = null },
    beginFrame() {
      finish()
      if (!active) return
      const start = now()
      if (previousFrame !== null) { totals.intervals++; totals.intervalMs += start - previousFrame }
      previousFrame = start
      frame = { start, updatesMs: null, submitMs: 0, passes: 0, draws: 0, triangles: 0, phases: {} }
    },
    beginRender() {
      const start = now()
      if (frame && frame.updatesMs === null) frame.updatesMs = start - frame.start
      return start
    },
    endRender(start: number, draws: number, triangles: number) {
      if (!frame) return
      frame.submitMs += now() - start
      frame.passes++
      frame.draws += draws
      frame.triangles += triangles
    },
    addPhase(name: string, duration: number) {
      if (frame) frame.phases[name] = (frame.phases[name] ?? 0) + duration
    },
    take() {
      finish()
      if (!totals.frames || !totals.intervals) return null
      const values = totals
      totals = empty()
      return {
        frameMs: values.intervalMs / values.intervals,
        updatesMs: values.updatesMs / values.frames,
        submitMs: values.submitMs / values.frames,
        passes: values.passes / values.frames,
        draws: values.draws / values.frames,
        triangles: values.triangles / values.frames,
        phases: Object.fromEntries(Object.entries(values.phases).map(([name, total]) => [name, total / values.frames])),
      }
    },
  }
}
