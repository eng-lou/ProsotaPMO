import { AnimationMixer, Bone, Object3D } from 'three'

export function captureAssetBindPose(root: Object3D) {
  root.traverse(node=>{
    if(node instanceof Bone)node.userData.prosotaBindPose={position:node.position.toArray(),quaternion:node.quaternion.toArray(),scale:node.scale.toArray()}
  })
}

/** Preserve the exported first-frame pose even when clips are excluded. */
export function applyInitialAssetPose(root: Object3D) {
  const clip = root.animations[0]
  if (!clip) return
  const mixer = new AnimationMixer(root)
  mixer.clipAction(clip).play()
  mixer.setTime(0)
  root.updateMatrixWorld(true)
  // Do not stop the action: stopping restores the bind pose. The temporary
  // mixer is unreferenced after this call; the sampled transforms stay put.
}
