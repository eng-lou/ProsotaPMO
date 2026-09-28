import * as THREE from 'three'
import type { BatchInstanceInfo, BatchState } from './elementBatching'
import { BATCH_ALPHA_VERTEX_PATCH } from './renderModeMaterials'

// "Realistic Materials" render mode (2026-09-28, per Maro) — a reversible
// display layer on top of Rendered (PBR): each surface is matched to one of
// a handful of real-world material classes (concrete/render, glass, metal,
// grass/green roof, brick, timber) from its imported *names* (IFC surface
// style, IFC material association, or a GLTF/OBJ/FBX material name) — never
// from its colour — and shown with that class's roughness/metalness plus a
// generated, real-world-scaled texture and bump detail. Nothing here ever
// mutates a mesh's real material (userData.standardMaterial): every class
// look lives on a separate cached variant, same pattern as
// renderModeMaterials.ts's Gouraud/Hidden Line stand-ins, so switching back
// to any other mode just displays the real material again.
//
// Still-batched IFC content (one THREE.BatchedMesh + one material per model,
// see elementBatching.ts's own header) can't take one material per class
// without splitting the batch, so the class rides in a per-instance data
// texture instead (same idea as BatchedMesh's own per-instance colour
// texture) and one patched shader picks the class look per instance — no
// extra draw calls. The one exception is glass: it has to render in the
// transparent pass to be seen through, so glass instances are discarded from
// the opaque batch and redrawn by a second, glass-only BatchedMesh (one extra
// draw call per model, however many panes there are).

export const REALISTIC_CLASSES = ['concrete', 'glass', 'metal', 'grass', 'brick', 'timber'] as const
export type RealisticClass = typeof REALISTIC_CLASSES[number]
// 'original' — explicitly keep the imported look for this material, even
// if its name would otherwise auto-match a class.
export type RealisticMapping = RealisticClass | 'original'
export type RealisticMaterialMap = Record<string, RealisticMapping>

export const REALISTIC_CLASS_LABELS: Record<RealisticClass, string> = {
  concrete: 'Concrete / render',
  glass: 'Glass',
  metal: 'Metal',
  grass: 'Grass / green roof',
  brick: 'Brick',
  timber: 'Timber',
}

// Shader-side class index. 0 = no class (keep the imported look). The
// generated texture array's layer for a class is its index - 1.
const CLASS_INDEX: Record<RealisticClass, number> = { concrete: 1, glass: 2, metal: 3, grass: 4, brick: 5, timber: 6 }
export const GLASS_CLASS = CLASS_INDEX.glass
// Classes whose texture carries its own colour (a brick is brick-coloured
// whatever flat colour the IFC author picked), as opposed to concrete/metal,
// which keep the imported colour and only add surface detail on top. For
// these, the element's colour is replaced by white at rest, so any tint
// applied on top of it (selection, variance, clash) still shows as a tint
// of the texture rather than being lost.
const REPLACES_COLOUR = [false, false, true, false, true, true, true]
export function classReplacesColour(classIndex: number): boolean {
  return REPLACES_COLOUR[classIndex] ?? false
}

// --- Name-based classification ---------------------------------------------

const CLASS_PATTERNS: [RealisticClass, RegExp][] = [
  ['glass', /\b(glass|glazing|glazed|glazier|vision panel|verre|glas|pane)\b/],
  ['metal', /\b(steel|metal|metallic|alu|aluminium|aluminum|zinc|copper|iron|stainless|galvani[sz]ed|brass|bronze|corten|chrome|titanium)\b/],
  ['grass', /\b(grass|green roof|greenroof|sedum|vegetation|vegetated|turf|lawn|planting|planted|moss|living roof|biodiverse roof)\b/],
  ['brick', /\b(brick|bricks|brickwork)\b/],
  ['timber', /\b(timber|wood|wooden|oak|pine|spruce|larch|cedar|birch|beech|plywood|ply|osb|clt|glulam|lvl|softwood|hardwood|lumber|veneer|mdf)\b/],
  ['concrete', /\b(concrete|render|rendered|plaster|plasterboard|cement|screed|precast|in situ|insitu|stucco|blockwork|mortar|gypsum)\b/],
]
// Layers that sit inside a build-up and are never the visible face.
const CONCEALED_LAYER = /\b(stud|studs|insulation|insulated|furring|firring|batten|battens|membrane|vapour|vapor|cavity|air gap|air space|sheathing|framing)\b/
// Things that contain a class word without being that material.
const FALSE_POSITIVES = /\b(glass ?fib(re|er)|glass ?wool|fib(re|er) ?glass|mineral wool)\b/g

