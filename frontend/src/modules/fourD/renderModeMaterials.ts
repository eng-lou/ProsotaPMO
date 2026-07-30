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
export function getGouraudVariant(source: THREE.MeshStandardMaterial, forBatch = false): THREE.MeshLambertMaterial {
  let variant = source.userData.lambertVariant as THREE.MeshLambertMaterial | undefined
  if (!variant) {
    variant = new THREE.MeshLambertMaterial()
    source.userData.lambertVariant = variant
    // Only for the one shared batch material per still-batched IFC model
    // (forBatch, set by Viewport3D.tsx's own batch-material call site) —
    // see enableBatchPerInstanceAlpha's own header for why this must never
    // apply to an individual mesh's Gouraud variant too.
    if (forBatch) enableBatchPerInstanceAlpha(variant)
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
  // A real bug, caught 2026-07-15 (per Maro: a split element's slice
  // clone rendered at full, uncut height) — Section Box and split-by-level
  // clipping both work by setting `clippingPlanes` directly on a mesh's
  // *real* MeshStandardMaterial (Viewport3D.tsx / elementSplitTargets.ts),
  // but this function was never told about them: it built/re-synced a
  // separate MeshLambertMaterial `variant` object without ever copying
  // `source.clippingPlanes` onto it, so any render mode besides the
  // default 'shaded'/Wireframe/Flat Shaded (which display `source` itself,
  // not this variant) silently dropped clipping entirely, regardless of
  // whether a Section Box or split existed. Plain reference copy, not a
  // clone — clippingPlanes are already swapped wholesale (never mutated in
  // place) by both callers above, so sharing the array is safe.
  variant.clippingPlanes = source.clippingPlanes
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
export function getHiddenLineMaterial(
  source: THREE.MeshStandardMaterial, tintColor: THREE.Color, forBatch = false,
): THREE.MeshBasicMaterial {
  let variant = source.userData.hiddenLineVariant as THREE.MeshBasicMaterial | undefined
  if (!variant) {
    variant = new THREE.MeshBasicMaterial()
    source.userData.hiddenLineVariant = variant
    // See getGouraudVariant's own forBatch note just above.
    if (forBatch) enableBatchPerInstanceAlpha(variant)
  }
  variant.color.copy(tintColor)
  variant.transparent = source.transparent
  variant.opacity = source.opacity
  variant.side = source.side
  // Same clippingPlanes gap as getGouraudVariant above, same fix.
  variant.clippingPlanes = source.clippingPlanes
  return variant
}

// "Fade Unselected" (2026-07-26, second pass — per Maro: "i need per
// instance, i've selected slabs and cant see anything") — real
// PER-INSTANCE transparency for still-batched IFC content. The first pass
// only ever toggled the *whole batch's* shared material opacity, on the
// (wrong) assumption that a batch containing the current selection could
// just be exempted wholesale — but every still-batched element in this
// app shares one THREE.BatchedMesh per model (see ifcModel.ts's own "batch
// ALL geometry" header), so selecting 33 slabs among hundreds of other
// walls/windows/etc in the *same* batch left literally everything in that
// model at full opacity, selection included, exactly the "cant see
// anything" report.
//
// THREE.BatchedMesh already has a real per-instance channel that could
// carry this: its own colours texture (`_colorsTexture`, confirmed
// directly in three.js's own BatchedMesh.js — RGBAFormat/FloatType, 4
// floats per instance, initialized to 1,1,1,1). setColorAt/getColorAt
// only ever read/write the first 3 floats (`color.toArray(colorsArray,
// instanceId*4)`, itemSize 3) — the 4th (alpha) slot sits there unused,
// still at its initial 1.0, for every instance, forever. Nothing in
// three.js's own shader chunks ever samples it either: ShaderChunk/
// color_vertex.glsl.js's `vColor.xyz *= batchingColor.xyz` and
// batching_pars_vertex.glsl.js's `getBatchingColor()` both explicitly
// return/consume only `.rgb` (confirmed by reading those chunk sources
// directly, not assumed) — so writing to that 4th float alone changes
// nothing on screen without this patch.
//
// This function (called once per material, guarded below) patches the
// compiled shader via `onBeforeCompile` — three.js's own sanctioned
// extension point for exactly this, never a node_modules edit — to: (1)
// force `vertexAlphas` on, the same flag WebGLPrograms.js normally only
// sets for a real per-vertex geometry `color` attribute with itemSize 4,
// so `USE_COLOR_ALPHA` gets defined and `vColor` becomes a vec4 (without
// this, ShaderChunk/color_fragment.glsl.js's alpha multiply is compiled
// out entirely, `diffuseColor.rgb *= vColor` instead of `diffuseColor *=
// vColor`); (2) inject one extra block right after the stock
// `#include <color_vertex>` expansion (still governed by the same
// `USE_BATCHING_COLOR` define, using the same `batchingColorTexture`
// uniform and `getIndirectIndex`/gl_DrawID plumbing that chunk already
// declares — nothing new to declare, so no duplicate-uniform risk) that
// reads that same texture's own alpha channel into `vColor.a`, the one
// component the stock chunk never touches.
//
// Every element in a batch's own alpha now genuinely varies per instance
// (Viewport3D.tsx's own applyBatchSelectionColour writes it directly into
// `_colorsTexture.image.data[instanceId*4+3]`), so once ANY instance
// needs to be partially transparent the whole material has to render in
// the transparent pass for blending to apply at all — Viewport3D.tsx
// toggles `material.transparent` itself (settings.xrayUnselected &&
// hasSelection), never forced on permanently here, so a project with the
// feature off keeps the exact same opaque-pass render/sort behaviour as
// before this existed.
//
// customProgramCacheKey — three.js's own documented mechanism for exactly
// this situation (a material whose *compiled shader* now differs from
// what its other properties alone would predict) — material.uuid is
// always unique per instance, so this only ever costs one extra shader
// compile for this exact material (there are at most 3 of these across
// the whole app per loaded IFC model: the batch's real standardMaterial
// plus its Gouraud/Hidden Line variants), never risks silently sharing a
// compiled program with — or stealing one from — any other material.
//
// NOT patched here: shadow casting. Three.js auto-generates its own
// MeshDepthMaterial for shadow maps unless a mesh sets customDepthMaterial
// explicitly, and that auto-generated material has no awareness of this
// patch at all — a faded (or fully invisible) batched instance still
// casts a full, un-faded shadow. Accepted as a known, narrow cosmetic gap
// (a documented trade-off, not an overlooked one) rather than also
// building and maintaining a second, parallel shadow-depth shader patch
// for a comparatively minor visual mismatch.
export function enableBatchPerInstanceAlpha(material: THREE.Material) {
  if (material.userData.batchPerInstanceAlphaPatched) return
  material.userData.batchPerInstanceAlphaPatched = true
  material.onBeforeCompile = shader => {
    shader.vertexAlphas = true
    shader.vertexShader = shader.vertexShader.replace(
      '#include <color_vertex>',
      `#include <color_vertex>
      #ifdef USE_BATCHING_COLOR
      {
        float batchAlphaIndex = getIndirectIndex( gl_DrawID );
        int batchAlphaSize = textureSize( batchingColorTexture, 0 ).x;
        int batchAlphaJ = int( batchAlphaIndex );
        int batchAlphaX = batchAlphaJ % batchAlphaSize;
        int batchAlphaY = batchAlphaJ / batchAlphaSize;
        vColor.a = texelFetch( batchingColorTexture, ivec2( batchAlphaX, batchAlphaY ), 0 ).a;
      }
      #endif`,
    )
  }
  material.needsUpdate = true
  material.customProgramCacheKey = () => material.uuid
}

export const HIDDEN_LINE_BASE_COLOR = new THREE.Color(0xe5e7eb)

// A real bug, caught 2026-07-13 (per Maro: "variant.color.copy is not a
// function" — clicking a material preset crashed the whole viewport).
// THREE.Material.prototype.copy() — called internally by .clone() — does
// `this.userData = JSON.parse(JSON.stringify(source.userData))` (confirmed
// directly in three.js's own Material.js, not assumed). Viewport3D.tsx
// clones a mesh's standardMaterial whenever a texture override/material
// preset first applies to a specific element (a per-element material
// needs its own identity, separate from whatever's shared by every other
// element still using the file's original material) — and if that
// material's userData already held a cached lambertVariant/
// hiddenLineVariant (real THREE.Material instances, set by
// getGouraudVariant/getHiddenLineMaterial above whenever Gouraud/Hidden
// Line render mode had been used even once before), the JSON round-trip
// silently turns them into plain objects that still *look* present
// (`variant.color` exists) but aren't real Color instances anymore
// (`.copy` doesn't exist on a plain `{r,g,b}`) — exactly the same bug
// class this app already caught once for Object3D.clone() (see
// sceneClone.ts's own header), just not this specific call site. Call
// this on any material clone that might carry these keys, so
// getGouraudVariant/getHiddenLineMaterial's own `if (!variant)` check
// correctly detects "no cache yet" and builds a fresh, real one instead of
// trusting the JSON-mangled copy.
export function clearClonedRenderModeVariantCache(material: THREE.Material) {
  delete material.userData.lambertVariant
  delete material.userData.hiddenLineVariant
}
