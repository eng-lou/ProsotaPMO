import * as THREE from 'three'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'

// Imported bind-pose bounds can differ substantially from the first walking
// pose. Sample a detached copy so the live skeleton and its mixer are untouched.
export function clipPathAnchor(object: THREE.Object3D, clip: THREE.AnimationClip): THREE.Vector3 {
  const copy = clone(object)
  const mixer = new THREE.AnimationMixer(copy)
  mixer.clipAction(clip).play(); mixer.setTime(0)
  copy.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(copy, true)
  mixer.stopAllAction(); mixer.uncacheRoot(copy)
  if (box.isEmpty()) return new THREE.Vector3()
  return new THREE.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2)
}
