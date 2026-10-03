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

// asphalt/stone/gravel/soil/tile added 2026-09-29, per Maro ("add more
// material types e.g asphalt"). Appended, never reordered: the shader's
// class index and texture layer both follow this order.
export const REALISTIC_CLASSES = [
  'concrete', 'glass', 'metal', 'grass', 'brick', 'timber', 'asphalt', 'stone', 'gravel', 'soil', 'tile', 'render', 'painted-metal',
] as const
export type RealisticClass = typeof REALISTIC_CLASSES[number]
// 'original' — explicitly keep the imported look for this material, even
// if its name would otherwise auto-match a class.
export type RealisticMapping = RealisticClass | 'original'
export type RealisticMaterialMap = Record<string, RealisticMapping>

export const REALISTIC_CLASS_LABELS: Record<RealisticClass, string> = {
  concrete: 'Cast concrete',
  glass: 'Glass',
  metal: 'Exposed metal',
  grass: 'Grass / green roof',
  brick: 'Brick',
  timber: 'Timber',
  asphalt: 'Asphalt / tarmac',
  stone: 'Stone / paving',
  gravel: 'Gravel',
  soil: 'Soil / earth',
  tile: 'Tiles',
  render: 'Smooth render',
  'painted-metal': 'Painted / powder-coated metal',
}

// Shader-side class index. 0 = no class (keep the imported look). The
// Original classes use texture layer index - 1; finish variants reuse layers.
const CLASS_INDEX: Record<RealisticClass, number> = {
  concrete: 1, glass: 2, metal: 3, grass: 4, brick: 5, timber: 6, asphalt: 7, stone: 8, gravel: 9, soil: 10, tile: 11,
  render: 12, 'painted-metal': 13,
}
export const GLASS_CLASS = CLASS_INDEX.glass
// Classes whose texture carries its own colour (a brick is brick-coloured
// whatever flat colour the IFC author picked), as opposed to concrete/metal,
// which keep the imported colour and only add surface detail on top. For
// these, the element's colour is replaced by white at rest, so any tint
// applied on top of it (selection, variance, clash) still shows as a tint
// of the texture rather than being lost.
// Stone and tile keep the imported colour (a limestone and a granite, a
// white and a grey tile, are the modeller's real choice) with texture
// detail on top; asphalt, gravel and soil read the same whatever flat
// colour the model gave them.
const REPLACES_COLOUR = [false, false, true, false, true, true, true, true, false, true, true, false]
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
  ['asphalt', /\b(asphalt|tarmac|tarmacadam|bitumen|bituminous|macadam|blacktop|road surface)\b/],
  ['stone', /\b(stone|granite|limestone|sandstone|marble|slate|basalt|travertine|flagstone|flagstones|cobble|cobbles|cobblestone|quartzite)\b/],
  ['gravel', /\b(gravel|shingle|pebble|pebbles|ballast)\b/],
  ['soil', /\b(soil|topsoil|subsoil|earth|earthwork|earthworks|backfill|clay|dirt|made ground)\b/],
  ['tile', /\b(tile|tiles|tiled|tiling|ceramic|porcelain|mosaic)\b/],
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
const EARTHWORKS_TYPES = new Set(['IFCEARTHWORKSFILL', 'IFCEARTHWORKSCUT', 'IFCEARTHWORKSELEMENT'])

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
    // Which names to try, in order.
    let texts: string[]
    if (p.layered) {
      // A layered wall/slab is seen from its outer faces: its first layer
      // (the exterior side, as Revit/ArchiCAD export it), then its last —
      // skipping concealed core layers (studs, insulation...), and falling
      // through to the other face when one says nothing (2026-09-29: a
      // ceiling exported as "Default / Ceiling Tile 600 x 600"). The full
      // layer list is shown in the mapping panel to override a wrong guess.
      const first = p.materialNames[0]
      const last = p.materialNames[p.materialNames.length - 1]
      texts = [...new Set([first, last])].filter(name => !CONCEALED_LAYER.test(normaliseName(name)))
    } else if (p.materialNames.length === 1) {
      texts = [p.materialNames[0]]
    } else {
      // Several constituent materials (a light fitting's paint + plastic +
      // aluminium) and no style saying which one this piece is: any single
      // match would be a guess, so leave it for manual mapping.
      texts = []
    }
    for (const text of texts) {
      const found = matchClassesInText(text)
      if (found.length === 1) return { cls: found[0], candidates: [] }
      if (found.length > 1) return { cls: null, candidates: found }
    }
  }
  if (p.transparent && GLAZING_TYPES.has(p.ifcType)) return { cls: 'glass', candidates: [] }
  // Earthworks solids are earth by definition (IFC4.3 IfcEarthworksFill/
  // Cut), whatever their style is called — Revit exports name those styles
  // "SurfaceStyle_8f887e" and the like, which match nothing.
  if (EARTHWORKS_TYPES.has(p.ifcType)) return { cls: 'soil', candidates: [] }
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

