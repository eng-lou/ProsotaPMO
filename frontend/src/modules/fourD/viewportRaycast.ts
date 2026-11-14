import { Object3D, Mesh, BatchedMesh, InstancedMesh, SkinnedMesh, Line, Points, Sprite, type Raycaster } from 'three'

const viewportRaycasters = new WeakSet<Raycaster>()
let installed = false
export function isHierarchyVisible(object: Object3D) {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false
  return true
}

// Three normally raycasts invisible objects. Filtering hits afterwards still
// pays for every hidden triangle. Restrict this policy to viewport event rays:
// measurement, construction and other geometry queries retain Three's behavior.
export function enableVisibleViewportRaycast(raycaster: Raycaster) {
  viewportRaycasters.add(raycaster)
  if (installed) return
  installed = true
  for (const type of [Object3D, Mesh, BatchedMesh, InstancedMesh, SkinnedMesh, Line, Points, Sprite]) {
    if (!Object.prototype.hasOwnProperty.call(type.prototype, 'raycast')) continue
    const original = type.prototype.raycast
    type.prototype.raycast = function (ray, hits) {
      // Returning false also stops Three's recursive walk of a hidden group.
      if (viewportRaycasters.has(ray) && !isHierarchyVisible(this)) return false
      return original.call(this, ray, hits)
    }
  }
}