function normaliseName(text: string): string {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // CamelCase -> words
    .toLowerCase()
    .replace(/[_\-.,:;/\\()[\]{}+|#]+/g, ' ')
    .replace(FALSE_POSITIVES, ' ')
    .replace(/\s+/g, ' ')
}

// Every class whose keywords appear in `text`. More than one means the name
// is ambiguous ("steel-reinforced concrete", "timber-framed glazing") —
// deliberately left for manual mapping rather than guessed.
export function matchClassesInText(text: string): RealisticClass[] {
  const normalised = normaliseName(text)
  if (!normalised.trim()) return []
  return CLASS_PATTERNS.filter(([, re]) => re.test(normalised)).map(([cls]) => cls)
}

// --- Per-model material table ----------------------------------------------

export interface RealisticMaterialEntry {
  key: string
  label: string
  detail: string
  autoClass: RealisticClass | null
  // Set when more than one class matched — the "needs manual mapping" case.
  candidates: RealisticClass[]
  count: number
}

export interface RealisticModelInfo {
  entries: Map<string, RealisticMaterialEntry>
  // IFC only: `${expressID}:${ifcGeometryId}` -> entry key. One element can
  // carry several geometry pieces with different surface styles (a window's
  // frame vs its pane), so this is per piece, not per element.
  keyByPiece: Map<string, string>
  // IFC only: fallback for a mesh that no longer knows its geometry piece
  // (e.g. a split-by-level slice) — the element's first piece's key.
  keyByExpressId: Map<number, string>
}

export interface RealisticPieceDescription {
  styleName: string
  materialNames: string[]
  // Material came from an IfcMaterialLayerSet — names are in layer order.
  layered: boolean
  ifcType: string
  transparent: boolean
}

// IFC entity types whose *transparent* pieces are glazing. Transparency is a
// real IfcSurfaceStyleRendering property, not a colour guess; restricted to
// these types so a transparent-styled duct or slab never becomes glass.
const GLAZING_TYPES = new Set(['IFCWINDOW', 'IFCDOOR', 'IFCPLATE', 'IFCCURTAINWALL', 'IFCWINDOWSTANDARDCASE', 'IFCDOORSTANDARDCASE'])

export function pieceKey(p: RealisticPieceDescription): string {
  const hasNames = p.styleName !== '' || p.materialNames.length > 0
  return ['ifc', p.styleName, p.materialNames.join(' / '), hasNames ? '' : p.ifcType, p.transparent ? 'T' : ''].join('|')
}

function prettyIfcType(typeName: string): string {
  if (!typeName) return 'Element'
  const lower = typeName.toLowerCase().replace(/^ifc/, '')
  return 'Ifc' + lower.charAt(0).toUpperCase() + lower.slice(1)
}

function autoClassifyPiece(p: RealisticPieceDescription): { cls: RealisticClass | null; candidates: RealisticClass[] } {
  // Surface style first — it's per geometry piece, so it tells a window's
  // pane apart from its frame; element-level materials can't.
  if (p.styleName) {
    const found = matchClassesInText(p.styleName)
    if (found.length === 1) return { cls: found[0], candidates: [] }
    if (found.length > 1) return { cls: null, candidates: found }
  }
  if (p.materialNames.length > 0) {
    let text: string | null
    if (p.layered) {
      // A layered wall/slab is seen from its outer faces: its first layer
      // (the exterior side, as Revit/ArchiCAD export it), or — when that's a
      // concealed core layer (studs, insulation...) — its last. The full
      // layer list is shown in the mapping panel to override a wrong guess.
      const first = p.materialNames[0]
      const last = p.materialNames[p.materialNames.length - 1]
      text = !CONCEALED_LAYER.test(normaliseName(first)) ? first : !CONCEALED_LAYER.test(normaliseName(last)) ? last : null
    } else if (p.materialNames.length === 1) {
      text = p.materialNames[0]
    } else {
      // Several constituent materials (a light fitting's paint + plastic +
      // aluminium) and no style saying which one this piece is: any single
      // match would be a guess, so leave it for manual mapping.
      text = null
    }
    const found = text ? matchClassesInText(text) : []
    if (found.length === 1) return { cls: found[0], candidates: [] }
    if (found.length > 1) return { cls: null, candidates: found }
  }
  if (p.transparent && GLAZING_TYPES.has(p.ifcType)) return { cls: 'glass', candidates: [] }
  return { cls: null, candidates: [] }
}

export function createRealisticModelInfo(): RealisticModelInfo {
  return { entries: new Map(), keyByPiece: new Map(), keyByExpressId: new Map() }
}

const entryTypes = new WeakMap<RealisticMaterialEntry, { types: string[]; rest: string }>()

export function addRealisticPiece(info: RealisticModelInfo, expressID: number, ifcGeometryId: number | undefined, p: RealisticPieceDescription) {
  const key = pieceKey(p)
  let entry = info.entries.get(key)
  if (!entry) {
    const { cls, candidates } = autoClassifyPiece(p)
    const label = p.styleName || p.materialNames[0] || `${prettyIfcType(p.ifcType)} (no material)`
    const detailParts: string[] = []
    if (p.materialNames.length > 0 && (p.styleName || p.materialNames.length > 1)) {
      detailParts.push(`${p.layered ? 'Layers' : 'Material'}: ${p.materialNames.join(' / ')}`)
    }
    if (p.transparent) detailParts.push('transparent in IFC')
    entry = { key, label, detail: detailParts.join(' · '), autoClass: cls, candidates, count: 0 }
    info.entries.set(key, entry)
    entryTypes.set(entry, { types: [], rest: entry.detail })
  }
  // Every IFC type using this material, so the mapping panel shows e.g.
  // "IfcPlate, IfcWindow" rather than only whichever was met first.
  const typeInfo = entryTypes.get(entry)
  const typeName = prettyIfcType(p.ifcType)
  if (typeInfo && !typeInfo.types.includes(typeName)) {
    typeInfo.types.push(typeName)
    entry.detail = [typeInfo.types.join(', '), typeInfo.rest].filter(Boolean).join(' · ')
  }
  entry.count++
  if (ifcGeometryId !== undefined) info.keyByPiece.set(`${expressID}:${ifcGeometryId}`, key)
  if (!info.keyByExpressId.has(expressID)) info.keyByExpressId.set(expressID, key)
}

function meshMaterialKey(material: THREE.Material): string {
  return `mat|${material.name}`
}

// GLTF/OBJ/FBX imports: the only naming available is each material's own
// name. Materials that arrive with their own base-colour texture are left
// out — an authored texture is an explicit material choice, kept as-is.
export function extractMeshRealisticInfo(object: THREE.Object3D): RealisticModelInfo {
  const info = createRealisticModelInfo()
  const seen = new Set<THREE.Material>()
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return
    const source = (child.userData.standardMaterial as THREE.Material | THREE.Material[] | undefined) ?? child.material
    for (const mat of Array.isArray(source) ? source : [source]) {
      if (!(mat instanceof THREE.MeshStandardMaterial) || mat.map) continue
      const key = meshMaterialKey(mat)
      let entry = info.entries.get(key)
      if (!entry) {
        const found = matchClassesInText(mat.name)
        entry = {
          key, label: mat.name || '(unnamed material)', detail: '3D model material',
          autoClass: found.length === 1 ? found[0] : null, candidates: found.length > 1 ? found : [], count: 0,
        }
        info.entries.set(key, entry)
      }
      if (!seen.has(mat)) { seen.add(mat); entry.count++ }
    }
  })
  return info
}

