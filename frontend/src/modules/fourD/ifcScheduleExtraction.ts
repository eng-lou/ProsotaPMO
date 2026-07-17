import * as THREE from 'three'
// Type-only — erased at compile time, so this doesn't pull ifcModel.ts's
// runtime code (web-ifc) into whichever chunk statically imports this
// module. The actual functions are dynamic-imported inside
// extractScheduleElements below instead, same idiom FourD.tsx/
// IfcDataPanel.tsx already use everywhere else to keep web-ifc out of the
// main bundle.
import type { IfcModelHandle, IfcTreeNode } from './ifcModel'
import { ensureMaterialized } from './elementBatching'

// IFC Schedule Wizard, step 1 (2026-07-13, per Maro: "generate a resource
// loaded schedule based on an imported ifc") — extracts the elements a
// first-draft schedule cares about, using only cheap reads already
// available once a model's loaded (bulk per-type expressID queries, each
// element's own Name attribute, and the geometry already sitting in the
// viewport) rather than a full per-element property-set walk, which
// web-ifc has no bulk API for at all (see this module's own plan doc). v1
// scope was originally fixed to five structural IFC types — matches
// Maro's own "Structural.ifc" framing and the reference file this was
// built and tested against (2018_Hospital_Structural.ifc).
// Broadened 2026-07-14 (per Maro, after pointing the wizard at a real
// steel+architectural Revit export: "not just structural now, this new
// model is also architectural") from the original 5 structural-only
// values. 'Structural Members' is the catch-all raw bucket for
// IfcMember/IfcPlate before the curtain-wall keyword re-bucketing below
// runs (see extractScheduleElements) — bracing, stair stringers,
// connection hardware that don't match a curtain-wall name pattern land
// here rather than being silently dropped.
export type ScheduleCategory =
  | 'Footings' | 'Reinforcement' | 'Columns' | 'Beams' | 'Slabs' | 'Walls'
  | 'Structural Members' | 'Stairs' | 'Roofs' | 'Curtain Walls' | 'Windows' | 'Doors' | 'Railings'
  | 'Coverings' | 'Furnishings'

export const IFC_TYPE_CATEGORIES: { ifcType: string; category: ScheduleCategory }[] = [
  { ifcType: 'IfcFooting', category: 'Footings' },
  // Individual reinforcement (2026-07-15, per Maro, after "Select
  // Unassigned" on a real structural export turned up 149 IfcReinforcingBar
  // elements — Revit's own per-bar rebar export, distinct from the
  // Footings/Walls/Slabs concrete they reinforce) — its own category rather
  // than silently folded into whichever pour it belongs to, since nothing
  // here parses IfcRelContainedInSpatialStructure/aggregation to actually
  // know which one that is; a first-draft "Place Reinforcement" activity
  // per storey (like every other category) at least gets it linked and
  // animating, freely re-sequenced/re-rated in the wizard same as anything
  // else. IfcReinforcingMesh alongside it for the same reason (fabric mesh
  // reinforcement, same export idiom, just not present in this particular
  // file).
  { ifcType: 'IfcReinforcingBar', category: 'Reinforcement' },
  { ifcType: 'IfcReinforcingMesh', category: 'Reinforcement' },
  { ifcType: 'IfcColumn', category: 'Columns' },
  { ifcType: 'IfcBeam', category: 'Beams' },
  { ifcType: 'IfcSlab', category: 'Slabs' },
  { ifcType: 'IfcWallStandardCase', category: 'Walls' },
  // Plain IfcWall alongside its StandardCase sibling (2026-07-15, same
  // report as above — 13 real concrete walls in the same file came back as
  // plain IfcWall, not IfcWallStandardCase: Revit exports a wall with a
  // non-rectangular/stepped profile, e.g. a parapet upstand, this way
  // instead). Same category either way — the two IFC classes mean
  // "how is this wall's profile described," not "is it structurally a
  // different kind of wall."
  { ifcType: 'IfcWall', category: 'Walls' },
  // Raw default bucket only — extractScheduleElements re-buckets a
  // curtain-wall-named member/plate into 'Curtain Walls' below.
  { ifcType: 'IfcMember', category: 'Structural Members' },
  { ifcType: 'IfcPlate', category: 'Structural Members' },
  // Generic catch-all IFC type (2026-07-15, same report — 50 elements here
  // were connection hardware/embeds, e.g. "SCN_Embed"/"SCN_HAS:3/8" anchor
  // bolts, exported as IfcBuildingElementProxy because they don't map
  // cleanly to any more specific IFC class) — lands in the same
  // "bracing/connection hardware" bucket IfcMember/IfcPlate already use
  // above, which is exactly what these are.
  { ifcType: 'IfcBuildingElementProxy', category: 'Structural Members' },
  { ifcType: 'IfcStair', category: 'Stairs' },
  { ifcType: 'IfcStairFlight', category: 'Stairs' },
  { ifcType: 'IfcRoof', category: 'Roofs' },
  { ifcType: 'IfcCurtainWall', category: 'Curtain Walls' },
  { ifcType: 'IfcWindow', category: 'Windows' },
  { ifcType: 'IfcDoor', category: 'Doors' },
  { ifcType: 'IfcRailing', category: 'Railings' },
  { ifcType: 'IfcCovering', category: 'Coverings' },
  { ifcType: 'IfcFurnishingElement', category: 'Furnishings' },
]