// Every IFC element (expressID) in one model whose geometry uses this
// material entry — for the mapping panel's Select button (2026-09-29, per
// Maro: "i want them selectable... so i can identify accordingly").
// Every material key used by one element (all of its geometry pieces) —
// for filtering the Realistic Materials panel to the current selection
// (2026-10-02). The per-element index is built once per info and cached.
const keysByExpressIdCache = new WeakMap<RealisticModelInfo, Map<number, Set<string>>>()
export function keysForExpressId(info: RealisticModelInfo, expressID: number): Set<string> | undefined {
  let index = keysByExpressIdCache.get(info)
  if (!index) {
    index = new Map()
    for (const [piece, key] of info.keyByPiece) {
      const id = Number(piece.slice(0, piece.indexOf(':')))
      let set = index.get(id)
      if (!set) { set = new Set(); index.set(id, set) }
      set.add(key)
    }
    for (const [id, key] of info.keyByExpressId) {
      if (!index.has(id)) index.set(id, new Set([key]))
    }
    keysByExpressIdCache.set(info, index)
  }
  return index.get(expressID)
}

export function expressIdsForKey(info: RealisticModelInfo, key: string): number[] {
  const ids = new Set<number>()
  for (const [piece, pieceKey] of info.keyByPiece) {
    if (pieceKey === key) ids.add(Number(piece.slice(0, piece.indexOf(':'))))
  }
  // Pieces with no geometry id of their own only ever reach keyByExpressId.
  for (const [expressID, elementKey] of info.keyByExpressId) {
    if (elementKey === key) ids.add(expressID)
  }
  return [...ids]
}

// Which loaded models use each entry, and how often — the mapping panel
// offers one Select button per model, since a selection is per model.
export interface RealisticEntryModel { objectId: string; name: string; count: number }

export function entryModelsByKey(
  models: { objectId: string; name: string; info: RealisticModelInfo | undefined; isIfc: boolean }[],
): Record<string, RealisticEntryModel[]> {
  const byKey: Record<string, RealisticEntryModel[]> = {}
  for (const { objectId, name, info, isIfc } of models) {
    if (!info || !isIfc) continue
    for (const entry of info.entries.values()) {
      (byKey[entry.key] ??= []).push({ objectId, name, count: entry.count })
    }
  }
  return byKey
}

export function classIndexForKey(key: string | undefined, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap): number {
  if (key === undefined) return 0
  const manual = mapping[key]
  if (manual === 'original') return 0
  if (manual) return CLASS_INDEX[manual] ?? 0
  const auto = info?.entries.get(key)?.autoClass
  return auto ? CLASS_INDEX[auto] : 0
}

