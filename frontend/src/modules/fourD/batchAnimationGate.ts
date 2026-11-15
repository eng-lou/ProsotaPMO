import type { BatchedMesh } from 'three'
import { batchVisibilityRevision } from './batchRevision'
import type { ResolvedTimelineLink } from './timelinePlayback'

// Schedule visibility is stored independently by updateInstanceVisibility.
// Manual hide/isolate and movement restoration already compose with it. A
// paused orbit therefore only needs another pass after an actual mutation,
// binding change or React commit, not one pass per linked element per frame.
export function createBatchAnimationGate<T extends { mesh: BatchedMesh; links?: ResolvedTimelineLink[] }>() {
  let previous: readonly T[] | null = null
  let dirty = true
  const batches = new Map<BatchedMesh, number>()
  let pending: readonly T[] = []
  let lastTime: number | undefined
  let intervals: { start: number; end: number; maxEnd: number; target: T }[] = []
  return {
    invalidate() { dirty = true },
    needsUpdate(targets: readonly T[], dateChanged: boolean, now?: number) {
      if (targets !== previous) {
        previous = targets
        batches.clear()
        for (const target of targets) batches.set(target.mesh, -1)
        dirty = true
      }
      let changed = dirty
      for (const [mesh, revision] of batches) {
        if (batchVisibilityRevision(mesh) !== revision) changed = true
      }
      if (dirty) {
        intervals = targets.map(target => {
          let start = Infinity, end = -Infinity
          for (const link of target.links ?? []) {
            const days = Math.max(0, link.profile.duration_frames ?? 1) * 86400000
            start = Math.min(start, link.startMs, link.finishMs - (link.profile.trigger === 'on_finish' ? days : 0))
            end = Math.max(end, link.finishMs, link.startMs + (link.profile.trigger === 'on_start' ? days : 0))
          }
          if (!Number.isFinite(start) || !Number.isFinite(end)) { start = -Infinity; end = Infinity }
          return { start, end, maxEnd: end, target }
        }).sort((a, b) => a.start - b.start)
        let max = -Infinity
        for (const interval of intervals) { max = Math.max(max, interval.end); interval.maxEnd = max }
      }
      if (changed || now === undefined || lastTime === undefined) pending = targets
      else if (dateChanged) {
        const lo = Math.min(lastTime, now), hi = Math.max(lastTime, now)
        let left = 0, right = intervals.length
        while (left < right) { const mid = (left + right) >>> 1; if (intervals[mid].start <= hi) left = mid + 1; else right = mid }
        const affected: T[] = []
        for (let i = left - 1; i >= 0 && intervals[i].maxEnd >= lo; i--) {
          if (intervals[i].end >= lo) affected.push(intervals[i].target)
        }
        pending = affected
      } else pending = []
      lastTime = now
      return pending.length > 0
    },
    targetsToUpdate() { return pending },
    applied() {
      for (const mesh of batches.keys()) batches.set(mesh, batchVisibilityRevision(mesh))
      dirty = false
    },
  }
}