// Combined, de-duplicated list for the mapping panel — the same material
// name in two loaded models is one row, mapped once.
export function mergeRealisticEntries(infos: (RealisticModelInfo | undefined)[]): RealisticMaterialEntry[] {
  const merged = new Map<string, RealisticMaterialEntry>()
  for (const info of infos) {
    if (!info) continue
    for (const entry of info.entries.values()) {
      const existing = merged.get(entry.key)
      if (existing) existing.count += entry.count
      else merged.set(entry.key, { ...entry })
    }
  }
  return [...merged.values()].sort((a, b) => b.count - a.count)
}

export function classIndexForKey(key: string | undefined, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap): number {
  if (key === undefined) return 0
  const manual = mapping[key]
  if (manual === 'original') return 0
  if (manual) return CLASS_INDEX[manual]
  const auto = info?.entries.get(key)?.autoClass
  return auto ? CLASS_INDEX[auto] : 0
}

// Class for one individual (non-batched) mesh's material.
export function classIndexForMesh(
  mesh: THREE.Mesh, material: THREE.Material, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap,
): number {
  const expressID = mesh.userData.expressID as number | undefined
  if (expressID !== undefined) {
    const geometryId = mesh.userData.ifcGeometryId as number | undefined
    const key = (geometryId !== undefined ? info?.keyByPiece.get(`${expressID}:${geometryId}`) : undefined)
      ?? info?.keyByExpressId.get(expressID)
    return classIndexForKey(key, info, mapping)
  }
  const key = meshMaterialKey(material)
  if (info) return classIndexForKey(key, info, mapping)
  // No extracted table yet — still honour a manual mapping or a clear name.
  const manual = mapping[key]
  if (manual) return manual === 'original' ? 0 : CLASS_INDEX[manual]
  const found = matchClassesInText(material.name)
  return found.length === 1 ? CLASS_INDEX[found[0]] : 0
}

const MAPPING_STORAGE_PREFIX = 'prosota_4d_realistic_material_map_'

export function loadRealisticMapping(projectId: string | undefined): RealisticMaterialMap {
  if (!projectId) return {}
  try {
    const raw = localStorage.getItem(MAPPING_STORAGE_PREFIX + projectId)
    return raw ? JSON.parse(raw) as RealisticMaterialMap : {}
  } catch {
    return {}
  }
}

export function saveRealisticMapping(projectId: string | undefined, mapping: RealisticMaterialMap) {
  if (!projectId) return
  try {
    localStorage.setItem(MAPPING_STORAGE_PREFIX + projectId, JSON.stringify(mapping))
  } catch {
    // Storage full/blocked — the mapping still applies for this session.
  }
}

// --- Generated textures -----------------------------------------------------
//
// One RGBA texture array, one layer per class (glass's layer is flat). RGB is
// either the class's own colour (sRGB, for REPLACES_COLOUR classes) or a
// neutral detail value around 0.5 (concrete/metal, multiplied into the
// imported colour); A is a height field the shader turns into bump normals.
// Generated in code rather than shipped as image files — no asset pipeline
// or network fetch, and every layer tiles seamlessly by construction. Each
// layer maps onto a fixed real-world size (TILE_METRES, below), matching
// ifcModel.ts's box-projected UVs, which are in model metres.

const TEX_SIZE = 256
const LAYER_COUNT = 6

function hash2(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 144665)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// Tileable value noise: lattice periods pu x pv across the unit square.
function valueNoise(u: number, v: number, pu: number, pv: number, seed: number): number {
  const x = u * pu
  const y = v * pv
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const xa = ((x0 % pu) + pu) % pu
  const xb = (xa + 1) % pu
  const ya = ((y0 % pv) + pv) % pv
  const yb = (ya + 1) % pv
  const a = hash2(xa, ya, seed)
  const b = hash2(xb, ya, seed)
  const c = hash2(xa, yb, seed)
  const d = hash2(xb, yb, seed)
  return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy
}

function fbm(u: number, v: number, pu: number, pv: number, octaves: number, seed: number): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(u, v, pu << o, pv << o, seed + o * 31) * amp
    norm += amp
    amp *= 0.5
  }
  return sum / norm
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
type Rgba = [number, number, number, number]
type LayerFn = (u: number, v: number) => Rgba

const concreteLayer: LayerFn = (u, v) => {
  const blotch = fbm(u, v, 3, 3, 4, 11)
  const grain = valueNoise(u, v, 160, 160, 12)
  const pit = valueNoise(u, v, 90, 90, 13) > 0.93 ? 1 : 0
  const detail = 0.5 + (blotch - 0.5) * 0.2 + (grain - 0.5) * 0.1 - pit * 0.08
  const height = 0.55 + (grain - 0.5) * 0.35 - pit * 0.35
  return [detail, detail, detail, height]
}

const glassLayer: LayerFn = () => [0.5, 0.5, 0.5, 0.5]

const metalLayer: LayerFn = (u, v) => {
  const streak = valueNoise(u, v, 6, 256, 21)
  const broad = fbm(u, v, 2, 2, 3, 22)
  const detail = 0.5 + (streak - 0.5) * 0.18 + (broad - 0.5) * 0.12
  return [detail, detail, detail, 0.5 + (streak - 0.5) * 0.25]
}

const GRASS_TONES: [number, number, number][] = [[46, 66, 28], [74, 98, 40], [104, 124, 52], [128, 120, 72]]
const grassLayer: LayerFn = (u, v) => {
  const patch = fbm(u, v, 4, 4, 4, 31)
  const blade = valueNoise(u, v, 256, 256, 32)
  const dry = fbm(u, v, 6, 6, 3, 33)
  const t = clamp01(0.5 + (patch - 0.5) * 0.9) * 2
  const i = Math.min(1, Math.floor(t))
  const f = t - i
  const lo = GRASS_TONES[i]
  const hi = GRASS_TONES[i + 1]
  let r = lo[0] + (hi[0] - lo[0]) * f
  let g = lo[1] + (hi[1] - lo[1]) * f
  let b = lo[2] + (hi[2] - lo[2]) * f
  const dryMix = clamp01((dry - 0.62) * 4)
  r += (GRASS_TONES[3][0] - r) * dryMix
  g += (GRASS_TONES[3][1] - g) * dryMix
  b += (GRASS_TONES[3][2] - b) * dryMix
  const shade = 0.72 + blade * 0.5
  return [r * shade / 255, g * shade / 255, b * shade / 255, 0.3 + blade * 0.6]
}

