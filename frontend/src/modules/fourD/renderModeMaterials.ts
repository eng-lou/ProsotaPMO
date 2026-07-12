import * as THREE from 'three'

// Materials for render modes that need a genuinely different lighting
// model than this app's default PBR (MeshStandardMaterial), not achievable
// via property toggles alone (2026-07-11, per Maro comparing this app's
// render modes against Synchro's own Wireframe/Hidden Line/Flat Shaded/
// Gouraud Shaded/Phong Shaded dropdown, and Blender's Cycles/Eevee/V-Ray).
// Real path tracing (Cycles/V-Ray/Iray) is deliberately out of scope —
// those simulate individual light rays over many accumulated frames, a
// fundamentally different technique from what three.js's WebGL renderer
// (or any mode here) does: rasterization, the same family Eevee and every
// one of Synchro's own listed modes belongs to. Real-time path tracing in
// a browser exists (WebGPU + a library like three-gpu-pathtracer) but is
// far too slow for interactive navigation on a model this size — it would
// only ever make sense as a "bake one still image" feature, a separate,
// later undertaking, not a viewport render mode.
//
// Both variant builders below are cached on the *source* MeshStandardMaterial's
// own userData and re-synced (not rebuilt) on every call — cheap property
// copies reusing the same Texture objects, never re-uploaded to the GPU —
// so a live selection tint or texture-override edit (Viewport3D.tsx's own
// per-frame material mutation, which always runs against the real
// MeshStandardMaterial upstream of these calls) keeps showing correctly
// regardless of which render mode is actually on screen.

// Gouraud (MeshLambertMaterial: pure per-vertex diffuse, no specular at
// all) is three.js's own real, distinct lighting model — not an
// approximation built by tweaking PBR sliders. A Phong Shaded variant
// (MeshPhongMaterial) was built the same day but dropped before shipping,
// per Maro: "leave wireframe, hidden line, flat shaded and gouraud" — one
// non-PBR lighting model already covers the gap, so the extra variant
// wasn't worth the added complexity; see viewerSettings.ts's own
// RenderMode header. Deliberately does NOT sync metalnessMap/roughnessMap:
// MeshLambertMaterial has no metallic-roughness PBR concept at all, so a
// metal/roughness map applied via TextureFields.tsx genuinely has nothing
// to affect in this mode — an honest limitation of switching lighting
// models, not a bug.
export function getGouraudVariant(source: THREE.MeshStandardMaterial): THREE.MeshLambertMaterial {
  let variant = source.userData.lambertVariant as THREE.MeshLambertMaterial | undefined
  if (!variant) {
    variant = new THREE.MeshLambertMaterial()
    source.userData.lambertVariant = variant
  }
  variant.color.copy(source.color)
  variant.map = source.map
  variant.aoMap = source.aoMap
  variant.aoMapIntensity = source.aoMapIntensity
  variant.normalMap = source.normalMap
  variant.displacementMap = source.displacementMap
  variant.displacementScale = source.displacementScale
  variant.displacementBias = source.displacementBias
  variant.emissive.copy(source.emissive)
  variant.emissiveIntensity = source.emissiveIntensity
  variant.emissiveMap = source.emissiveMap
  variant.transparent = source.transparent
  variant.opacity = source.opacity
  variant.side = source.side
  variant.wireframe = source.wireframe
  // flatShading is a shader-compile-time parameter (confirmed directly in
  // three.js's own WebGLPrograms.js, not assumed) — only flip needsUpdate
  // when it actually changes, not on every call.
  if (variant.flatShading !== source.flatShading) {
    variant.flatShading = source.flatShading
    variant.needsUpdate = true
  }
  return variant
}

// Hidden Line: a flat, unlit, neutral occluder underneath the mesh's own
// black EdgesGeometry overlay (Viewport3D.tsx's own showEdges machinery,
// forced on for this mode regardless of the separate Edges checkbox) — the
// classic CAD "technical drawing" look: line art over a plain
// depth-writing fill, not shaded/coloured geometry. `tintColor` is computed
// by the caller using the exact same selection-tint tiers/weights every
// other render mode already uses, then passed straight in — so what's
// selected stays identifiable even though non-selected elements
// deliberately don't show their real per-element colour in this mode
// (matching Synchro/Blender's own Hidden Line convention, not "Flat Shaded
// plus edges").
export function getHiddenLineMaterial(source: THREE.MeshStandardMaterial, tintColor: THREE.Color): THREE.MeshBasicMaterial {
  let variant = source.userData.hiddenLineVariant as THREE.MeshBasicMaterial | undefined
  if (!variant) {
    variant = new THREE.MeshBasicMaterial()
    source.userData.hiddenLineVariant = variant
  }
  variant.color.copy(tintColor)
  variant.transparent = source.transparent
  variant.opacity = source.opacity
  variant.side = source.side
  return variant
}

export const HIDDEN_LINE_BASE_COLOR = new THREE.Color(0xe5e7eb)