// Per-material colour override (2026-10-02, per Maro: "allow me to change
// material color in general"). Stored in the same mapping object as the
// class choices, under "colour:<key>", so it travels everywhere the mapping
// already does (persistence, staleness checks, the Baseline pane) — nothing
// iterates the mapping's keys, and class lookups only ever read real keys.
// When set, it becomes the material's base colour in Realistic mode: it
// replaces the imported colour outright, and for a textured class (timber,
// brick, ...) it tints the texture instead of leaving it its own colour.
const COLOUR_KEY_PREFIX = 'colour:'
const TEXTURE_KEY_PREFIX = 'texture:'
export const REALISTIC_TEXTURE_SCALES = [0.25, 0.5, 1, 2, 4] as const
export interface RealisticTextureSettings { scale: number; rotation: number }
const DEFAULT_TEXTURE_SETTINGS: RealisticTextureSettings = { scale: 1, rotation: 0 }

// Metadata shares the existing per-project mapping storage, as colour does.
// Discrete settings fit into the existing per-instance lookup without extra
// varyings, texture fetches or draw calls. Old maps keep their original look.
export function textureSettingsForKey(key: string | undefined, mapping: RealisticMaterialMap): RealisticTextureSettings {
  if (key === undefined) return DEFAULT_TEXTURE_SETTINGS
  try {
    const raw = (mapping as Record<string, string>)[TEXTURE_KEY_PREFIX + key]
    if (!raw) return DEFAULT_TEXTURE_SETTINGS
    const value = JSON.parse(raw)
    return {
      scale: REALISTIC_TEXTURE_SCALES.includes(value?.scale) ? value.scale : 1,
      rotation: [0, 90, 180, 270].includes(value?.rotation) ? value.rotation : 0,
    }
  } catch { return DEFAULT_TEXTURE_SETTINGS }
}

export function withTextureSettings(mapping: RealisticMaterialMap, key: string, settings: RealisticTextureSettings): RealisticMaterialMap {
  const next = { ...mapping } as Record<string, string>
  if (settings.scale === 1 && settings.rotation === 0) delete next[TEXTURE_KEY_PREFIX + key]
  else next[TEXTURE_KEY_PREFIX + key] = JSON.stringify(settings)
  return next as RealisticMaterialMap
}

export function resetRealisticEntry(mapping: RealisticMaterialMap, key: string): RealisticMaterialMap {
  const next = { ...mapping }
  delete next[key]
  delete next[COLOUR_KEY_PREFIX + key]
  delete next[TEXTURE_KEY_PREFIX + key]
  return next
}
const overrideColourCache = new Map<string, THREE.Color>()
export function colourOverrideHex(key: string | undefined, mapping: RealisticMaterialMap): string | null {
  if (key === undefined) return null
  const hex = (mapping as Record<string, string>)[COLOUR_KEY_PREFIX + key]
  return typeof hex === 'string' && /^#[0-9a-f]{6}$/i.test(hex) ? hex : null
}
export function colourOverrideForKey(key: string | undefined, mapping: RealisticMaterialMap): THREE.Color | null {
  const hex = colourOverrideHex(key, mapping)
  if (!hex) return null
  let colour = overrideColourCache.get(hex)
  if (!colour) { colour = new THREE.Color(hex); overrideColourCache.set(hex, colour) }
  return colour
}
export function withColourOverride(mapping: RealisticMaterialMap, key: string, hex: string | null): RealisticMaterialMap {
  const next = { ...mapping } as Record<string, string>
  if (hex) next[COLOUR_KEY_PREFIX + key] = hex
  else delete next[COLOUR_KEY_PREFIX + key]
  return next as RealisticMaterialMap
}
// Every colour override in use, for the picker's "recent" swatches.
export function colourOverridesInUse(mapping: RealisticMaterialMap): string[] {
  return [...new Set(Object.entries(mapping as Record<string, string>)
    .filter(([k, v]) => k.startsWith(COLOUR_KEY_PREFIX) && typeof v === 'string')
    .map(([, v]) => v.toLowerCase()))]
}
// The per-instance base colour every batch colour writer uses (ModelObjects'
// selection pass, the timeline's colour loop, the Baseline pane): the
// override if any, white under a class whose texture carries its own colour,
// otherwise the element's imported colour.
export function realisticInstanceBase(
  mesh: THREE.BatchedMesh, instanceId: number, imported: THREE.Color, white: THREE.Color,
): THREE.Color {
  const override = (mesh.userData.realisticInstanceColours as (THREE.Color | null)[] | undefined)?.[instanceId]
  if (override) return override
  const classes = mesh.userData.realisticActiveClasses as Uint8Array | undefined
  return classes && classReplacesColour(classes[instanceId]) ? white : imported
}

