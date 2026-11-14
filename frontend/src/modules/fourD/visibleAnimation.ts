import type { Object3D } from 'three'

export function isObjectRendered(object: Object3D | null) {
  if (!object) return false
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false
  return true
}
