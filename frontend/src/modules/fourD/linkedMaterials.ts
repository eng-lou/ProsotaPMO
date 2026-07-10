import * as THREE from 'three'
import type { CustomTextureSet, TextureSlot } from './customTextures'
import { getOriginalMaterialSlots } from './elementBaseline'
import type { IfcModelHandle } from './ifcModel'

// "Select Linked" / "Apply to Linked" — per material channel (2026-07-09,
// per Maro: "select an element for example and select its material, then a
// button called Select Linked (material), which then selects all the
// elements with that material... apply to linked... this should obviously
// be channel specific"). Scoped to one IFC model's own sub-elements —
// mesh-kind imports (GLTF/OBJ/FBX) have no per-sub-element identity to
// select/apply to individually at all (same v1 scope as ElementKeyframe and
// per-element texture overrides themselves).
//
// "Linked" is defined per element, per channel, as one of three states:
// - an active *override* for that channel (map/metalnessMap/roughnessMap/
//   normalMap) — compared by the underlying image's own data: URI, not
//   object identity, so two elements independently given the exact same
//   uploaded file (or both touched by an earlier Apply to Linked batch,
//   which literally shares one Texture instance across all of them) are
//   both correctly detected as linked either way.
// - no override, but a real *original* value for that channel — for IFC
//   specifically this only ever applies to 'map' (base colour), compared
//   by the element's own imported RGB colour (ifcModel.ts never assigns any
//   of the four texture slots on import, only a flat colour per element).
// - neither — "no material set for this channel," which itself is a valid
//   (if unglamorous) thing to be linked on: every element with no metalness
//   map at all is, in a real sense, using the same default.
type ChannelValue =
  | { kind: 'override'; dataUri: string }
  | { kind: 'original-color'; hex: string }
  | { kind: 'none' }

function resolveChannelValue(
  mesh: THREE.Mesh, slot: TextureSlot, objectId: string, customTextures: Record<string, CustomTextureSet>,
): ChannelValue {
  const expressID = mesh.userData.expressID as number | undefined
  const elementKey = expressID !== undefined ? `${objectId}::${expressID}` : null
  const override = (elementKey ? customTextures[elementKey]?.[slot] : undefined) ?? customTextures[objectId]?.[slot]
  if (override) return { kind: 'override', dataUri: override.dataUri }

  if (slot === 'map') {
    const color = getOriginalMaterialSlots(mesh)[0]?.color
    if (color) return { kind: 'original-color', hex: `#${color.getHexString()}` }
  }
  return { kind: 'none' }
}

function channelValuesMatch(a: ChannelValue, b: ChannelValue): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'override' && b.kind === 'override') return a.dataUri === b.dataUri
  if (a.kind === 'original-color' && b.kind === 'original-color') return a.hex === b.hex
  return true // both 'none'
}

// Every expressID (within this one IFC model) sharing the reference
// element's current value for exactly this one channel.
export function findLinkedExpressIds(
  ifcHandle: IfcModelHandle, objectId: string, slot: TextureSlot, referenceExpressId: number,
  customTextures: Record<string, CustomTextureSet>,
): number[] {
  let referenceMesh: THREE.Mesh | null = null
  ifcHandle.object.traverse(child => {
    if (!referenceMesh && child instanceof THREE.Mesh && child.userData.expressID === referenceExpressId) referenceMesh = child
  })
  if (!referenceMesh) return []
  const referenceValue = resolveChannelValue(referenceMesh, slot, objectId, customTextures)

  const matches: number[] = []
  ifcHandle.object.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.expressID === undefined) return
    if (channelValuesMatch(referenceValue, resolveChannelValue(child, slot, objectId, customTextures))) {
      matches.push(child.userData.expressID as number)
    }
  })
  return matches
}
