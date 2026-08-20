import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { captureBaseline, captureOriginalGeometryRecursive, captureOriginalMaterialsRecursive, disposeMeshGeometries, disposeMeshMaterials } from './elementBaseline'

// Shared post-load pipeline (2026-08-20, factored out of loadModel3DFile so
// loadTexturedObj below — a second, genuinely different loading path for
// multi-file OBJ+MTL+texture sets, see that function's own header — gets
// the exact same treatment rather than a second, drifting copy of it).
// FBX/OBJ load as a classic (Phong/Lambert/Basic) material, never
// THREE.MeshStandardMaterial — see convertMeshesToStandardMaterial's own
// header just below for why that's a real problem in this specifically
// PBR-lit app, and why it has to happen *before* the capture calls right
// after this.
function finalizeImportedObject(object: THREE.Object3D): THREE.Object3D {
  convertMeshesToStandardMaterial(object)
  // Whatever root-level position/rotation/scale the file itself carries
  // (usually identity, but not always) — captured here so TransformPanel.tsx's
  // hover-Backspace reset snaps back to that instead of a hardcoded 0/1
  // (2026-07-09, per Maro — see elementBaseline.ts's own header).
  captureBaseline(object)
  // Every mesh's own original material, not just the root's — a mesh-kind
  // import can contain many meshes with independent materials, unlike an
  // IFC group's own per-mesh capture at creation time — so clearing a
  // texture override later actually restores what the file itself carried
  // (2026-07-09, per Maro: "when i change the material and delete the
  // material, it doesn't actually go back to the default").
  captureOriginalMaterialsRecursive(object)
  // 2026-07-11, per Maro — see geometrySubdivision.ts's own header: same
  // reasoning as captureOriginalMaterialsRecursive just above, recursive
  // for the same reason (a mesh-kind import can contain many meshes).
  captureOriginalGeometryRecursive(object)
  return object
}

// "Import 3D" (2026-07-10, per Maro) — GLTF/GLB, OBJ, FBX via three.js's own
// mature, stable loaders (already available through the `three` package
// installed last session) — no new dependency, unlike IFC (see ifcModel.ts).
export async function loadModel3DFile(file: File): Promise<THREE.Object3D> {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const buffer = await file.arrayBuffer()
  const object = await parseModel3DFile(ext, buffer)
  return finalizeImportedObject(object)
}

// Reality Captures (2026-08-20, per Maro — a real Matterport MatterPak
// export inspected directly: an .obj + matching .mtl + ~60 .jpg texture
// tiles, no relative paths, filenames matched exactly between the two) —
// loadModel3DFile's own plain `new OBJLoader().parse(text)` never touches
// materials/textures at all (confirmed: no MTLLoader anywhere in this
// codebase before this), so a MatterPak .obj imported through it would
// render as flat, untextured geometry — the one thing that actually makes
// a reality capture worth comparing against the model.
//
// Standard technique for loading a multi-file OBJ set with no real
// filesystem underneath it (the canonical drag-and-drop-a-folder pattern
// three.js's own examples use): a THREE.LoadingManager whose
// setURLModifier intercepts every texture request MTLLoader/OBJLoader make
// and redirects it to URL.createObjectURL() of the matching selected File,
// matched by filename alone (matching resolveURL's own behaviour of
// appending the .mtl's declared basePath, which is '' here since these are
// blobs, not real relative paths — matching by basename is robust to
// however exactly that ends up formatted).
export async function loadTexturedObj(objFile: File, mtlFile: File, textureFiles: File[]): Promise<THREE.Object3D> {
  const objectUrls: string[] = []
  const manager = new THREE.LoadingManager()
  const blobUrlByName = new Map<string, string>()
  for (const file of textureFiles) {
    const url = URL.createObjectURL(file)
    objectUrls.push(url)
    blobUrlByName.set(file.name, url)
  }
  manager.setURLModifier(url => {
    const name = url.split('/').pop() ?? url
    return blobUrlByName.get(name) ?? url
  })

  try {
    const mtlText = await mtlFile.text()
    const mtlLoader = new MTLLoader(manager)
    const materials = mtlLoader.parse(mtlText, '')
    materials.preload()

    const objText = await objFile.text()
    const objLoader = new OBJLoader(manager)
    objLoader.setMaterials(materials)
    const object = objLoader.parse(objText)

    return finalizeImportedObject(object)
  } finally {
    // Textures have finished uploading to the GPU synchronously as part of
    // materials.preload()/the parse above (three.js's TextureLoader reads
    // the blob eagerly) — safe to revoke immediately after, same as the
    // browser's own recommended pattern for object URLs used once.
    objectUrls.forEach(url => URL.revokeObjectURL(url))
  }
}

