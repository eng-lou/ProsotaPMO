import { enableVisibleViewportRaycast } from './viewportRaycast'
import { createPointerEvents } from '@react-three/fiber'
import type { Intersection, Object3D } from 'three'

// Filter before event dispatch so hidden geometry cannot intercept a click
// on another object, and clicks through empty openings reach onPointerMissed.
function visibleHit(hit: Intersection) {
  for (let node: Object3D | null = hit.object; node; node = node.parent) {
    if (!node.visible) return false
  }
  return true
}

export const visibleViewportEvents: typeof createPointerEvents = store => {
  enableVisibleViewportRaycast(store.getState().raycaster)
  const events = createPointerEvents(store)
  const wheel = events.handlers?.onWheel
  return {
    ...events,
    handlers: {
      ...events.handlers!,
      onWheel: event => {
        // Fiber raycasts every interaction root for wheel events, even when
        // they only handle clicks. OrbitControls handles the native event;
        // it does not need triangle picking to zoom. Keep real wheel tools.
        if (store.getState().internal.interaction.some(object =>
          (object as Object3D & { __r3f?: { handlers: { onWheel?: unknown } } }).__r3f?.handlers.onWheel)) wheel?.(event)
      },
    },
    filter: hits => hits.filter(visibleHit),
  }
}
