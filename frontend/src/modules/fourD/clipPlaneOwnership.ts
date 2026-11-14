import type { Plane } from 'three'
type OwnedPlane = Plane & { __clipOwner?: string }

// Preserve other clipping systems and reuse the array when the actual planes
// are unchanged. This runs for every animated material on every rendered frame.
export function mergeClipPlanes(existing: Plane[] | null, owner: string, ownPlanes: Plane[]): Plane[] | null {
  let count = 0, unchanged = true
  for (const plane of existing ?? []) {
    if ((plane as OwnedPlane).__clipOwner !== owner) continue
    const next = ownPlanes[count++]
    if (!next || !plane.equals(next)) unchanged = false
  }
  if (unchanged && count === ownPlanes.length) return existing
  const foreign = (existing ?? []).filter(p => (p as OwnedPlane).__clipOwner !== owner)
  for (const plane of ownPlanes) (plane as OwnedPlane).__clipOwner = owner
  return foreign.length || ownPlanes.length ? [...foreign, ...ownPlanes] : null
}
