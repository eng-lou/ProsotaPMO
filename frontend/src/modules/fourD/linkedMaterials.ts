import * as THREE from 'three'
import type { CustomTextureSet, TextureSlot } from './customTextures'
import { getOriginalMaterialSlots } from './elementBaseline'
import type { BatchState } from './elementBatching'
import { ensureMaterialized } from './elementBatching'
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

function overrideValue(
  objectId: string, expressID: number, slot: TextureSlot, customTextures: Record<string, CustomTextureSet>,
): ChannelValue | null {
  const elementKey = `${objectId}::${expressID}`
  const override = customTextures[elementKey]?.[slot] ?? customTextures[objectId]?.[slot]
  return override ? { kind: 'override', dataUri: override.dataUri } : null
}

function resolveChannelValue(
  mesh: THREE.Mesh, slot: TextureSlot, objectId: string, customTextures: Record<string, CustomTextureSet>,
): ChannelValue {
  const expressID = mesh.userData.expressID as number | undefined
  const overridden = expressID !== undefined ? overrideValue(objectId, expressID, slot, customTextures) : null
  if (overridden) return overridden

  if (slot === 'map') {
    const color = getOriginalMaterialSlots(mesh)[0]?.color
    if (color) return { kind: 'original-color', hex: `#${color.getHexString()}` }
  }
  return { kind: 'none' }
}

// Same channel-value read as resolveChannelValue above, but for an
// expressID that's still sitting in the shared BatchedMesh, never pulled
// out into a real Mesh (2026-08-24 perf fix, per Maro: "changing the
// textures makes the viewport laggy while orbiting" — traced to Select
// Linked/Apply to Linked calling materializeAll to scan the *entire* model
// for matches, permanently exploding draw-call count from one shared
// BatchedMesh to one real Mesh + material per element, model-wide, for
// every single use of either button. A batched instance's own original
// colour already sits right on its BatchInstanceInfo (elementBatching.ts's
// own byExpressId, captured at import time — the exact value
// captureOriginalMaterial would record had this element already been
// materialized), so comparing it never actually needs the instance pulled
// out of the batch first.
function resolveBatchedChannelValue(
  color: THREE.Color, expressID: number, slot: TextureSlot, objectId: string, customTextures: Record<string, CustomTextureSet>,
): ChannelValue {
  const overridden = overrideValue(objectId, expressID, slot, customTextures)
  if (overridden) return overridden
  if (slot === 'map') return { kind: 'original-color', hex: `#${color.getHexString()}` }
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
//
// Scans still-batched elements straight off BatchState.byExpressId and
// already-materialized ones via a plain traverse — no materializeAll call
// (2026-08-24 perf fix, per Maro: "changing the textures makes the viewport
// laggy while orbiting" — see resolveBatchedChannelValue's own header for
// the full "why" this used to model-wide-materialize just to search).
// referenceExpressId itself is virtually always already a real mesh by the
// time this runs (FourD.tsx's own click-select flow always
// ensureMaterialized's whatever gets clicked), but falls back to reading it
// straight off the batch too rather than assuming that invariant.
export function findLinkedExpressIds(
  ifcHandle: IfcModelHandle, objectId: string, slot: TextureSlot, referenceExpressId: number,
  customTextures: Record<string, CustomTextureSet>,
): number[] {
  const batch = ifcHandle.object.userData.batch as BatchState | undefined
  const referenceBatchInfo = batch?.byExpressId.get(referenceExpressId)?.[0]
  const referenceMesh = referenceBatchInfo ? null : ensureMaterialized(ifcHandle.object, referenceExpressId)
  if (!referenceBatchInfo && !referenceMesh) return []
  const referenceValue = referenceBatchInfo
    ? resolveBatchedChannelValue(referenceBatchInfo.color, referenceExpressId, slot, objectId, customTextures)
    : resolveChannelValue(referenceMesh!, slot, objectId, customTextures)

  const matches: number[] = []
  if (batch) {
    for (const [expressID, infos] of batch.byExpressId) {
      const info = infos[0]
      if (!info) continue
      if (channelValuesMatch(referenceValue, resolveBatchedChannelValue(info.color, expressID, slot, objectId, customTextures))) {
        matches.push(expressID)
      }
    }
  }
  // Already-materialized elements — a plain traverse only ever reaches real,
  // individual meshes; BatchedMesh's own instances (scanned above) aren't
  // real scene children it could walk into.
  ifcHandle.object.traverse(child => {
    if (!(child instanceof THREE.Mesh) || child.userData.expressID === undefined) return
    if (channelValuesMatch(referenceValue, resolveChannelValue(child, slot, objectId, customTextures))) {
      matches.push(child.userData.expressID as number)
    }
  })
  return matches
}