function meshKey(mesh: THREE.Mesh, material: THREE.Material, info: RealisticModelInfo | undefined): string | undefined {
  const expressID = mesh.userData.expressID as number | undefined
  if (expressID !== undefined) {
    const geometryId = mesh.userData.ifcGeometryId as number | undefined
    return (geometryId !== undefined ? info?.keyByPiece.get(`${expressID}:${geometryId}`) : undefined)
      ?? info?.keyByExpressId.get(expressID)
  }
  return meshMaterialKey(material)
}
export function colourOverrideForMesh(
  mesh: THREE.Mesh, material: THREE.Material, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap,
): THREE.Color | null {
  return colourOverrideForKey(meshKey(mesh, material, info), mapping)
}

export function textureSettingsForMesh(mesh: THREE.Mesh, material: THREE.Material, info: RealisticModelInfo | undefined, mapping: RealisticMaterialMap) {
  return textureSettingsForKey(meshKey(mesh, material, info), mapping)
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
  if (manual) return manual === 'original' ? 0 : (CLASS_INDEX[manual] ?? 0)
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

const asphaltLayer: LayerFn = (u, v) => {
  // Dark binder with pale aggregate showing through; faint wear patches.
  const wear = fbm(u, v, 3, 3, 3, 61)
  const grain = valueNoise(u, v, 200, 200, 62)
  const chip = valueNoise(u, v, 110, 110, 63)
  const base = 0.2 + (wear - 0.5) * 0.06 + (grain - 0.5) * 0.05
  const c = chip > 0.82 ? base + 0.22 : base
  return [c, c, c * 1.02, 0.45 + (grain - 0.5) * 0.3 + (chip > 0.82 ? 0.15 : 0)]
}

const stoneLayer: LayerFn = (u, v) => {
  // Neutral detail (the imported colour carries the stone's own hue):
  // cloudy variation, a few soft veins, fine grain.
  const cloud = fbm(u, v, 4, 4, 4, 71)
  const vein = Math.abs(Math.sin((u * 3 + fbm(u, v, 3, 3, 3, 72) * 2.5) * Math.PI * 2))
  const grain = valueNoise(u, v, 160, 160, 73)
  const d = 0.5 + (cloud - 0.5) * 0.35 + (vein < 0.06 ? -0.12 : 0) + (grain - 0.5) * 0.08
  return [d, d, d, 0.5 + (grain - 0.5) * 0.2]
}

const GRAVEL_TONES: [number, number, number][] = [[150, 146, 138], [122, 118, 110], [168, 158, 140], [104, 98, 90], [140, 128, 112]]
const gravelLayer: LayerFn = (u, v) => {
  // Tileable cellular noise: each cell is one pebble, shaded by distance to
  // its own centre, coloured from a stone palette.
  const cells = 18
  const x = u * cells
  const y = v * cells
  const cx = Math.floor(x)
  const cy = Math.floor(y)
  let best = 9
  let bestId = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx
      const gy = cy + dy
      const wx = ((gx % cells) + cells) % cells
      const wy = ((gy % cells) + cells) % cells
      const px = gx + hash2(wx, wy, 81)
      const py = gy + hash2(wx, wy, 82)
      const d = (x - px) ** 2 + (y - py) ** 2
      if (d < best) { best = d; bestId = wy * cells + wx }
    }
  }
  const tone = GRAVEL_TONES[Math.floor(hash2(bestId, 3, 83) * GRAVEL_TONES.length)]
  const dome = clamp01(1 - Math.sqrt(best) * 1.4)
  const shade = 0.55 + dome * 0.55
  return [tone[0] * shade / 255, tone[1] * shade / 255, tone[2] * shade / 255, dome]
}

