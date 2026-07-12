import * as THREE from 'three'

// A safe, hand-written clone for the Baseline Viewport pane (2026-07-12,
// per Maro's "advanced 4D" baseline-vs-actual compare request) — a
// THREE.Object3D can only ever belong to one scene graph, so showing the
// same imported model in a second <Canvas> needs a second copy of the
// hierarchy. Deliberately NOT `Object3D.clone()`: three.js's own
// `Object3D.copy()` does `this.userData = JSON.parse(JSON.stringify(source.userData))`,
// and by the time a mesh has been on screen for even a moment,
// Viewport3D.tsx's own ModelObjects has already attached real, non-JSON-
// serializable object references onto `userData` (`standardMaterial`,
// `subdividedGeometry`, `edgesHelper` — actual Material/BufferGeometry/
// Object3D instances) — JSON.stringify on those throws on a circular
// reference, or silently produces garbage. This walks the hierarchy by
// hand instead, copying only what the baseline pane actually needs:
// transform, and — for a Mesh — `.geometry`/`.material` copied *by
// reference* (three.js already supports one BufferGeometry/Material being
// referenced by meshes in different scenes; this is exactly what makes
// cloning cheap — no GPU buffers are duplicated, only the lightweight
// scene-graph nodes are) plus the one genuinely safe, plain-number
// userData key (`expressID`) IFC per-element features need.
//
// A Mesh's *real* PBR material — `userData.standardMaterial` if the
// primary viewport has already captured it (see ModelObjects' own header
// on why that capture exists), else `.material` itself if it hasn't run
// yet — not whatever render-mode stand-in (Gouraud/Phong/Hidden Line)
// might currently be swapped onto `.material`. The baseline pane always
// shows real PBR shading; it doesn't mirror the primary viewport's own
// render-mode setting.
export function cloneSceneHierarchy(object: THREE.Object3D): THREE.Object3D {
  const clone: THREE.Object3D = object instanceof THREE.Mesh
    ? new THREE.Mesh(object.geometry, (object.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined) ?? object.material)
    : new THREE.Group()

  clone.name = object.name
  clone.position.copy(object.position)
  clone.rotation.copy(object.rotation)
  clone.scale.copy(object.scale)
  clone.visible = object.visible
  if (object.userData.expressID !== undefined) clone.userData.expressID = object.userData.expressID

  for (const child of object.children) clone.add(cloneSceneHierarchy(child))
  return clone
}