const BRICK_TONES: [number, number, number][] = [[150, 70, 50], [134, 60, 44], [164, 86, 60], [120, 54, 40], [156, 96, 70], [142, 66, 48]]
const brickLayer: LayerFn = (u, v) => {
  // Tile = 2 bricks x 4 courses (0.45m x 0.30m): 215x65mm bricks, 10mm joints.
  const courses = 4
  const row = Math.floor(v * courses)
  const fv = v * courses - row
  const bu = u * 2 + (row % 2 ? 0.5 : 0)
  const col = Math.floor(bu)
  const fu = bu - col
  const jointU = 10 / 225
  const jointV = 10 / 75
  const inJoint = fu < jointU || fv < jointV
  const grain = valueNoise(u, v, 128, 96, 41)
  if (inJoint) {
    const m = 0.66 + (grain - 0.5) * 0.08
    return [m, m * 0.97, m * 0.92, 0.18 + grain * 0.08]
  }
  const brickId = ((col % 2) + 2) % 2 + row * 2
  const tone = BRICK_TONES[Math.floor(hash2(brickId, 7, 42) * BRICK_TONES.length)]
  const face = 0.88 + fbm(u, v, 8, 6, 3, 43) * 0.2 + (grain - 0.5) * 0.12
  // Soft bevel so bricks read as slightly proud of the joint.
  const edge = Math.min(fu - jointU, 1 - fu, (fv - jointV) * 0.3, (1 - fv) * 0.3) * 12
  const height = 0.55 + clamp01(edge) * 0.25 + (grain - 0.5) * 0.12
  return [tone[0] * face / 255, tone[1] * face / 255, tone[2] * face / 255, height]
}

const TIMBER_TONES: [number, number, number][] = [[152, 110, 72], [170, 126, 84], [138, 98, 62], [160, 118, 78]]
const timberLayer: LayerFn = (u, v) => {
  // Tile = 4 boards (150mm each) x 1.2m, grain running horizontally.
  const boards = 4
  const board = Math.floor(v * boards)
  const fv = v * boards - board
  if (fv < 0.035) return [0.16, 0.12, 0.09, 0.1]
  const tone = TIMBER_TONES[board % TIMBER_TONES.length]
  const warp = fbm(u, v, 3, 12, 3, 51 + board)
  const grain = Math.sin((fv * 5 + warp * 4 + hash2(board, 3, 52) * 10) * Math.PI * 2) * 0.5 + 0.5
  const fine = valueNoise(u, v, 8, 256, 53)
  const shade = 0.82 + grain * 0.14 + (fine - 0.5) * 0.12
  return [tone[0] * shade / 255, tone[1] * shade / 255, tone[2] * shade / 255, 0.6 + grain * 0.08 + (fine - 0.5) * 0.06]
}

const LAYERS: LayerFn[] = [concreteLayer, glassLayer, metalLayer, grassLayer, brickLayer, timberLayer]

let textureArray: THREE.DataArrayTexture | null = null

export function getRealisticTextureArray(): THREE.DataArrayTexture {
  if (textureArray) return textureArray
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4 * LAYER_COUNT)
  for (let layer = 0; layer < LAYER_COUNT; layer++) {
    const fn = LAYERS[layer]
    const base = layer * TEX_SIZE * TEX_SIZE * 4
    for (let y = 0; y < TEX_SIZE; y++) {
      const v = (y + 0.5) / TEX_SIZE
      for (let x = 0; x < TEX_SIZE; x++) {
        const [r, g, b, a] = fn((x + 0.5) / TEX_SIZE, v)
        const i = base + (y * TEX_SIZE + x) * 4
        data[i] = Math.round(clamp01(r) * 255)
        data[i + 1] = Math.round(clamp01(g) * 255)
        data[i + 2] = Math.round(clamp01(b) * 255)
        data[i + 3] = Math.round(clamp01(a) * 255)
      }
    }
  }
  const texture = new THREE.DataArrayTexture(data, TEX_SIZE, TEX_SIZE, LAYER_COUNT)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  // Decoded in the shader per class (colour layers are sRGB, detail/height
  // aren't), so no automatic colour-space conversion here.
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  textureArray = texture
  return texture
}

// Frees the GPU copy when the mode is switched off. The CPU-side pixels are
// kept, so switching back re-uploads instead of regenerating.
export function releaseRealisticTextureArrayGpu() {
  textureArray?.dispose()
}

// --- Shader patch -------------------------------------------------------------

// Per-class look, index = class (0 = unmatched). tile: real-world size of
// one texture tile in metres (u x v); detail: how strongly concrete/metal's
// neutral detail layer modulates the imported colour; textured: the texture
// carries the colour itself.
const CLASS_PARAMS: { tile: [number, number]; roughness: number; metalness: number; bump: number; detail: number; textured: boolean }[] = [
  { tile: [1, 1], roughness: 1, metalness: 0, bump: 0, detail: 0, textured: false },
  { tile: [2.4, 2.4], roughness: 0.86, metalness: 0, bump: 0.35, detail: 1, textured: false }, // concrete / render
  { tile: [1, 1], roughness: 0.05, metalness: 0, bump: 0, detail: 0, textured: true }, // glass
  { tile: [1.5, 1.5], roughness: 0.32, metalness: 1, bump: 0.2, detail: 1, textured: false }, // metal
  { tile: [2.2, 2.2], roughness: 0.95, metalness: 0, bump: 0.9, detail: 0, textured: true }, // grass
  { tile: [0.45, 0.3], roughness: 0.88, metalness: 0, bump: 1.4, detail: 0, textured: true }, // brick
  { tile: [1.2, 0.6], roughness: 0.62, metalness: 0, bump: 0.6, detail: 0, textured: true }, // timber
]