const SOIL_TONES: [number, number, number][] = [[92, 70, 50], [118, 90, 62], [76, 58, 42], [104, 84, 60]]
const soilLayer: LayerFn = (u, v) => {
  const patch = fbm(u, v, 5, 5, 4, 91)
  const clod = valueNoise(u, v, 90, 90, 92)
  const fine = valueNoise(u, v, 240, 240, 93)
  const tone = SOIL_TONES[Math.min(3, Math.floor(patch * 4))]
  const shade = 0.78 + clod * 0.3 + (fine - 0.5) * 0.12
  return [tone[0] * shade / 255, tone[1] * shade / 255, tone[2] * shade / 255, 0.3 + clod * 0.5 + (fine - 0.5) * 0.15]
}

const tileLayer: LayerFn = (u, v) => {
  // Tile = 2 x 2 tiles (300mm in a 0.6m repeat) with 3mm grout joints; the
  // face keeps the imported colour, grout reads darker and recessed.
  const tiles = 2
  const fu = u * tiles - Math.floor(u * tiles)
  const fv = v * tiles - Math.floor(v * tiles)
  const joint = 3 / 300
  const grain = valueNoise(u, v, 128, 128, 101)
  if (fu < joint || fv < joint) return [0.34, 0.34, 0.34, 0.2]
  const tileId = Math.floor(u * tiles) + Math.floor(v * tiles) * tiles
  const d = 0.5 + (hash2(tileId, 5, 102) - 0.5) * 0.06 + (grain - 0.5) * 0.03
  return [d, d, d, 0.6]
}

// Original class layers. Additional finish presets reuse these textures.
const LAYERS: LayerFn[] = [
  concreteLayer, glassLayer, metalLayer, grassLayer, brickLayer, timberLayer,
  asphaltLayer, stoneLayer, gravelLayer, soilLayer, tileLayer,
]
const LAYER_COUNT = LAYERS.length

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
  { tile: [2, 2], roughness: 0.92, metalness: 0, bump: 0.4, detail: 0, textured: true }, // asphalt
  { tile: [1.6, 1.6], roughness: 0.7, metalness: 0, bump: 0.3, detail: 1, textured: false }, // stone
  { tile: [0.8, 0.8], roughness: 0.97, metalness: 0, bump: 1.5, detail: 0, textured: true }, // gravel
  { tile: [2, 2], roughness: 1, metalness: 0, bump: 0.8, detail: 0, textured: true }, // soil
  { tile: [0.6, 0.6], roughness: 0.3, metalness: 0, bump: 0.5, detail: 1, textured: false }, // tile
  { tile: [2.4, 2.4], roughness: 0.8, metalness: 0, bump: 0.05, detail: 0.12, textured: false }, // smooth render
  { tile: [1.5, 1.5], roughness: 0.5, metalness: 0, bump: 0.03, detail: 0.08, textured: false }, // coated metal
]

export function realisticTileSize(cls: RealisticClass, scale: number): [number, number] {
  const tile = (CLASS_PARAMS[CLASS_INDEX[cls]] ?? CLASS_PARAMS[0]).tile
  return [tile[0] * scale, tile[1] * scale]
}

