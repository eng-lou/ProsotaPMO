import * as THREE from 'three'
import { createRealisticModelInfo, classIndexForKey, colourOverrideForKey, getRealisticVariant, textureSettingsForKey, type RealisticMaterialMap } from './realisticMaterials'

// Keys are scoped to an immutable import, so unrelated Material.001 slots do not collide.
export function siteMaterialSlots(object: THREE.Object3D, assetId: string) {
  const slots = new Map<THREE.Material, string>()
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!slots.has(mat)) slots.set(mat, `site|${assetId}|${slots.size}`)
    }
  })
  return slots
}
export function siteMaterialInfo(object: THREE.Object3D, assetId: string) {
  const info = createRealisticModelInfo()
  for (const [mat,key] of siteMaterialSlots(object,assetId)) {
    if (!(mat instanceof THREE.MeshStandardMaterial)) continue
    info.entries.set(key,{key,label:mat.name || 'Unnamed material',detail:'Library asset material',autoClass:null,candidates:[],count:1})
  }
  return info
}
export function siteMaterialLook(source: THREE.MeshStandardMaterial, key: string, mapping: RealisticMaterialMap, transmission: boolean) {
  const cls = classIndexForKey(key,undefined,mapping), tint = colourOverrideForKey(key,mapping)
  if (!cls) { if(tint)source.color.copy(tint); return source }
  const variant = getRealisticVariant(source,cls,source.color.clone(),transmission,source.opacity,tint,textureSettingsForKey(key,mapping)) as THREE.MeshStandardMaterial
  // Preserve foliage cutouts and double-sided faces when replacing a surface.
  variant.alphaMap=source.alphaMap; variant.alphaTest=source.alphaTest
  if (variant.alphaHash !== source.alphaHash) { variant.alphaHash=source.alphaHash; variant.needsUpdate=true }
  if(source.alphaTest>0 || source.alphaHash)variant.map=source.map
  variant.side=source.side
  return variant
}

// Built-in shapes have no GLB material table. Give each object's authored
// surfaces stable keys so mappings survive edits/reloads without affecting peers.
export function primitiveMaterialKey(id: string, slot = 'surface') { return `site-shape|${id}|${slot}` }
export function primitiveMaterialInfo(item: { id: string; name: string; kind: string; finish?: string; placement_kind?: string }) {
  const info = createRealisticModelInfo()
  const kind=item.placement_kind || item.kind
  const slots = ['surface', ...(kind === 'tree' ? ['trunk'] : kind === 'cabin' ? ['windows'] : [])]
  for (const slot of slots) {
    const key = primitiveMaterialKey(item.id, slot)
    info.entries.set(key, { key, label: `${item.name} — ${slot}`, detail: 'Built-in site shape', autoClass: item.finish==='water'?'water':null, candidates: [], count: 1 })
  }
  return info
}