// Fixed construction sequence within one storey — primary structure
// first (Footings must exist before Columns can bear on them, Columns
// before Beams span between them, Beams before the Slab they support can
// be poured, Slab before Walls close in around it), then secondary
// structural members and stairs (go up alongside/soon after primary
// framing), then the envelope closes in roof-first for weathertightness
// before curtain wall/windows/doors, then railings (life-safety, needs
// floor edges/stairs already in place), then interior finishes only once
// enclosed, furnishings last. Drives both scheduleGeneration.ts's
// within-storey relationships and the Review step's own display order.
// Reinforcement (2026-07-15) sits right after Footings — rebar cages go in
// before the pour that encases them, same "before the concrete" position
// real reinforcement takes across footings/walls/slabs alike; a
// first-draft placement, freely reordered per project in the wizard same
// as every other category here.
export const CATEGORY_ORDER: ScheduleCategory[] = [
  'Footings', 'Reinforcement', 'Columns', 'Beams', 'Slabs', 'Walls',
  'Structural Members', 'Stairs', 'Roofs', 'Curtain Walls', 'Windows', 'Doors', 'Railings',
  'Coverings', 'Furnishings',
]

// Purely informational (not a second category axis) — keyword-matched off
// each element's own Name, which for a Revit export already carries real
// assembly/section data (e.g. 'W-Wide Flange:W21X50:...',
// 'Floor:6" Concrete on 3" Metal Deck:...', see this file's own plan doc
// for how this was verified against the real reference file). Surfaced in
// the wizard's Review step so a generated "Columns" activity reads as
// "12 steel columns" rather than an opaque count — not used to split
// categories, since the fixed IFC-type categories above already drive
// sequencing and rates.
export type StructuralMaterial = 'steel' | 'concrete' | 'unknown'

const STEEL_KEYWORDS = ['steel', 'wide flange', 'w-shape', 'w-wide flange', 'hss', 'w1', 'w2', 'w3', 'w4']
const CONCRETE_KEYWORDS = ['concrete', 'cip', 'precast', 'rebar']

function classifyMaterial(name: string): StructuralMaterial {
  const lower = name.toLowerCase()
  if (STEEL_KEYWORDS.some(k => lower.includes(k))) return 'steel'
  if (CONCRETE_KEYWORDS.some(k => lower.includes(k))) return 'concrete'
  return 'unknown'
}