// The table above as a (classes x 2) float texture, read with two texelFetches per
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
    // New finishes reuse the original detail layers rather than allocate
    // duplicate texture-array layers. Existing class indices stay stable.
    const layer = i === CLASS_INDEX.render ? 0 : i === CLASS_INDEX['painted-metal'] ? 2 : Math.max(i - 1, 0)
    data.set([1 / c.tile[0], 1 / c.tile[1], layer, c.textured ? 1 : 0], i * 4)
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
      vec2 realTransformValue = vec2( 1.0, 0.0 );
      #ifdef USE_BATCHING
      {
        int realSize = textureSize( realClassTex, 0 ).x;
        int realJ = int( getIndirectIndex( gl_DrawID ) );
        vec4 realEntry = texelFetch( realClassTex, ivec2( realJ % realSize, realJ / realSize ), 0 );
        vRealClass = int( realEntry.r * 255.0 + 0.5 );
        realTransformValue = vec2( exp2( floor( realEntry.g * 255.0 + 0.5 ) - 2.0 ), floor( realEntry.b * 255.0 + 0.5 ) );
      }
      #endif`
    : 'int vRealClass = realClass; vec2 realTransformValue = realTransform;'
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      ${VERTEX_PARS}
      ${forBatch ? 'uniform sampler2D realClassTex;' : 'uniform int realClass; uniform vec2 realTransform;'}`)
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
        if ( realTransformValue.y > 2.5 ) realUvLocal = vec2( realUvLocal.y, -realUvLocal.x );
        else if ( realTransformValue.y > 1.5 ) realUvLocal = -realUvLocal;
        else if ( realTransformValue.y > 0.5 ) realUvLocal = vec2( -realUvLocal.y, realUvLocal.x );
        vRealUvClass = vec3( realUvLocal / realTransformValue.x, float( vRealClass ) );
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
  realTransform: { value: THREE.Vector2 }
  realClassTex: { value: THREE.Texture | null }
}

function createSurfaceMaterial(forBatch: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial()
  const uniforms: SurfaceUniforms = {
    realTex: { value: getRealisticTextureArray() },
    realParams: { value: getClassParamsTexture() },
    realGlassHidden: { value: 0 },
    realClass: { value: 0 },
    realTransform: { value: new THREE.Vector2(1, 0) },
    realClassTex: { value: null },
  }
  material.userData.realisticUniforms = uniforms
  material.onBeforeCompile = shader => {
    shader.uniforms.realTex = uniforms.realTex
    shader.uniforms.realParams = uniforms.realParams
    shader.uniforms.realGlassHidden = uniforms.realGlassHidden
    if (forBatch) shader.uniforms.realClassTex = uniforms.realClassTex
    else {
      shader.uniforms.realClass = uniforms.realClass
      shader.uniforms.realTransform = uniforms.realTransform
    }
    patchRealisticSurfaceShader(shader, forBatch)
  }
  // Every realistic surface material shares one compiled program per
  // variant kind; uniforms stay per material.
  material.customProgramCacheKey = () => (forBatch ? 'realistic-surface-batch-v17' : 'realistic-surface-v17')
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
  // Offset on both sides (2026-10-02, per Maro: a Timber-mapped roof turned
  // pure green after being clicked and deselected, until a reload). The old
  // `c / max(o, 0.04)` gave 0 — not 1 — for any channel that's 0 in the
  // imported colour: a pure-green IFC colour (0, 0.5, 0) at rest zeroed the
  // texture's red and blue, leaving it green. With the offset, an unchanged
  // channel is always exactly 1, and a selection/variance tint still shifts
  // it (only reached for individual meshes — batched instances take
  // realisticInstanceBase's white base instead, which is why a reload,
  // re-batching the element, "fixed" it).
  const ratio = (c: number, o: number) => Math.min(4, (c + 0.04) / (o + 0.04))
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
  ifcAlpha = 1, colourOverride: THREE.Color | null = null,
  textureSettings: RealisticTextureSettings = DEFAULT_TEXTURE_SETTINGS,
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
  variant.userData.realisticOverride = colourOverride
  if (classIndex !== GLASS_CLASS) {
    ;(variant.userData.realisticUniforms as SurfaceUniforms).realTransform.value.set(textureSettings.scale, textureSettings.rotation / 90)
  }
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
  const override = variant.userData.realisticOverride as THREE.Color | null | undefined
  if (classIndex === GLASS_CLASS) {
    tintRatio(variant.color, source.color, original, override ?? GLASS_TINT)
    const transmission = (variant as THREE.MeshPhysicalMaterial).transmission > 0
    const ifcAlpha = (variant.userData.realisticIfcAlpha as number | undefined) ?? 1
    // min, not product: a Baseline-pane clone's material still carries the
    // IFC transparency itself (sceneClone.ts), while the main view's has it
    // replaced by the user's opacity — either way the pane ends up at its
    // IFC value, never squared.
    variant.opacity = (transmission ? 1 : GLASS_ALPHA) * Math.min(source.opacity, ifcAlpha)
  } else {
    if (override) tintRatio(variant.color, source.color, original, override)
    else if (classReplacesColour(classIndex)) tintRatio(variant.color, source.color, original, WHITE)
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
  _matricesTexture: THREE.DataTexture
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
// tint, Fade Unselected), matrix (the timeline's translate/fall profiles
// move batched instances in place, 2026-10-03) and clipping, so none of
// those code paths need to know it exists.
export function syncRealisticGlassBatch(batch: BatchState) {
  const glass = (batch.mesh.userData.realistic as BatchRealisticState | undefined)?.glass
  if (!glass) return
  const main = batch.mesh as BatchedMeshInternals
  const glassMesh = glass.mesh as BatchedMeshInternals
  const mainColors = main._colorsTexture?.image.data as Float32Array | undefined
  const glassColorsTexture = glassMesh._colorsTexture
  const glassColors = glassColorsTexture?.image.data as Float32Array | undefined
  const mainMatrices = main._matricesTexture.image.data as Float32Array
  const glassMatricesTexture = glassMesh._matricesTexture
  const glassMatrices = glassMatricesTexture.image.data as Float32Array
  let colorsChanged = false
  let matricesChanged = false
  for (let k = 0; k < glass.mainIds.length; k++) {
    const mainId = glass.mainIds[k]
    const glassId = glass.glassIds[k]
    const info = main._drawInfo[mainId]
    const visible = !!info && info.active && info.visible
    if (glassMesh._drawInfo[glassId].visible !== visible) glassMesh.setVisibleAt(glassId, visible)
    if (visible) {
      const a = mainId * 16
      const b = glassId * 16
      for (let c = 0; c < 16; c++) {
        if (glassMatrices[b + c] !== mainMatrices[a + c]) { glassMatrices[b + c] = mainMatrices[a + c]; matricesChanged = true }
      }
    }
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
  if (matricesChanged) glassMatricesTexture.needsUpdate = true
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
    const nextClasses = computeBatchClasses(batch, info, mapping, suppressed)
    // Texture/colour-only edits must not tear down and rebuild glass geometry.
    const classes = state && state.classes.length === nextClasses.length && nextClasses.every((cls, i) => cls === state!.classes[i])
      ? state.classes : nextClasses
    const size = Math.max(1, Math.ceil(Math.sqrt(classes.length)))
    const texData = new Uint8Array(size * size * 4)
    for (let i = 0; i < classes.length; i++) {
      texData[i * 4] = classes[i]
      texData[i * 4 + 1] = 2 // default scale = 2^(2-2) = 1
    }
    if (info && !suppressed) {
      const settingsByKey = new Map<string, RealisticTextureSettings>()
      for (const [expressID, instances] of batch.byExpressId) {
        for (const inst of instances) {
          const key = info.keyByPiece.get(`${expressID}:${inst.ifcGeometryId}`) ?? info.keyByExpressId.get(expressID)
          if (key === undefined) continue
          let settings = settingsByKey.get(key)
          if (!settings) { settings = textureSettingsForKey(key, mapping); settingsByKey.set(key, settings) }
          texData[inst.instanceId * 4 + 1] = Math.log2(settings.scale) + 2
          texData[inst.instanceId * 4 + 2] = settings.rotation / 90
        }
      }
    }
    if (state && state.classTexture.image.width === size && state.classTexture.format === THREE.RGBAFormat) {
      ;(state.classTexture.image.data as Uint8Array).set(texData)
      state.classTexture.needsUpdate = true
    } else {
      state?.classTexture.dispose()
      const classTexture = new THREE.DataTexture(texData, size, size, THREE.RGBAFormat, THREE.UnsignedByteType)
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
  // Per-instance colour overrides (see colourOverrideForKey) — rebuilt
  // whenever the mapping object changes, same staleness rule as classes.
  if (batch.mesh.userData.realisticInstanceColoursMapping !== mapping || batch.mesh.userData.realisticInstanceColoursInfo !== info) {
    const colours: (THREE.Color | null)[] = []
    if (info && !suppressed) {
      for (const [expressID, infos] of batch.byExpressId) {
        for (const inst of infos) {
          const key = info.keyByPiece.get(`${expressID}:${inst.ifcGeometryId}`) ?? info.keyByExpressId.get(expressID)
          const colour = colourOverrideForKey(key, mapping)
          if (colour) colours[inst.instanceId] = colour
        }
      }
    }
    batch.mesh.userData.realisticInstanceColours = colours
    batch.mesh.userData.realisticInstanceColoursMapping = mapping
    batch.mesh.userData.realisticInstanceColoursInfo = info
  }

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

// Orbit speed (2026-10-02, per Maro: orbiting in Realistic mode "the speed
// is disgusting"). Measured on the real five-file NBU Medical Clinic set:
// one frame draws ~6.0M triangles (the MEP file alone is 4.6M of them), and
// glass transmission makes three.js draw that whole opaque scene a second
// time into a texture every frame (+13 ms/frame in the same measurement).
// While the camera is being dragged, each model's transmissive glass batch
// swaps to the cheap glass material (one shared, lazily created instance,
// so its shader compiles once), dropping that extra pass; releasing the
// drag puts the real refracting glass straight back. Clipping planes are
// carried across so a section-boxed pane stays cut while moving.
let movingGlassMaterial: THREE.MeshPhysicalMaterial | null = null
export function setRealisticGlassMoving(root: THREE.Object3D, moving: boolean) {
  const batch = root.userData.batch as BatchState | undefined
  const glass = (batch?.mesh.userData.realistic as BatchRealisticState | undefined)?.glass
  if (!glass || !glass.transmission) return
  const mesh = glass.mesh
  if (moving) {
    if (mesh.userData.stillGlassMaterial) return
    movingGlassMaterial ??= createGlassMaterial(true, false)
    const still = mesh.material as THREE.Material
    movingGlassMaterial.clippingPlanes = still.clippingPlanes
    movingGlassMaterial.clipShadows = still.clipShadows
    mesh.userData.stillGlassMaterial = still
    mesh.material = movingGlassMaterial
  } else if (mesh.userData.stillGlassMaterial) {
    mesh.material = mesh.userData.stillGlassMaterial as THREE.Material
    delete mesh.userData.stillGlassMaterial
  }
}

export function clearRealisticFromBatch(batch: BatchState) {
  const state = batch.mesh.userData.realistic as BatchRealisticState | undefined
  if (state) {
    if (state.glass) disposeGlassBatch(state.glass)
    state.classTexture.dispose()
    delete batch.mesh.userData.realistic
  }
  delete batch.mesh.userData.realisticActiveClasses
  delete batch.mesh.userData.realisticInstanceColours
  delete batch.mesh.userData.realisticInstanceColoursMapping
  delete batch.mesh.userData.realisticInstanceColoursInfo
  const batchMaterial = batch.mesh.userData.standardMaterial as THREE.Material | undefined
  const variant = batchMaterial?.userData.realisticBatchVariant as THREE.Material | undefined
  if (variant) {
    variant.dispose()
    delete batchMaterial!.userData.realisticBatchVariant
  }
}
