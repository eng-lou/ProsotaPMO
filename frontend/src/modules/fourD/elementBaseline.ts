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
  // 2026-07-11, per Maro: AO + Displacement joining the existing 4 slots —
  // always null here, same as every other map slot: nothing in ifcModel.ts
  // or a freshly-loaded GLTF/OBJ/FBX ever sets these on import, so "the
  // original" a cleared override restores to is genuinely just "no map,"
  // not a guess.
  aoMap: THREE.Texture | null
  displacementMap: THREE.Texture | null
  metalness: number
  roughness: number
}

function snapshotMaterial(mat: THREE.Material): OriginalMaterialSlot {
  if (!(mat instanceof THREE.MeshStandardMaterial)) {
    return {
      color: new THREE.Color(0xffffff), map: null, metalnessMap: null, roughnessMap: null, normalMap: null,
      aoMap: null, displacementMap: null, metalness: 1, roughness: 1,
    }
  }
  return {
    color: mat.color.clone(),
    map: mat.map, metalnessMap: mat.metalnessMap, roughnessMap: mat.roughnessMap, normalMap: mat.normalMap,
    aoMap: mat.aoMap, displacementMap: mat.displacementMap,
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

// Per-mesh "as imported" geometry snapshot (2026-07-11, per Maro: displacement
// mapping needing subdivision to actually show detail — see
// geometrySubdivision.ts's own header) — Viewport3D.tsx's ModelObjects
// effect swaps `mesh.geometry` to a denser, subdivided copy whenever
// displacement + a subdivision level are active, and back to whatever's
// captured here whenever they aren't. A plain reference capture (not a
// clone — nothing here ever mutates the original geometry in place;
// subdivideGeometry always returns a brand-new BufferGeometry), taken once
// at import time, same shape/timing as captureOriginalMaterial right above.
// Re-captured by applyTransform.ts immediately after a bake for the exact
// same reason captureBaseline is: baking permanently changes what "the
// original" geometry actually is (the transform gets folded straight into
// its vertex positions), so the *baked* geometry becomes the new original
// going forward, not the pre-bake one.
export function captureOriginalGeometry(mesh: THREE.Mesh) {
  mesh.userData.originalGeometry = mesh.geometry
}

// Recurses through every Mesh in the subtree — same reasoning as
// captureOriginalMaterialsRecursive above (a whole mesh-kind GLTF/OBJ/FBX
// import can contain many meshes, unlike an IFC import where each mesh is
// captured individually as it's created in ifcModel.ts's own loadIfcModel).
export function captureOriginalGeometryRecursive(object: THREE.Object3D) {
  object.traverse(child => { if (child instanceof THREE.Mesh) captureOriginalGeometry(child) })
}

export function getOriginalGeometry(mesh: THREE.Mesh): THREE.BufferGeometry {
  return (mesh.userData.originalGeometry as THREE.BufferGeometry | undefined) ?? mesh.geometry
}

// Disposes every BufferGeometry this mesh might be holding onto, not just
// whichever one is currently assigned to mesh.geometry (2026-07-11) — once
// displacement+subdivision can swap mesh.geometry to a generated copy
// (Viewport3D.tsx's own ModelObjects effect), a plain `mesh.geometry.dispose()`
// on unload would free whichever one happens to be active at that moment
// and silently leak the other one (the original, if currently showing
// subdivided; the subdivided copy, if currently showing original) — this
// disposes whichever of {current, captured original, cached subdivided}
// actually exist, each only once even if the same object appears under more
// than one of those roles (e.g. no subdivision was ever applied, so
// `current` and `original` are literally the same object).
export function disposeMeshGeometries(mesh: THREE.Mesh) {
  const candidates = [mesh.geometry, mesh.userData.originalGeometry, mesh.userData.subdividedGeometry] as (THREE.BufferGeometry | undefined)[]
  const disposed = new Set<THREE.BufferGeometry>()
  for (const geometry of candidates) {
    if (geometry && !disposed.has(geometry)) {
      geometry.dispose()
      disposed.add(geometry)
    }
  }
}

// Same "dispose every stand-in, not just whatever's currently displayed"
// reasoning as disposeMeshGeometries above, for materials this time
// (2026-07-11, per Maro comparing this app's render modes against
// Synchro/Blender's own) — once a render mode can swap mesh.material to a
// Gouraud/Hidden Line stand-in (renderModeMaterials.ts), disposing only
// whatever mesh.material happens to be at unload time would leak the real
// underlying PBR material (mesh.userData.standardMaterial, if a stand-in is
// currently showing instead). Deduplicated the same way
// disposeMeshGeometries is, since in most render modes (Wireframe/Flat/
// Rendered) mesh.material *is* the standard material — the exact same
// object, not a separate one to double-dispose.
//
// disposeTextures mirrors each call site's own pre-existing convention
// (not a new choice introduced here): import3d.ts's own disposeObject3D
// already swept every Texture off a material before disposing it (a plain
// GLTF/OBJ/FBX mesh's material can carry its own embedded textures);
// ifcModel.ts's disposeIfcModel never did, since a fresh IFC import's own
// material never carries a texture at all — only a customTextures override
// can add one, and those are tracked/disposed independently
// (FourD.tsx's own disposeCustomTextureSet). A render-mode variant never
// owns a *separate* texture of its own either way (getGouraudVariant only
// ever assigns the same Texture references the standard material already
// uses, never clones one) — so sweeping textures off it here would just be
// a harmless no-op re-dispose of something already covered by sweeping the
// standard material, not a second real texture.
export function disposeMeshMaterials(mesh: THREE.Mesh, disposeTextures: boolean) {
  const standard = mesh.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined
  const standardList = standard ? (Array.isArray(standard) ? standard : [standard]) : []
  const currentDisplay = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const variants: THREE.Material[] = []
  for (const mat of standardList) {
    for (const key of ['lambertVariant', 'hiddenLineVariant']) {
      const variant = mat.userData[key] as THREE.Material | undefined
      if (variant) variants.push(variant)
    }
  }

  const disposed = new Set<THREE.Material>()
  for (const mat of [...currentDisplay, ...standardList, ...variants]) {
    if (!mat || disposed.has(mat)) continue
    disposed.add(mat)
    if (disposeTextures) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
    }
    mat.dispose()
  }
}