// IfcMember/IfcPlate re-bucketing only (2026-07-14) — unlike
// classifyMaterial above, this DOES split categories, because there's no
// bulk way to tell a curtain-wall mullion/panel apart from a genuine
// structural brace/gusset plate otherwise: web-ifc's only property-set
// read (getElementInfo, ifcModel.ts) is scoped to one element at a time,
// on-demand for the single-selection detail panel — looping it over
// ~1600 IfcMember/IfcPlate instances during extraction would mean ~1600
// extra async WASM round trips, the exact class of unbounded per-element
// work that caused this session's own Resource Tracking "it lags"
// slowdown. Name is already read for every element regardless (the same
// getElementNameAndPredefinedType call this file already makes), so
// keyword-matching it is free where a pset walk would not be. Verified
// against a real file's actual naming, not guessed: a curtain-wall
// mullion inspected live via the app's own Property Sets panel read
// Pset_ProductRequirements.Category = "Curtain Wall Mullions" and was
// named 'Rectangular Mullion:Kalwall_Kalcurve-...'; that file's IfcPlate
// instances were almost entirely glazing panels named like 'Panel de
// sistema:Acristalado:...' (a Spanish-language Revit export — "glazed
// system panel"). Broad and heuristic, not authoritative — an element
// that doesn't match stays in the generic 'Structural Members' bucket,
// visible and schedulable rather than silently dropped or miscategorized.
const CURTAIN_WALL_NAME_KEYWORDS = [
  'mullion', 'curtain wall', 'curtainwall', 'glaz', 'panel de sistema', 'acristalado', 'kalwall', 'storefront',
]

function isCurtainWallMember(name: string): boolean {
  const lower = name.toLowerCase()
  return CURTAIN_WALL_NAME_KEYWORDS.some(k => lower.includes(k))
}

export interface ExtractedElement {
  expressID: number
  globalId: string
  name: string
  ifcType: string
  category: ScheduleCategory
  material: StructuralMaterial
  storeyName: string
  storeyElevation: number | null
  // Length (columns/beams) or area (slabs/footings/walls), in metres or
  // square metres — a bounding-box approximation off the already-loaded
  // mesh, not a certified takeoff. See this module's own plan doc.
  quantity: number
  quantityUnit: 'm' | 'm²'
}

export interface StoreyInfo {
  name: string
  elevationMetres: number | null
}

function collectStoreyNodes(node: IfcTreeNode): IfcTreeNode[] {
  const own = node.type === 'IfcBuildingStorey' ? [node] : []
  return [...own, ...node.children.flatMap(collectStoreyNodes)]
}

function collectLeafExpressIds(node: IfcTreeNode): number[] {
  if (node.children.length === 0) return [node.expressID]
  return node.children.flatMap(collectLeafExpressIds)
}

async function buildStoreyMap(
  ifcModel: typeof import('./ifcModel'),
  handle: IfcModelHandle, tree: IfcTreeNode, toMetres: number,
): Promise<Map<number, StoreyInfo>> {
  const storeyNodes = collectStoreyNodes(tree)
  const byExpressId = new Map<number, StoreyInfo>()
  for (const storeyNode of storeyNodes) {
    const [name, elevationRaw] = await Promise.all([
      ifcModel.getElementName(handle, storeyNode.expressID),
      ifcModel.getElementElevation(handle, storeyNode.expressID),
    ])
    const info: StoreyInfo = {
      name,
      elevationMetres: elevationRaw === null ? null : Number(elevationRaw) * toMetres,
    }
    for (const leafId of collectLeafExpressIds(storeyNode)) byExpressId.set(leafId, info)
  }
  return byExpressId
}

// The mesh(es) tagged with this expressID (a structural element can be
// made of more than one mesh/material island — box the union of all of
// them) — same userData.expressID lookup Viewport3D.tsx uses everywhere,
// just collecting instead of stopping at the first match.
function findMeshesForExpressId(root: THREE.Object3D, expressID: number): THREE.Mesh[] {
  // ensureMaterialized first (2026-07-17) — see elementBatching.ts's own
  // header: materializes every batched piece for this expressID so the
  // traverse below actually finds all of them instead of silently missing
  // whichever pieces were still batched.
  ensureMaterialized(root, expressID)
  const found: THREE.Mesh[] = []
  root.traverse(child => {
    if (child instanceof THREE.Mesh && child.userData.expressID === expressID) found.push(child)
  })
  return found
}

