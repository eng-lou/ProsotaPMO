import * as THREE from 'three'
import type { PathCoordinate, PathSegmentMode } from './paths'

export type PathAxis = keyof PathCoordinate
export interface PathDrawOptions { mode: PathSegmentMode; locks: PathAxis[] }
export function togglePathAxis(locks: PathAxis[], axis: PathAxis): PathAxis[] {
  return locks.includes(axis) ? locks.filter(a => a !== axis) : locks.length < 2 ? [...locks, axis] : locks
}

// Coordinates are viewport world axes (the same X/Y/Z shown on the gizmo).
// Solve on the constrained plane/line, not on a building behind the cursor.
export function constrainedPathPoint(ray: THREE.Ray, anchor: PathCoordinate, locks: PathAxis[]): PathCoordinate | null {
  const origin = new THREE.Vector3(anchor.x, anchor.y, anchor.z)
  const axes: PathAxis[] = ['x', 'y', 'z']
  const unique = axes.filter(a => locks.includes(a))
  let hit: THREE.Vector3 | null = null
  if (unique.length === 1) {
    const normal = new THREE.Vector3(); normal[unique[0]] = 1
    if (Math.abs(ray.direction.dot(normal)) < 1e-5) return null
    hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin), new THREE.Vector3())
  } else if (unique.length === 2) {
    const direction = new THREE.Vector3(); direction[axes.find(a => !unique.includes(a))!] = 1
    const dot = ray.direction.dot(direction), denominator = 1 - dot * dot
    if (denominator < 1e-5) return null
    const delta = ray.origin.clone().sub(origin)
    const distance = (delta.dot(direction) - dot * delta.dot(ray.direction)) / denominator
    hit = origin.clone().addScaledVector(direction, distance)
    if (hit.clone().sub(ray.origin).dot(ray.direction) < 0) return null
  }
  if (!hit || ![hit.x, hit.y, hit.z].every(Number.isFinite)) return null
  for (const axis of unique) hit[axis] = anchor[axis]
  return { x: hit.x, y: hit.y, z: hit.z }
}
