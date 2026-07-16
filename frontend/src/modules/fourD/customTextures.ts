import * as THREE from 'three'

// aoMap/displacementMap (2026-07-11, per Maro) — both sample the exact same
// primary UV set ('uv', not a separate 'uv2') as every other slot here, at
// zero extra cost: three.js's Texture.channel defaults to 0, and channel 0
// is 'uv' (verified directly in three.js's own WebGLPrograms.js
// getChannel()/HAS_AOMAP wiring, not assumed) — aoMap has historically
// needed a dedicated second UV set in many other engines/versions, but this
// installed three.js (0.169) doesn't require one. displacementMap actually
// moves vertices along their normal by the map's own luminance
// (displacementScale, default 1) — genuinely limited on IFC geometry, which
// is typically a handful of vertices per flat face (a simple box/plane) with
// nothing to subdivide, so there's little for it to visibly displace beyond
// nudging those few existing corners; still wired through for GLTF/OBJ/FBX
// imports or any denser IFC mesh where it does have vertices to move.
export type TextureSlot = 'map' | 'metalnessMap' | 'roughnessMap' | 'normalMap' | 'aoMap' | 'displacementMap'

export interface TextureSlotValue {
  texture: THREE.Texture
  name: string
  // The image's own bytes, re-readable as a data: URI (2026-07-09, per
  // Maro's material preset library request: "I can then save this as a
  // preset") — kept alongside the live `texture` (rather than derived from
  // it later via a canvas re-encode, which needs the image already
  // decoded/same-origin and is lossy for anything not already PNG/lossless)
  // so "save whatever's currently applied as a new preset" can just reuse
  // this directly, matching materialPresets.ts's own MaterialPresetSlot
  // shape exactly.
  dataUri: string
}

export type CustomTextureSet = Partial<Record<TextureSlot, TextureSlotValue>>

const loader = new THREE.TextureLoader()

// colorSpace matters here: `map` (base colour) is a colour image and needs
// THREE.SRGBColorSpace (matching how GLTFLoader itself assigns
// baseColorTexture — see GLTFLoader.js's own assignTexture call), while
// metalness/roughness/normal maps are data, not colour, and must stay
// THREE.NoColorSpace — treating them as sRGB would silently skew the
// values they encode.
function colorSpaceForSlot(slot: TextureSlot): THREE.ColorSpace {
  return slot === 'map' ? THREE.SRGBColorSpace : THREE.NoColorSpace
}

// A File the user just picked, read into memory as a data: URI — FileReader
// rather than URL.createObjectURL, since this needs to actually *persist*
// past this browser tab (a material preset upload, or this module's own
// loadCustomTexture below, which keeps the data: URI alongside the live
// texture for exactly that reason).
export function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// Per-model manual texture override (2026-07-11, per Maro: "if I cant get
// this natively, allow me to import textures per model. base, metal,
// roughness, normal") — a fallback for when a GLTF/OBJ/FBX's own embedded
// material doesn't come through as expected. Applies uniformly across the
// whole imported object's meshes, not per-submesh — same whole-object scope
// as TransformPanel.tsx and MeshDataPanel.tsx's own unload/visibility list,
// for the same reason: a plain 3D import has no reliable stable
// sub-element identity to target more precisely than "the whole thing".
export async function loadCustomTexture(file: File, slot: TextureSlot): Promise<TextureSlotValue> {
  const [texture, dataUri] = await Promise.all([loadTextureFromFile(file, slot), fileToDataUri(file)])
  return { texture, name: file.name, dataUri }
}

// Repeats the image across the surface instead of three.js's own default
// (ClampToEdgeWrapping — one edge pixel smeared across everything past the
// texture's own 0–1 UV range) — 2026-07-11, same "flat, detail-less" report
// as ifcModel.ts's own box-projected-UV fix. This alone doesn't help IFC
// geometry (which had no UV attribute to wrap against at all until that
// fix), but a GLTF/OBJ/FBX import already carries its own real UVs from
// its authoring tool, and any surface larger than the texture's own 0–1 UV
// span was stretching/smearing rather than tiling even for those, before
// this.
// wrapMode: see this function's own original header. center: three.js
// rotates a texture around its own (0,0) — the tile's corner — by default,
// which reads as the whole tile swinging/sliding off-surface rather than
// spinning in place; centering the pivot at (0.5, 0.5) first makes
// TextureFields.tsx's own Tile Rotation field behave the way "rotate this
// tile" actually implies (2026-07-11, per Maro: "also add Tile rotation").
function applyTilingDefaults(texture: THREE.Texture) {
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.center.set(0.5, 0.5)
}

async function loadTextureFromFile(file: File, slot: TextureSlot): Promise<THREE.Texture> {
  const url = URL.createObjectURL(file)
  try {
    const texture = await loader.loadAsync(url)
    texture.colorSpace = colorSpaceForSlot(slot)
    applyTilingDefaults(texture)
    return texture
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Same loader, but from a data: URI already in memory rather than a fresh
// File — used when a texture set is seeded from something already decoded
// client-side (a File just picked, or a Blob converted below), without
// going through URL.createObjectURL/revokeObjectURL at all (nothing to
// revoke — a data: URI isn't a Blob handle).
export async function loadTextureFromDataUri(dataUri: string, slot: TextureSlot, name: string): Promise<TextureSlotValue> {
  const texture = await loader.loadAsync(dataUri)
  texture.colorSpace = colorSpaceForSlot(slot)
  applyTilingDefaults(texture)
  return { texture, name, dataUri }
}

// A Blob already in memory rather than a fresh File — materialPresets.ts's
// own loadPresetAsTextureSet uses this to turn a saved preset's texture
// (fetched from its own real-file download endpoint, 2026-07-13 fix — see
// material_preset_texture.py's own header) back into a live THREE.Texture,
// same TextureSlotValue shape as loadCustomTexture/loadTextureFromDataUri.
// Reads the Blob into a data: URI first (FileReader works on any Blob, not
// just a File) so dataUri stays populated uniformly regardless of source —
// linkedMaterials.ts's own override-equality check and "Save Current as
// Preset" both already depend on every TextureSlotValue carrying one.
export async function loadTextureFromBlob(blob: Blob, slot: TextureSlot, name: string): Promise<TextureSlotValue> {
  const dataUri = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read texture'))
    reader.readAsDataURL(blob)
  })
  return loadTextureFromDataUri(dataUri, slot, name)
}

export function disposeCustomTextureSet(set: CustomTextureSet) {
  for (const value of Object.values(set)) {
    value?.texture.dispose()
  }
}