// Length (columns/beams: the box's longest axis) or area (slabs/footings/
// walls: the product of the two largest axes — a slab/footing's footprint,
// or a wall's face area, since the thickness axis is reliably the
// smallest of the three for all of these element types) — one formula
// covers both quantity kinds without needing to know each element's local
// orientation.
function measureElement(
  meshes: THREE.Mesh[], category: ScheduleCategory, toMetres: number,
): { quantity: number; quantityUnit: 'm' | 'm²' } {
  const box = new THREE.Box3()
  for (const mesh of meshes) box.union(new THREE.Box3().setFromObject(mesh))
  const size = box.getSize(new THREE.Vector3()).multiplyScalar(toMetres)
  const dims = [size.x, size.y, size.z].sort((a, b) => b - a)
  if (category === 'Columns' || category === 'Beams') {
    return { quantity: dims[0], quantityUnit: 'm' }
  }
  return { quantity: dims[0] * dims[1], quantityUnit: 'm²' }
}

export type ExtractionProgressCallback = (done: number, total: number) => void

// Bulk per-type expressID queries (one per known IFC type, not one per
// element) + a per-element Name/GlobalId read + a bounding-box
// measurement, chunked every 25 elements to keep the wizard's progress
// bar responsive — mirrors sceneClash.ts's own onProgress +
// setTimeout(resolve, 0) pattern exactly.
export async function extractScheduleElements(
  handle: IfcModelHandle,
  onProgress?: ExtractionProgressCallback,
): Promise<ExtractedElement[]> {
  const ifcModel = await import('./ifcModel')
  const tree = await ifcModel.getSpatialTree(handle)
  const toMetres = ifcModel.getLengthUnitToMetres(handle, tree.expressID)
  const storeyByExpressId = await buildStoreyMap(ifcModel, handle, tree, toMetres)

  const candidates: { expressID: number; category: ScheduleCategory; ifcType: string }[] = []
  for (const { ifcType, category } of IFC_TYPE_CATEGORIES) {
    for (const expressID of ifcModel.getExpressIdsForType(handle, ifcType)) candidates.push({ expressID, category, ifcType })
  }

  const elements: ExtractedElement[] = []
  let done = 0
  for (const { expressID, category: rawCategory, ifcType } of candidates) {
    const [{ name, predefinedType }, globalId] = await Promise.all([
      ifcModel.getElementNameAndPredefinedType(handle, expressID),
      Promise.resolve(ifcModel.getGuidFromExpressId(handle, expressID)),
    ])
    // A Revit-exported IfcSlab with PredefinedType=BASESLAB is a
    // foundation element (pile cap/mat foundation), not a floor slab —
    // verified against the real reference file, where 538 of 612 IfcSlab
    // elements are exactly this (see this module's own plan doc/
    // getElementNameAndPredefinedType's header). Re-bucketed into
    // Footings so it sequences and prices as one, rather than showing up
    // as "Level 1 — Slabs" alongside actual floor slabs. IfcMember/
    // IfcPlate get the same re-bucketing treatment, off Name instead of
    // PredefinedType — see isCurtainWallMember's own header for why.
    const category: ScheduleCategory =
      ifcType === 'IfcSlab' && predefinedType === 'BASESLAB' ? 'Footings'
      : (ifcType === 'IfcMember' || ifcType === 'IfcPlate') && isCurtainWallMember(name) ? 'Curtain Walls'
      : rawCategory
    const meshes = findMeshesForExpressId(handle.object, expressID)
    if (meshes.length > 0 && globalId) {
      const storey = storeyByExpressId.get(expressID)
      const { quantity, quantityUnit } = measureElement(meshes, category, toMetres)
      elements.push({
        expressID, globalId, name, ifcType, category,
        material: classifyMaterial(name),
        storeyName: storey?.name ?? 'Unassigned',
        storeyElevation: storey?.elevationMetres ?? null,
        quantity, quantityUnit,
      })
    }

    done += 1
    if (done % 25 === 0) {
      onProgress?.(done, candidates.length)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }
  onProgress?.(candidates.length, candidates.length)

  return elements
}
