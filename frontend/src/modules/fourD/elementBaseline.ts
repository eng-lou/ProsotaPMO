import * as THREE from 'three'

// Per-object "as imported" transform snapshot (2026-07-09, per Maro: "if I
// change [a wall's Z] to 300, when i click backspace to reset. I dont want
// it to go to zero I would want it to go [back to its own] 200 z") —
// TransformPanel.tsx's hover-Backspace reset (ResettableNumberInput)
// previously always snapped every field back to a fixed 0 (Location/
// Rotation) or 1 (Scale), which is only actually correct for a freshly
// imported *whole* mesh/IFC group — every individual IFC sub-element starts
// with a real, usually non-zero, local position/rotation/scale (its placement
// within the building, baked in via ifcModel.ts's own
// `mesh.applyMatrix4(placed.flatTransformation)`), so resetting one of
// those to 0 silently teleported it to the model's own local origin instead
// of undoing the edit.
//
// Captured once, at import time (ifcModel.ts for each IFC mesh, import3d.ts
// for a mesh-kind import's own root), stored on the object's own userData
// so it travels with the object for its whole lifetime in the scene — never
// recomputed from the object's *current* transform, which would just chase
// whatever the live value already is and defeat the entire point. Also
// re-captured by applyTransform.ts immediately after a bake, since baking
// deliberately moves an object's *genuine* post-bake baseline to whatever
// the fields reset to there (0/0/1) — at that point 0/0/1 truly is the
// object's own original state again, going forward.
export interface BaselineTransform {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

export function captureBaseline(object: THREE.Object3D) {
  const baseline: BaselineTransform = {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
  }
  object.userData.baselineTransform = baseline
}

export function getBaseline(object: THREE.Object3D): BaselineTransform {
  const existing = object.userData.baselineTransform as BaselineTransform | undefined
  // Falls back to identity (equivalent to the old fixed 0/1 default) for
  // any object that somehow never got captured — shouldn't happen for
  // anything imported through this module's own loaders, but a live
  // fallback beats TransformPanel crashing on a missing snapshot.
  return existing ?? { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3(1, 1, 1) }
}

// Per-mesh "as imported" material snapshot (2026-07-09, per Maro: "when i
// change the material and delete the material, it doesn't actually go back
// to the default") — Viewport3D.tsx's ModelObjects effect used to only ever
// *write* mat.map/metalness/etc when a texture override slot was present,
// and did nothing at all when a slot was cleared, so a cleared override just
// left whatever the last-applied value was showing forever instead of
// reverting. Captured once per mesh at import time (one entry per material
// slot, aligned with `Array.isArray(mesh.material) ? mesh.material :
// [mesh.material]` — a mesh can carry more than one material for different
// face groups), so "no override" can be resolved back to a real snapshot
// instead of a guess. Never re-captured after that (an override applying is
// not a new "original"), except MaterialPresets/Select Linked's own
// overrides are tracked entirely separately in FourD.tsx's customTextures —
// this snapshot only ever reflects the file's own untouched material.
export interface OriginalMaterialSlot {
  color: THREE.Color
  map: THREE.Texture | null
  metalnessMap: THREE.Texture | null
  roughnessMap: THREE.Texture | null
  normalMap: THREE.Texture | null
  metalness: number
  roughness: number
}

function snapshotMaterial(mat: THREE.Material): OriginalMaterialSlot {
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    return { color: new THREE.Color(0xffffff), map: null, metalnessMap: null, roughnessMap: null, normalMap: null, metalness: 1, roughness: 1 }
  }
  return {
    color: mat.color.clone(),
    map: mat.map, metalnessMap: mat.metalnessMap, roughnessMap: mat.roughnessMap, normalMap: mat.normalMap,
    metalness: mat.metalness, roughness: mat.roughness,
  }
}

export function captureOriginalMaterial(mesh: THREE.Mesh) {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  mesh.userData.originalMaterials = materials.map(snapshotMaterial)
}

// Recurses through every Mesh in the subtree — used for a whole mesh-kind
// import (GLTF/OBJ/FBX), which can contain many meshes with independent
// materials, unlike an IFC import where each mesh is captured individually
// as it's created (ifcModel.ts's own loadIfcModel).
export function captureOriginalMaterialsRecursive(object: THREE.Object3D) {
  object.traverse(child => { if (child instanceof THREE.Mesh) captureOriginalMaterial(child) })
}

export function getOriginalMaterialSlots(mesh: THREE.Mesh): OriginalMaterialSlot[] {
  return (mesh.userData.originalMaterials as OriginalMaterialSlot[] | undefined) ?? []
}
