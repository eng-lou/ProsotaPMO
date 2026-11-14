import type { BatchedMesh } from 'three'
import { batchVisibilityRevision } from './batchRevision'

// Schedule visibility is stored independently by updateInstanceVisibility.
// Manual hide/isolate and movement restoration already compose with it. A
// paused orbit therefore only needs another pass after an actual mutation,
// binding change or React commit, not one pass per linked element per frame.
export function createBatchAnimationGate<T extends { mesh: BatchedMesh }>() {
  let previous: readonly T[] | null = null
  let dirty = true
  const batches = new Map<BatchedMesh, number>()
  return {
    invalidate() { dirty = true },
    needsUpdate(targets: readonly T[], dateChanged: boolean) {
      if (targets !== previous) {
        previous = targets
        batches.clear()
        for (const target of targets) batches.set(target.mesh, -1)
        dirty = true
      }
      if (dirty || dateChanged) return true
      for (const [mesh, revision] of batches) {
        if (batchVisibilityRevision(mesh) !== revision) return true
      }
      return false
    },
    applied() {
      for (const mesh of batches.keys()) batches.set(mesh, batchVisibilityRevision(mesh))
      dirty = false
    },
  }
}