// The table above as a 7x2 float texture, read with two texelFetches per
// vertex (2026-09-28, measured live on a 6M-triangle model: indexing GLSL
// const arrays by a non-constant class instead — per fragment, then per
// vertex — cost 2-4x the whole PBR frame on ANGLE/D3D, which lowers
// dynamically-indexed const arrays into long branch chains).
let classParamsTexture: THREE.DataTexture | null = null
function getClassParamsTexture(): THREE.DataTexture {
  if (classParamsTexture) return classParamsTexture
  const n = CLASS_PARAMS.length
  const data = new Float32Array(n * 2 * 4)
  CLASS_PARAMS.forEach((c, i) => {
    data.set([1 / c.tile[0], 1 / c.tile[1], Math.max(i - 1, 0), c.textured ? 1 : 0], i * 4)
    data.set([c.roughness, c.metalness, c.bump, c.detail], (n + i) * 4)
  })
  classParamsTexture = new THREE.DataTexture(data, n, 2, THREE.RGBAFormat, THREE.FloatType)
  classParamsTexture.needsUpdate = true
  return classParamsTexture
}

// ONE interpolated vec3 crosses to the fragment shader: xy = box-projected
// UV in metres, z = class (identical at all three vertices, so it
// interpolates to itself; rounded on read). Measured live on a
// 6M-triangle model: a separate 'flat varying int' for the class alone
// cost more than the entire rest of the plain PBR frame on ANGLE/D3D.
const VERTEX_PARS = /* glsl */`
varying vec3 vRealUvClass;
uniform float realGlassHidden;
`

const FRAGMENT_PARS = /* glsl */`
varying vec3 vRealUvClass;
uniform highp sampler2DArray realTex;
uniform highp sampler2D realParams;
`

