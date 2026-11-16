import * as THREE from 'three'
import type { SiteItem } from './siteScene'
import { createRealisticModelInfo, classIndexForKey, opacityForKey, colourOverrideForKey, getRealisticVariant, textureSettingsForKey, type RealisticMaterialMap } from './realisticMaterials'

// Keys are scoped to an immutable import, so unrelated Material.001 slots do not collide.
export function siteMaterialSlots(object: THREE.Object3D, assetId: string) {
  const slots = new Map<THREE.Material, string>()
  object.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!slots.has(mat)) slots.set(mat, `site|${assetId}|${Number.isInteger(mat.userData.prosotaAssetSlot)?mat.userData.prosotaAssetSlot:slots.size}`)
    }
  })
  return slots
}
export function siteMaterialInfo(object: THREE.Object3D, assetId: string) {
  const info = createRealisticModelInfo()
  for (const [mat,key] of siteMaterialSlots(object,assetId)) {
    if (!(mat instanceof THREE.MeshStandardMaterial)) continue
    info.entries.set(key,{key,label:mat.name || 'Unnamed material',detail:'Library asset material',sourceOpacity:mat.opacity,autoClass:null,candidates:[],count:1})
  }
  return info
}
export function applySiteSurfaceOpacity(source: THREE.MeshStandardMaterial, key: string, mapping: RealisticMaterialMap, overall = 1) {
  const original = source.userData.siteOpacitySource ??= { opacity:source.opacity, blend:source.transparent, depthWrite:source.depthWrite }
  source.opacity = (opacityForKey(key, mapping) ?? original.opacity) * overall
  source.transparent = source.opacity < 1 || (original.blend && original.opacity === 1)
  source.depthWrite = source.opacity >= 1 && original.depthWrite
  source.visible = source.opacity > 0
  source.userData.siteSurfaceState = { opacity: source.opacity, transparent: source.transparent, depthWrite: source.depthWrite, visible: source.visible }
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
  variant.userData.siteSurfaceState = source.userData.siteSurfaceState
  return variant
}

// Built-in shapes have no GLB material table. Give each object's authored
// surfaces stable keys so mappings survive edits/reloads without affecting peers.
export function primitiveMaterialKey(id: string, slot = 'surface') { return `site-shape|${id}|${slot}` }
export function primitiveMaterialInfo(item: { id: string; name: string; kind: string; finish?: SiteItem['finish']; placement_kind?: string }) {
  const info = createRealisticModelInfo()
  const kind=item.kind === 'array' || item.kind === 'scatter' ? item.placement_kind : item.kind
  const slots = ['surface', ...(kind === 'tree' ? ['trunk'] : kind === 'cabin' ? ['windows'] : [])]
  for (const slot of slots) {
    const key = primitiveMaterialKey(item.id, slot)
    info.entries.set(key, { key, label: `${item.name} — ${slot}`, detail: 'Built-in site shape', footprint: item.kind==='shape', autoClass: item.finish && item.finish !== 'default' ? item.finish : null, candidates: [], count: 1 })
  }
  return info
}

// Explicit repair for existing array sources whose glTF lost its MASK mode.
// Use the texture alpha, never reduce the opacity of the whole leaf.
export function applySiteTextureCutout(source: THREE.MeshStandardMaterial, key: string, mapping: RealisticMaterialMap) {
  const mode = String(mapping['cutout:' + key] ?? '')
  if (!['texture', 'background'].includes(mode) || (!source.map && !source.alphaMap)) return
  if (mode === 'background' && source.map) source.map = backgroundCutout(source.map)
  source.alphaTest = 0
  source.alphaHash = true
  source.transparent = false
  source.depthWrite = true
  source.userData.prosotaCutoutThreshold = 0.5
  source.userData.siteSurfaceState = { opacity: source.opacity, transparent: false, depthWrite: true, visible: source.visible }
  source.needsUpdate = true
}

// Cache per source texture: an array shares one repaired image, not one per tree.
const cutoutTextures = new WeakMap<THREE.Texture, THREE.Texture>()
function backgroundCutout(texture: THREE.Texture): THREE.Texture {
  const cached = cutoutTextures.get(texture)
  if (cached) return cached
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!image?.width || !image?.height || typeof document === 'undefined') return texture
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return texture
  try {
    ctx.drawImage(image, 0, 0)
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    removeBorderBackground(pixels.data, canvas.width, canvas.height)
    ctx.putImageData(pixels, 0, 0)
  } catch { return texture } // Cross-origin images cannot be read safely.
  const result = texture.clone()
  result.source = new THREE.Source(canvas); result.needsUpdate = true
  cutoutTextures.set(texture, result)
  texture.addEventListener('dispose', () => { result.dispose(); cutoutTextures.delete(texture) })
  return result
}

// Only remove near-uniform colour connected to the image border. Interior leaf
// pixels remain opaque even when their colour happens to resemble the backdrop.
export function removeBorderBackground(data: Uint8ClampedArray, width: number, height: number) {
  const corners = [0, width - 1, width * (height - 1), width * height - 1]
  const colour = [0, 1, 2].map(c => corners.map(i => data[i * 4 + c]).sort((a,b) => a-b)[1])
  const visited = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let head = 0, tail = 0
  const add = (i: number) => {
    if (visited[i]) return
    visited[i] = 1
    const p = i * 4
    if (Math.max(Math.abs(data[p]-colour[0]), Math.abs(data[p+1]-colour[1]), Math.abs(data[p+2]-colour[2])) > 20) return
    queue[tail++] = i
  }
  for (let x=0;x<width;x++) { add(x); add((height-1)*width+x) }
  for (let y=0;y<height;y++) { add(y*width); add(y*width+width-1) }
  while (head < tail) {
    const i=queue[head++], x=i%width
    data[i*4+3]=0
    if(x>0)add(i-1)
    if(x<width-1)add(i+1)
    if(i>=width)add(i-width)
    if(i<width*(height-1))add(i+width)
  }
}
