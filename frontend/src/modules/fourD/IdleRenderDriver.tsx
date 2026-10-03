import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { useThree } from '@react-three/fiber'

// Idle render throttle (2026-09-30, chasing Maro's /4d INP of 376ms on
// Vercel Speed Insights). Measured live on the real 2018 hospital model:
// the Canvas redrew a completely static scene every frame at ~72ms of GPU
// time (shadow pass ~31ms, AO ~13ms, main ~28ms), and every click's own
// repaint queued behind those frames — ~250ms from click to paint although
// React's own work for the click was under 10ms. With shadows and AO off
// the same click took ~90ms, so the cost scaled with the idle redraw, not
// with the click.
//
// The Canvas now runs frameloop="demand" and this component decides when a
// frame is needed: every frame while anything is changing, and a slow
// heartbeat otherwise, so asynchronous changes nobody signals (a texture
// finishing, a tile streaming in) still land within IDLE_INTERVAL_MS.
// "Changing" is deliberately broad — any of:
//   - input on any canvas (orbit, gizmo drags, hover highlights, the
//     comparison panes' shared camera), a drag anywhere, a wheel or a key;
//   - any re-render of the Canvas tree (every React-driven scene change —
//     render mode, selection, visibility, capture settings — commits here);
//   - the timeline date moving (playback, scrubbing, video export all write
//     timelineDateRef without a React commit);
//   - the camera moving (OrbitControls damping, fly-to, camera keyframes);
//   - markRenderActivity() from code that needs frames without any of the
//     above (captures);
//   - `continuous` (GLB animation mixers, video export).
// ACTIVE_MS of full-rate rendering follows the last of these.
const ACTIVE_MS = 1500
const IDLE_INTERVAL_MS = 1000

// Not Matrix4.equals: OrbitControls.update re-derives the camera matrix
// every rendered frame with ~1e-16 of floating-point noise, which an exact
// comparison reads as movement — the loop then keeps itself awake forever
// (found live on the first version of this).
function matricesNearlyEqual(a: THREE.Matrix4, b: THREE.Matrix4) {
  for (let i = 0; i < 16; i++) {
    const x = a.elements[i]
    const y = b.elements[i]
    if (Math.abs(x - y) > 1e-7 * Math.max(1, Math.abs(x), Math.abs(y))) return false
  }
  return true
}

let externalActivityAt = 0

// Offline video export (2026-10-03, per Maro: exported MP4s "not picking up
// the animation"). Export used to record in real time, so at a heavy
// resolution with comparison views most of the timeline was skipped. It now
// steps the timeline frame by frame and asks every live 3D view to draw
// right then (renderAllViewsNow), encoding each composed frame at its exact
// timestamp. While that runs, the idle loop below stops invalidating, so no
// view draws the same frame twice in between. Each mounted driver registers
// its own canvas — the main view and every active comparison view.
const viewRenderers = new Set<(timestamp: number) => void>()
let offlineExportActive = false
export function setOfflineExportActive(active: boolean) {
  offlineExportActive = active
}
export function renderAllViewsNow() {
  const timestamp = performance.now()
  for (const render of viewRenderers) render(timestamp)
}
export function markRenderActivity() {
  externalActivityAt = performance.now()
}

export function IdleRenderDriver({ dateRef, continuous }: {
  dateRef: React.MutableRefObject<Date | null>
  continuous: boolean
}) {
  const invalidate = useThree(s => s.invalidate)
  const advance = useThree(s => s.advance)
  useEffect(() => {
    const render = (timestamp: number) => advance(timestamp, true)
    viewRenderers.add(render)
    return () => { viewRenderers.delete(render) }
  }, [advance])
  const camera = useThree(s => s.camera)
  const lastActivityRef = useRef(performance.now())
  const continuousRef = useRef(continuous)
  continuousRef.current = continuous

  // No deps on purpose: runs after every commit of the Canvas tree.
  useEffect(() => {
    lastActivityRef.current = performance.now()
    invalidate()
  })

  useEffect(() => {
    const bump = () => { lastActivityRef.current = performance.now() }
    const onPointer = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement || e.buttons !== 0) bump()
    }
    const opts = { capture: true, passive: true }
    window.addEventListener('pointerdown', onPointer, opts)
    window.addEventListener('pointermove', onPointer, opts)
    window.addEventListener('pointerup', onPointer, opts)
    window.addEventListener('wheel', bump, opts)
    window.addEventListener('keydown', bump, opts)
    return () => {
      window.removeEventListener('pointerdown', onPointer, opts)
      window.removeEventListener('pointermove', onPointer, opts)
      window.removeEventListener('pointerup', onPointer, opts)
      window.removeEventListener('wheel', bump, opts)
      window.removeEventListener('keydown', bump, opts)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let lastDateMs: number | null = dateRef.current?.getTime() ?? null
    let lastIdleRenderAt = 0
    const lastCameraMatrix = new THREE.Matrix4()
    const tick = (now: number) => {
      const dateMs = dateRef.current?.getTime() ?? null
      if (dateMs !== lastDateMs) {
        lastDateMs = dateMs
        lastActivityRef.current = now
      }
      if (!matricesNearlyEqual(camera.matrixWorld, lastCameraMatrix)) {
        lastCameraMatrix.copy(camera.matrixWorld)
        lastActivityRef.current = now
      }
      if (offlineExportActive) {
        raf = requestAnimationFrame(tick)
        return
      }
      const lastActivity = Math.max(lastActivityRef.current, externalActivityAt)
      if (continuousRef.current || now - lastActivity < ACTIVE_MS) {
        invalidate()
      } else if (now - lastIdleRenderAt >= IDLE_INTERVAL_MS) {
        lastIdleRenderAt = now
        invalidate()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [camera, dateRef, invalidate])

  return null
}