function patchRealisticSurfaceShader(shader: THREE.WebGLProgramParametersWithUniforms, forBatch: boolean) {
  const classSource = forBatch
    ? /* glsl */`
      int vRealClass = 0;
      #ifdef USE_BATCHING
      {
        int realSize = textureSize( realClassTex, 0 ).x;
        int realJ = int( getIndirectIndex( gl_DrawID ) );
        vRealClass = int( texelFetch( realClassTex, ivec2( realJ % realSize, realJ / realSize ), 0 ).r * 255.0 + 0.5 );
      }
      #endif`
    : 'int vRealClass = realClass;'
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${VERTEX_PARS}
      ${forBatch ? 'uniform sampler2D realClassTex;' : 'uniform int realClass;'}`)
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      // Box projection of the local position onto the face's dominant axis —
      // the same metres-based mapping ifcModel.ts bakes into the 'uv'
      // attribute, recomputed here from attributes the shader reads anyway:
      // measured live, fetching 'uv' as well was the single largest cost of
      // this mode on a 6M-triangle model (vertex fetch bandwidth).
      ${classSource}
      {
        vec3 realN = abs( normal );
        vec2 realUvLocal = ( realN.x >= realN.y && realN.x >= realN.z ) ? position.yz
          : ( realN.y >= realN.z ) ? position.xz : position.xy;
        vRealUvClass = vec3( realUvLocal, float( vRealClass ) );
      }`)
    // Glass drawn by the separate glass batch is collapsed here, per vertex,
    // rather than discarded per fragment (keeps the opaque batch's shader
    // free of discard). Raycasting is CPU-side, so picking still hits it.
    .replace('#include <project_vertex>', `#include <project_vertex>
      if ( abs( vRealUvClass.z - ${GLASS_CLASS}.0 ) < 0.5 && realGlassHidden > 0.5 ) gl_Position = vec4( 0.0, 0.0, -2.0, 1.0 );`)
  if (forBatch) {
    shader.vertexAlphas = true
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', BATCH_ALPHA_VERTEX_PATCH)
  }
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      ${FRAGMENT_PARS}`)
    .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
      // Unmatched surfaces (class 0 — typically most MEP) skip the texture
      // work entirely; the class is flat per triangle, so the branch is
      // coherent. UV gradients are taken outside the branch and passed to
      // textureGrad, keeping mip selection well-defined inside it.
      int vRealClass = int( vRealUvClass.z + 0.5 );
      vec2 vRealUv = vRealUvClass.xy;
      bool realOn = vRealClass > 0;
      // Per-class look, fetched only on matched surfaces. Only the UV and
      // the class cross the vertex -> fragment boundary: measured live, every
      // extra varying costs real time on a 6M-triangle model.
      // vRealTex: xy 1/tile size (metres), z texture layer, w 1 = texture carries colour
      // vRealMat: x roughness, y metalness, z bump strength, w detail strength
      vec4 vRealTex = vec4( 1.0, 1.0, 0.0, 0.0 );
      vec4 vRealMat = vec4( 0.0 );
      if ( realOn ) {
        vRealTex = texelFetch( realParams, ivec2( vRealClass, 0 ), 0 );
        vRealMat = texelFetch( realParams, ivec2( vRealClass, 1 ), 0 );
      }
      vec2 realUv = vRealUv * vRealTex.xy;
      vec2 realUvDx = dFdx( realUv );
      vec2 realUvDy = dFdy( realUv );
      vec4 realSample = vec4( 0.5 );
      if ( realOn ) {
        realSample = textureGrad( realTex, vec3( realUv, vRealTex.z ), realUvDx, realUvDy );
        if ( vRealTex.w > 0.5 ) diffuseColor.rgb *= pow( realSample.rgb, vec3( 2.2 ) );
        else diffuseColor.rgb *= 1.0 + ( realSample.r - 0.5 ) * 2.0 * vRealMat.w;
      }`)
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      if ( realOn ) roughnessFactor = clamp( vRealMat.x + ( realSample.a - 0.5 ) * 0.12, 0.03, 1.0 );`)
    .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      if ( realOn ) metalnessFactor = vRealMat.y;`)
    .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
      // Derivatives in uniform control flow, computed here where they're
      // used rather than held live through the shader.
      vec2 realDh = vec2( dFdx( realSample.a ), dFdy( realSample.a ) ) * vRealMat.z;
      vec3 realSigX = dFdx( -vViewPosition );
      vec3 realSigY = dFdy( -vViewPosition );
      if ( realOn && vRealMat.z > 0.0 ) {
        // Derivative bump mapping (same maths as three.js's own
        // perturbNormalArb) — needs no tangents, which IFC geometry lacks.
        vec3 realSx = normalize( realSigX );
        vec3 realSy = normalize( realSigY );
        vec3 realR1 = cross( realSy, normal );
        vec3 realR2 = cross( normal, realSx );
        float realDet = dot( realSx, realR1 ) * faceDirection;
        vec3 realGrad = sign( realDet ) * ( realDh.x * realR1 + realDh.y * realR2 );
        normal = normalize( abs( realDet ) * normal - realGrad );
      }`)
}

interface SurfaceUniforms {
  realTex: { value: THREE.DataArrayTexture }
  realParams: { value: THREE.DataTexture }
  realGlassHidden: { value: number }
  realClass: { value: number }
  realClassTex: { value: THREE.Texture | null }
}

function createSurfaceMaterial(forBatch: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial()
  const uniforms: SurfaceUniforms = {
    realTex: { value: getRealisticTextureArray() },
    realParams: { value: getClassParamsTexture() },
    realGlassHidden: { value: 0 },
    realClass: { value: 0 },
    realClassTex: { value: null },
  }
  material.userData.realisticUniforms = uniforms
  material.onBeforeCompile = shader => {
    shader.uniforms.realTex = uniforms.realTex
    shader.uniforms.realParams = uniforms.realParams
    shader.uniforms.realGlassHidden = uniforms.realGlassHidden
    if (forBatch) shader.uniforms.realClassTex = uniforms.realClassTex
    else shader.uniforms.realClass = uniforms.realClass
    patchRealisticSurfaceShader(shader, forBatch)
  }
  // Every realistic surface material shares one compiled program per
  // variant kind; uniforms stay per material.
  material.customProgramCacheKey = () => (forBatch ? 'realistic-surface-batch-v16' : 'realistic-surface-v16')
  return material
}

// --- Glass ---------------------------------------------------------------------

const GLASS_TINT = new THREE.Color(0x6f8a8f)
// Base opacity of cheap glass; reflections are added on top at full strength
// (see patchCheapGlass), so glass reads as glass rather than a faded sheet.
const GLASS_ALPHA = 0.45

// Cheap glass: an ordinary transparent pass, but with the specular (sky/sun
// reflection) kept at full strength instead of being faded by opacity the way
// normal alpha blending would — premultiplied output with One /
// OneMinusSrcAlpha blending, the same trick three.js's own transmission path
// uses to keep reflections on see-through surfaces.
function patchCheapGlass(shader: THREE.WebGLProgramParametersWithUniforms) {
  shader.fragmentShader = shader.fragmentShader.replace(
    'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
    `float realFade = clamp( diffuseColor.a / ${GLASS_ALPHA.toFixed(3)}, 0.0, 1.0 );
    vec3 outgoingLight = totalDiffuse * diffuseColor.a + totalSpecular * realFade + totalEmissiveRadiance;`,
  )
}

function createGlassMaterial(forBatch: boolean, transmission: boolean): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: GLASS_TINT,
    roughness: 0.04,
    metalness: 0,
    ior: 1.5,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  })
  if (transmission) {
    // Real refraction/transmission — three.js renders the opaque scene an
    // extra time into a texture for this, hence opt-in only.
    material.transmission = 1
    material.thickness = 0.02
    material.opacity = 1
  } else {
    material.opacity = GLASS_ALPHA
    material.blending = THREE.CustomBlending
    material.blendSrc = THREE.OneFactor
    material.blendDst = THREE.OneMinusSrcAlphaFactor
    material.blendSrcAlpha = THREE.OneFactor
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor
  }
  material.onBeforeCompile = shader => {
    if (forBatch) {
      shader.vertexAlphas = true
      shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', BATCH_ALPHA_VERTEX_PATCH)
    }
    if (!transmission) patchCheapGlass(shader)
  }
  material.customProgramCacheKey = () => `realistic-glass-${forBatch ? 'batch' : 'mesh'}-${transmission ? 't' : 'c'}-v1`
  material.userData.realisticKind = transmission ? 'glass-t' : 'glass'
  return material
}

// --- Individual meshes -------------------------------------------------------

function tintRatio(target: THREE.Color, current: THREE.Color, original: THREE.Color | undefined, base: THREE.Color) {
  // current / original, per channel: 1 at rest, and whatever shift a
  // selection/variance/clash tint applied to the real colour otherwise —
  // re-applied on top of the class's own colour.
  if (!original) { target.copy(base); return }
  const ratio = (c: number, o: number) => Math.min(4, c / Math.max(o, 0.04))
  target.setRGB(base.r * ratio(current.r, original.r), base.g * ratio(current.g, original.g), base.b * ratio(current.b, original.b))
}

const WHITE = new THREE.Color(1, 1, 1)

// Display material for one individual mesh in Realistic mode, cached on its
// real material's userData (like lambertVariant/hiddenLineVariant) and
// re-synced on every call. `original` is the mesh's as-imported colour,
// used to carry selection/variance/clash tints across onto classes that
// replace the colour; omitted by callers that don't know it, in which case
// the last one supplied is kept. `ifcAlpha` is the element's own IFC
// transparency (IfcSurfaceStyleRendering), for callers whose `source` no
// longer carries it — glass is drawn at that opacity, as the model's author
// set it (2026-09-29, per Maro comparing the main view against the Baseline
// pane, whose cloned materials still carried it: "i prefer the glass in the
// baseline view").
export function getRealisticVariant(
  source: THREE.MeshStandardMaterial, classIndex: number, original: THREE.Color | undefined, glassTransmission: boolean,
  ifcAlpha = 1,
): THREE.Material {
  const kind = classIndex === GLASS_CLASS ? (glassTransmission ? 'glass-t' : 'glass') : 'surface'
  let variant = source.userData.realisticVariant as THREE.Material | undefined
  if (variant && variant.userData.realisticKind !== kind) {
    variant.dispose()
    variant = undefined
  }
  if (!variant) {
    variant = classIndex === GLASS_CLASS ? createGlassMaterial(false, glassTransmission) : createSurfaceMaterial(false)
    variant.userData.realisticKind = kind
    source.userData.realisticVariant = variant
  }
  variant.userData.realisticClass = classIndex
  variant.userData.realisticIfcAlpha = ifcAlpha
  if (original) variant.userData.realisticOriginal = original
  syncRealisticVariant(source)
  return variant
}

// Copies whatever the rest of the app just wrote onto the real material
// (selection emissive/tint, timeline colour/opacity, clipping) onto its
// realistic variant. Safe to call when no variant exists.
export function syncRealisticVariant(source: THREE.MeshStandardMaterial) {
  const variant = source.userData.realisticVariant as THREE.MeshStandardMaterial | undefined
  if (!variant) return
  const classIndex = variant.userData.realisticClass as number
  const original = variant.userData.realisticOriginal as THREE.Color | undefined
  if (classIndex === GLASS_CLASS) {
    tintRatio(variant.color, source.color, original, GLASS_TINT)
    const transmission = (variant as THREE.MeshPhysicalMaterial).transmission > 0
    const ifcAlpha = (variant.userData.realisticIfcAlpha as number | undefined) ?? 1
    // min, not product: a Baseline-pane clone's material still carries the
    // IFC transparency itself (sceneClone.ts), while the main view's has it
    // replaced by the user's opacity — either way the pane ends up at its
    // IFC value, never squared.
    variant.opacity = (transmission ? 1 : GLASS_ALPHA) * Math.min(source.opacity, ifcAlpha)
  } else {
    if (classReplacesColour(classIndex)) tintRatio(variant.color, source.color, original, WHITE)
    else variant.color.copy(source.color)
    variant.opacity = source.opacity
    variant.transparent = source.transparent
    variant.side = source.side
    ;(variant.userData.realisticUniforms as SurfaceUniforms).realClass.value = classIndex
    variant.aoMap = source.aoMap
    variant.aoMapIntensity = source.aoMapIntensity
  }
  variant.emissive.copy(source.emissive)
  variant.emissiveIntensity = source.emissiveIntensity
  variant.clippingPlanes = source.clippingPlanes
  variant.clipShadows = source.clipShadows
}

export function disposeRealisticVariant(source: THREE.Material) {
  const variant = source.userData.realisticVariant as THREE.Material | undefined
  if (!variant) return
  variant.dispose()
  delete source.userData.realisticVariant
}

// --- Batched IFC content -------------------------------------------------------

interface GlassBatchState {
  mesh: THREE.BatchedMesh
  mainIds: Int32Array
  glassIds: Int32Array
  // Each pane's own IFC transparency, multiplied into its per-instance alpha.
  ifcAlphas: Float32Array
  transmission: boolean
  classes: Uint8Array
}

interface BatchRealisticState {
  classes: Uint8Array
  classTexture: THREE.DataTexture
  classesInfo: RealisticModelInfo | undefined
  classesMapping: RealisticMaterialMap
  classesSuppressed: boolean
  glass: GlassBatchState | null
}

type BatchedMeshInternals = THREE.BatchedMesh & {
  _maxInstanceCount: number
  _drawInfo: { visible: boolean; active: boolean }[]
  _colorsTexture: THREE.DataTexture | null
}

function computeBatchClasses(batch: BatchState, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap, suppressed: boolean): Uint8Array {
  const classes = new Uint8Array((batch.mesh as BatchedMeshInternals)._maxInstanceCount)
  if (suppressed || !info) return classes
  for (const [expressID, infos] of batch.byExpressId) {
    for (const inst of infos) {
      const key = info.keyByPiece.get(`${expressID}:${inst.ifcGeometryId}`) ?? info.keyByExpressId.get(expressID)
      classes[inst.instanceId] = classIndexForKey(key, info, mapping)
    }
  }
  return classes
}

function buildGlassBatch(batch: BatchState, classes: Uint8Array, transmission: boolean): GlassBatchState | null {
  const glassInfos: BatchInstanceInfo[] = []
  for (const infos of batch.byExpressId.values()) {
    for (const inst of infos) if (classes[inst.instanceId] === GLASS_CLASS) glassInfos.push(inst)
  }
  if (glassInfos.length === 0) return null
  const geometryIds = [...new Set(glassInfos.map(g => g.geometryId))]
  let vertexCount = 0
  let indexCount = 0
  for (const id of geometryIds) {
    const geometry = batch.geometryById.get(id)!
    vertexCount += geometry.attributes.position.count
    indexCount += geometry.index ? geometry.index.count : 0
  }
  const mesh = new THREE.BatchedMesh(glassInfos.length, vertexCount, indexCount, createGlassMaterial(true, transmission))
  mesh.name = 'realistic-glass'
  mesh.userData.isRealisticGlassBatch = true
  // Transparent panes need back-to-front order; with no per-instance frustum
  // culling (see ifcModel.ts on why the main batch disables it) this is one
  // sort over the glass instances only.
  mesh.sortObjects = true
  mesh.perObjectFrustumCulled = false
  mesh.castShadow = false
  // Picking goes through the main batch, which still holds every glass
  // instance's geometry (only its shading is discarded there).
  mesh.raycast = () => {}
  const localGeometryId = new Map<number, number>()
  for (const id of geometryIds) localGeometryId.set(id, mesh.addGeometry(batch.geometryById.get(id)!))
  const mainIds = new Int32Array(glassInfos.length)
  const glassIds = new Int32Array(glassInfos.length)
  const ifcAlphas = new Float32Array(glassInfos.length)
  glassInfos.forEach((g, i) => {
    ifcAlphas[i] = g.colorAlpha
    const glassId = mesh.addInstance(localGeometryId.get(g.geometryId)!)
    mesh.setMatrixAt(glassId, g.matrix)
    mesh.setColorAt(glassId, WHITE)
    mainIds[i] = g.instanceId
    glassIds[i] = glassId
  })
  mesh.position.copy(batch.mesh.position)
  mesh.quaternion.copy(batch.mesh.quaternion)
  mesh.scale.copy(batch.mesh.scale)
  batch.mesh.parent?.add(mesh)
  return { mesh, mainIds, glassIds, ifcAlphas, transmission, classes }
}

function disposeGlassBatch(glass: GlassBatchState) {
  glass.mesh.parent?.remove(glass.mesh)
  ;(glass.mesh.material as THREE.Material).dispose()
  glass.mesh.dispose()
}

// Per frame: the glass batch mirrors the main batch's per-instance
// visibility (Isolate/Hide/timeline/materialize), colour + alpha (selection
// tint, Fade Unselected) and clipping, so none of those code paths need to
// know it exists.
export function syncRealisticGlassBatch(batch: BatchState) {
  const glass = (batch.mesh.userData.realistic as BatchRealisticState | undefined)?.glass
  if (!glass) return
  const main = batch.mesh as BatchedMeshInternals
  const glassMesh = glass.mesh as BatchedMeshInternals
  const mainColors = main._colorsTexture?.image.data as Float32Array | undefined
  const glassColorsTexture = glassMesh._colorsTexture
  const glassColors = glassColorsTexture?.image.data as Float32Array | undefined
  let colorsChanged = false
  for (let k = 0; k < glass.mainIds.length; k++) {
    const mainId = glass.mainIds[k]
    const glassId = glass.glassIds[k]
    const info = main._drawInfo[mainId]
    const visible = !!info && info.active && info.visible
    if (glassMesh._drawInfo[glassId].visible !== visible) glassMesh.setVisibleAt(glassId, visible)
    if (mainColors && glassColors) {
      const a = mainId * 4
      const b = glassId * 4
      for (let c = 0; c < 4; c++) {
        const value = c === 3 ? mainColors[a + 3] * glass.ifcAlphas[k] : mainColors[a + c]
        if (glassColors[b + c] !== value) { glassColors[b + c] = value; colorsChanged = true }
      }
    }
  }
  if (colorsChanged && glassColorsTexture) glassColorsTexture.needsUpdate = true
  const mainMaterial = (Array.isArray(main.material) ? main.material[0] : main.material) as THREE.Material
  const glassMaterial = glassMesh.material as THREE.Material
  glassMaterial.clippingPlanes = mainMaterial.clippingPlanes
  glassMaterial.clipShadows = mainMaterial.clipShadows
  glassMesh.visible = main.visible
}

// Applies Realistic mode to one still-batched model and returns the material
// the batch should display. `suppressed` keeps every batched element on its
// imported look (a whole-model texture override is in force — explicit
// custom materials always win).
export function applyRealisticToBatch(
  batch: BatchState, batchMaterial: THREE.MeshStandardMaterial, info: RealisticModelInfo | undefined,
  mapping: RealisticMaterialMap, suppressed: boolean, glassTransmission: boolean, receiveShadow: boolean,
): THREE.Material {
  let state = batch.mesh.userData.realistic as BatchRealisticState | undefined
  const classesStale = !state || state.classesInfo !== info || state.classesMapping !== mapping || state.classesSuppressed !== suppressed
  if (!state || classesStale) {
    const classes = computeBatchClasses(batch, info, mapping, suppressed)
    const size = Math.max(1, Math.ceil(Math.sqrt(classes.length)))
    const texData = new Uint8Array(size * size)
    texData.set(classes)
    if (state && state.classTexture.image.width === size) {
      ;(state.classTexture.image.data as Uint8Array).set(texData)
      state.classTexture.needsUpdate = true
    } else {
      state?.classTexture.dispose()
      const classTexture = new THREE.DataTexture(texData, size, size, THREE.RedFormat, THREE.UnsignedByteType)
      classTexture.unpackAlignment = 1
      classTexture.needsUpdate = true
      state = { classes, classTexture, classesInfo: info, classesMapping: mapping, classesSuppressed: suppressed, glass: state?.glass ?? null }
    }
    state.classes = classes
    state.classesInfo = info
    state.classesMapping = mapping
    state.classesSuppressed = suppressed
    batch.mesh.userData.realistic = state
  }
  // Read by Viewport3D's per-instance colour write: colour-replacing classes
  // get a white base so the texture's own colour shows.
  batch.mesh.userData.realisticActiveClasses = state.classes

  if (state.glass && (state.glass.classes !== state.classes || state.glass.transmission !== glassTransmission)) {
    disposeGlassBatch(state.glass)
    state.glass = null
  }
  if (!state.glass) state.glass = buildGlassBatch(batch, state.classes, glassTransmission)
  if (state.glass) state.glass.mesh.receiveShadow = receiveShadow

  let variant = batchMaterial.userData.realisticBatchVariant as THREE.MeshStandardMaterial | undefined
  if (!variant) {
    variant = createSurfaceMaterial(true)
    batchMaterial.userData.realisticBatchVariant = variant
  }
  const uniforms = variant.userData.realisticUniforms as SurfaceUniforms
  uniforms.realClassTex.value = state.classTexture
  uniforms.realGlassHidden.value = state.glass ? 1 : 0
  variant.color.copy(batchMaterial.color)
  variant.side = batchMaterial.side
  variant.transparent = batchMaterial.transparent
  variant.clippingPlanes = batchMaterial.clippingPlanes
  variant.clipShadows = batchMaterial.clipShadows
  return variant
}

export function clearRealisticFromBatch(batch: BatchState) {
  const state = batch.mesh.userData.realistic as BatchRealisticState | undefined
  if (state) {
    if (state.glass) disposeGlassBatch(state.glass)
    state.classTexture.dispose()
    delete batch.mesh.userData.realistic
  }
  delete batch.mesh.userData.realisticActiveClasses
  const batchMaterial = batch.mesh.userData.standardMaterial as THREE.Material | undefined
  const variant = batchMaterial?.userData.realisticBatchVariant as THREE.Material | undefined
  if (variant) {
    variant.dispose()
    delete batchMaterial!.userData.realisticBatchVariant
  }
}
