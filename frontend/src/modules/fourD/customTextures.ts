import * as THREE from 'three'

export type TextureSlot = 'map' | 'metalnessMap' | 'roughnessMap' | 'normalMap'

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

async function loadTextureFromFile(file: File, slot: TextureSlot): Promise<THREE.Texture> {
  const url = URL.createObjectURL(file)
  try {
    const texture = await loader.loadAsync(url)
    texture.colorSpace = colorSpaceForSlot(slot)
    return texture
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Same loader, but from a data: URI already in memory rather than a fresh
// File — materialPresets.ts's own loadPresetAsTextureSet uses this to turn
// a saved preset's stored image back into a live THREE.Texture, without
// going through URL.createObjectURL/revokeObjectURL at all (nothing to
// revoke — a data: URI isn't a Blob handle).
export async function loadTextureFromDataUri(dataUri: string, slot: TextureSlot, name: string): Promise<TextureSlotValue> {
  const texture = await loader.loadAsync(dataUri)
  texture.colorSpace = colorSpaceForSlot(slot)
  return { texture, name, dataUri }
}

export function disposeCustomTextureSet(set: CustomTextureSet) {
  for (const value of Object.values(set)) {
    value?.texture.dispose()
  }
}