// FBX's own ShadingModel (confirmed directly against man.fbx's binary
// data, not assumed: `FbxSurfacePhong`/`ShadingModel: "Phong"`) maps
// FBXLoader.js's own createMaterial straight to `new MeshPhongMaterial()` —
// OBJLoader falls back the same way with no .mtl. Never
// THREE.MeshStandardMaterial, unlike GLTF (glTF's material model IS PBR
// metallic-roughness by spec, so GLTFLoader already returns a real
// MeshStandardMaterial/MeshPhysicalMaterial — nothing to convert there).
// This app's own render/lighting pipeline is PBR throughout, though
// (renderModeMaterials.ts's Wireframe/Flat/Rendered(PBR) modes,
// elementBatching.ts's/ifcModel.ts's own always-MeshStandardMaterial
// convention, TextureFields.tsx's metalnessMap/roughnessMap slots) — a
// classic material left as-is doesn't receive scene.environment's HDR
// image-based lighting at all (a real three.js limitation: only Standard/
// Physical auto-consume it), so next to everything else in the same scene
// it renders visibly under-lit/dull, and any metalness/roughness map
// applied to it later would be completely inert (2026-07-23, per Maro: "in
// flat and rendered pbr, the textures aren't quite correct showing black"
// on an FBX import — Gouraud Shaded looked fine only because
// getGouraudVariant, renderModeMaterials.ts, builds its own always-
// MeshLambertMaterial stand-in straight from map/color, never touching
// the underlying classic material's own broken lighting response at all).
// Converted once, right after load, before loadModel3DFile's own
// captureBaseline/captureOriginalMaterialsRecursive below snapshot it — so
// "the original" a texture-override Reset restores to is already this
// real Standard material, not the classic one nothing else in the app
// expects (elementBaseline.ts's own snapshotMaterial has a silent
// non-MeshStandardMaterial fallback — {map: null, color: white,
// metalness: 1, roughness: 1} — that would otherwise still discard this
// same file's own real texture/colour the moment anything reads "the
// original" back, a second, separate symptom of the identical root cause).
function toStandardMaterial(mat: THREE.Material): THREE.MeshStandardMaterial {
  if (mat instanceof THREE.MeshStandardMaterial) return mat
  const legacy = mat as THREE.Material & {
    color?: THREE.Color
    map?: THREE.Texture | null
    normalMap?: THREE.Texture | null
    aoMap?: THREE.Texture | null
    aoMapIntensity?: number
    emissive?: THREE.Color
    emissiveMap?: THREE.Texture | null
    emissiveIntensity?: number
    alphaTest?: number
  }
  const std = new THREE.MeshStandardMaterial({
    name: mat.name,
    color: legacy.color?.clone() ?? new THREE.Color(0xffffff),
    map: legacy.map ?? null,
    normalMap: legacy.normalMap ?? null,
    aoMap: legacy.aoMap ?? null,
    aoMapIntensity: legacy.aoMapIntensity ?? 1,
    emissive: legacy.emissive?.clone() ?? new THREE.Color(0x000000),
    emissiveMap: legacy.emissiveMap ?? null,
    emissiveIntensity: legacy.emissiveIntensity ?? 1,
    transparent: mat.transparent,
    opacity: mat.opacity,
    side: mat.side,
    alphaTest: legacy.alphaTest ?? 0,
    // Non-metal, moderately rough default (2026-07-23) — a safe stand-in
    // for the cloth/skin/plastic these files are actually made of, not a
    // guess at any real authored value (classic Phong's specular/shininess
    // has no metalness/roughness equivalent to convert). An authored
    // metalnessMap/roughnessMap (TextureFields.tsx) overrides this the
    // same way it already does for every other material kind.
    metalness: 0,
    roughness: 0.8,
  })
  // The texture references above were moved onto `std`, not cloned — only
  // the classic material's own (now-unused) shell gets freed here.
  mat.dispose()
  return std
}

function convertMeshesToStandardMaterial(object: THREE.Object3D) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    child.material = Array.isArray(child.material)
      ? child.material.map(toStandardMaterial)
      : toStandardMaterial(child.material)
  })
}

async function parseModel3DFile(ext: string | undefined, buffer: ArrayBuffer): Promise<THREE.Object3D> {
  if (ext === 'glb' || ext === 'gltf') {
    const loader = new GLTFLoader()
    const gltf = await loader.parseAsync(buffer, '')
    // gltf.animations (2026-07-23) lives alongside gltf.scene, not on it —
    // GLTFLoader's own return shape, unlike FBXLoader which already sets
    // `.animations` directly on the object it hands back. Copied across so
    // callers reading `object.animations` (ImportModelDialog.tsx's
    // "Include animation" checkbox, Viewport3D.tsx's mixer playback) see a
    // GLTF's embedded clips the same way they already see an FBX's.
    gltf.scene.animations = gltf.animations
    return gltf.scene
  }
  if (ext === 'obj') {
    const loader = new OBJLoader()
    const text = new TextDecoder().decode(buffer)
    return loader.parse(text)
  }
  if (ext === 'fbx') {
    const loader = new FBXLoader()
    return loader.parse(buffer, '')
  }
  throw new Error(`Unsupported 3D file type: .${ext ?? '?'} — supported: .glb, .gltf, .obj, .fbx`)
}

// Frees GPU-side geometry/material/texture memory for an unloaded "Import
// 3D" object — mirrors ifcModel.ts's disposeIfcModel, minus the WASM model
// close (plain meshes have no IfcAPI handle to release).
export function disposeObject3D(object: THREE.Object3D) {
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    disposeMeshGeometries(child)
    disposeMeshMaterials(child, true)
  })
}
