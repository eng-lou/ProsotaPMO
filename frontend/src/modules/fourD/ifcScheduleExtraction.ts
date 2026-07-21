import * as THREE from 'three'
// Type-only — erased at compile time, so this doesn't pull ifcModel.ts's
// runtime code (web-ifc) into whichever chunk statically imports this
// module. The actual functions are dynamic-imported inside
// extractScheduleElements below instead, same idiom FourD.tsx/
// IfcDataPanel.tsx already use everywhere else to keep web-ifc out of the
// main bundle.
import type { IfcModelHandle, IfcTreeNode } from './ifcModel'
import { getExpressIdWorldBounds } from './elementBatching'

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
// MEP + facade-detailing categories (2026-07-17, per Maro — real Snowdon
// Towers HVAC/Electrical/Plumbing/Facades sample files, not guessed) added
// alongside the original 15 structural/architectural ones. Verified against
// those actual files' own STEP text before writing IFC_TYPE_CATEGORIES/the
// keyword tables below — the discipline-specific IFC4 types a naive design
// would reach for (IfcDuctSegment, IfcPipeSegment, IfcCableCarrierSegment,
// ...) don't actually appear in any of them: every MEP element instance
// exports as the generic IfcFlowSegment/IfcFlowFitting/IfcFlowTerminal/
// IfcFlowController family regardless of discipline (duct vs. pipe vs.
// conduit only shows up on the linked *Type object, e.g. IfcDuctSegmentType
// vs IfcPipeSegmentType — not on the instance's own IFC class at all), so
// classification here works the same way Curtain Walls' own IfcMember/
// IfcPlate re-bucketing already does: off each element's real, already-read
// Name (see resolveMepCategory's own header below), not off ifcType alone.
export type ScheduleCategory =
  | 'Foundation' | 'Reinforcement' | 'Columns' | 'Beams' | 'Slabs' | 'Walls'
  | 'Structural Members' | 'Stairs' | 'Roofs' | 'Curtain Walls' | 'Facade Ornamentation' | 'Windows' | 'Doors' | 'Railings'
  | 'Ductwork' | 'Air Terminals' | 'Piping' | 'Plumbing Fixtures'
  | 'Electrical Containment' | 'Lighting' | 'Electrical Devices'
  | 'Coverings' | 'Furnishings' | 'Site & Landscaping'

export const IFC_TYPE_CATEGORIES: { ifcType: string; category: ScheduleCategory }[] = [
  { ifcType: 'IfcFooting', category: 'Foundation' },  // "Foundation" (2026-07-17, per Maro: "Footings is Foundation") — was 'Footings'
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
  // Raw default buckets only, same convention as IfcMember/IfcPlate above —
  // extractScheduleElements re-buckets every one of these off Name via
  // resolveMepCategory below (2026-07-17). Defaults picked as "whichever
  // real discipline was the majority case across the reference files" —
  // dry-run-verified against every real name pattern sampled from all
  // three reference files (not just spot-checked): IfcFlowSegment/
  // IfcFlowTerminal essentially never actually hit this default at all
  // (every real segment/terminal name matched a keyword). IfcFlowFitting
  // does hit it for real, on two fronts that pull in opposite directions —
  // ALL of HVAC's own ~1000 duct fittings ("Round Elbow"/"Rectangular
  // Tee"/"Round Endcap", no literal "duct" in the name) rely on this
  // default to land as Ductwork at all, while a smaller minority of
  // Plumbing's own fittings ("Cap - Generic"/"Elbow - Generic", no PVC/
  // DWV/sanitary marker either) incorrectly inherit the same Ductwork
  // default instead of Piping. Ductwork wins here on volume — the
  // structural-fitting default an earlier version of this comment used
  // instead (a neutral 'Structural Members' catch-all) traded a smaller,
  // already-documented residue for a much larger one. IfcFlowController
  // defaults to Piping for the same reason (valves were the only real
  // IfcFlowController content seen across all three files, already
  // 100% keyword-matched in practice — this default is essentially
  // never hit, same as IfcFlowSegment/IfcFlowTerminal above).
  { ifcType: 'IfcFlowSegment', category: 'Ductwork' },
  { ifcType: 'IfcFlowFitting', category: 'Ductwork' },
  { ifcType: 'IfcFlowTerminal', category: 'Ductwork' },
  { ifcType: 'IfcFlowController', category: 'Piping' },
  { ifcType: 'IfcCovering', category: 'Coverings' },
  { ifcType: 'IfcFurnishingElement', category: 'Furnishings' },
]

// Fixed construction sequence within one storey — primary structure
// first (Foundation must exist before Columns can bear on them, Columns
// before Beams span between them, Beams before the Slab they support can
// be poured, Slab before Walls close in around it), then secondary
// structural members and stairs (go up alongside/soon after primary
// framing), then the envelope closes in roof-first for weathertightness
// before curtain wall/windows/doors — Facade Ornamentation (2026-07-17,
// per Maro: "that's stupid in reality, the architecture especially the
// cladding and external walls etc needs to be fully formed before the
// facade [ornamentation]") sits AFTER Windows/Doors, not right after
// Curtain Walls where an earlier version of this had it — decorative
// trim/cresting/corbels mount onto a wall assembly and its openings that
// already exist, never the reverse. Then MEP rough-in once the floor's own
// envelope and walls exist to run services through, then railings (life-
// safety, needs floor edges/stairs already in place), then interior
// finishes only once enclosed, then MEP trim-out (terminals/fixtures/
// lighting/devices go in once their own rough-in and the finishes they
// mount to both exist), furnishings next-to-last, Site & Landscaping dead
// last (2026-07-17, per Maro: "there are somethings you should leave to
// the final phases like this park benches/canopies/landscaping etc" —
// softscape/hardscape/site furniture is real punch-list-adjacent work,
// done once everything it could get damaged/blocked by already exists).
// Drives both scheduleGeneration.ts's within-storey relationships and the
// Review step's own display order. None of the MEP/Facade Ornamentation/
// Site & Landscaping additions (2026-07-17) are in scheduleGeneration.ts's
// own STRUCTURAL_CATEGORIES — only the floor's own structure gates the
// floor above starting, so this ordering only ever affects sequencing
// *within* one storey, same as every other secondary/finish category here.
// Reinforcement (2026-07-15) sits right after Foundation — rebar cages go in
// before the pour that encases them, same "before the concrete" position
// real reinforcement takes across footings/walls/slabs alike; a
// first-draft placement, freely reordered per project in the wizard same
// as every other category here.
export const CATEGORY_ORDER: ScheduleCategory[] = [
  'Foundation', 'Reinforcement', 'Columns', 'Beams', 'Slabs', 'Walls',
  'Structural Members', 'Stairs', 'Roofs', 'Curtain Walls', 'Windows', 'Doors', 'Facade Ornamentation',
  'Ductwork', 'Piping', 'Electrical Containment', 'Railings', 'Coverings',
  'Air Terminals', 'Plumbing Fixtures', 'Lighting', 'Electrical Devices', 'Furnishings', 'Site & Landscaping',
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

// MEP re-bucketing (2026-07-17) — same reasoning/precedent as
// isCurtainWallMember above (Name already read for free, keyword-matching
// it costs nothing where a per-element pset walk over thousands of Flow*
// instances would), applied to IfcFlowSegment/IfcFlowFitting/
// IfcFlowTerminal/IfcFlowController and IfcBuildingElementProxy — see this
// file's own header on why base ifcType alone can't tell a duct from a
// pipe from a conduit run here.
//
// Matched longest-keyword-first across the WHOLE table, not
// category-by-category in array order (2026-07-17 fix, caught by actually
// dry-running this against every real name pattern sampled from all three
// reference files before shipping it, not just spot-checking a few): a
// bare 'light' would otherwise catch "Lighting and Appliance Panelboard"
// (an electrical panel, not a fixture) and "Lighting Switches" (a device)
// before ever reaching their own, already-present, more specific
// 'panelboard'/'lighting switch' entries below — checking every keyword by
// specificity instead of by which category's array it happens to sit in
// fixes that class of bug generically, not just for these two cases.
// Real cross-discipline collisions still exist and are handled by keyword
// precision instead (e.g. 'water meter' vs 'meter bank'/'meter main' — a
// bare 'meter' would wrongly catch both).
//
// An instance matching nothing here keeps whichever raw IFC_TYPE_CATEGORIES
// default it started with (still visible/schedulable, same "broad and
// heuristic, not authoritative" contract as the curtain-wall case) — a
// small residue is expected (e.g. a handful of genuinely generic "Elbow -
// Generic"/"Cap - Generic" plumbing fittings with no PVC/DWV/sanitary
// marker, or "Round Elbow" itself, ambiguous between a duct and a pipe
// fitting by name alone) and freely re-bucketable by hand afterward.
const MEP_CATEGORY_KEYWORDS: { category: ScheduleCategory; keywords: string[] }[] = [
  { category: 'Ductwork', keywords: ['duct', 'rectangular'] },
  { category: 'Air Terminals', keywords: ['air terminal', 'diffuser', 'grille', 'return grille', 'supply grille'] },
  { category: 'Electrical Containment', keywords: ['conduit', 'cable tray', 'cable basket', 'busway', 'wireway'] },
  { category: 'Lighting', keywords: [
    // 'bollard light', not bare 'bollard' (2026-07-17 fix) — a plain
    // 'bollard' also means a site marker/bollard post (Site & Landscaping
    // below), not a light fixture; the longer, specific phrase avoids that
    // collision instead of relying on match order to sort it out.
    'light', 'lamp', 'sconce', 'chandelier', 'downlight', 'luminaire', 'pendant', 'bollard light',
  ] },
  { category: 'Piping', keywords: [
    'pipe', 'pvc', 'dwv', 'sanitary', 'domesticwater', 'sinkconnection', 'waterclosetconnection',
    'showerconnection', 'washerconnection', 'floor drain', 'roof drain', 'hose bib', 'mopsink', 'floor sink',
    'water heater', 'water meter', 'ball valve', 'gate valve', 'pressure regulating valve', 'buildingconnection',
  ] },
  { category: 'Electrical Devices', keywords: [
    'receptacle', 'panelboard', 'switchboard', 'lighting switch', 'transformer', 'disconnect switch',
    'meter bank', 'meter main', 'data outlet', 'pv battery', 'pv inverter', 'pv panelboard',
    'wiring pull box', 'hand dryer',
  ] },
  { category: 'Facade Ornamentation', keywords: [
    'cresting', 'muntin', 'corbel', 'trim-window', 'trim - window', 'slab edge', 'wall sweep',
    'dentil', 'rope molding', 'key end', 'medallion', 'elliptical arch', 'arch w', 'key pattern',
  ] },
  // Site & Landscaping (2026-07-17, per Maro: "there are somethings you
  // should leave to the final phases like this park benches/canopies/
  // landscaping etc... I dont want to see a tree being placed in while the
  // ground floor is also being worked on" — the real culprit turned out to
  // be classification, not sequencing: a "Tree - Honey-Locust:15' Canopy"
  // element, Pset_ProductRequirements.Category="Planting" per its own
  // Object Information panel, matched nothing here and fell to the raw
  // IfcBuildingElementProxy default, 'Structural Members' — an EARLY
  // category, sequenced right after Beams, which is exactly why it showed
  // up concurrent with early structural work. CATEGORY_ORDER below places
  // this new category dead last, after Furnishings, matching "leave to the
  // final phases" directly — softscape/hardscape/site furniture is real
  // punch-list-adjacent work in practice, done once everything it could
  // get damaged/blocked by is already in place.
  //
  // 'canopy' added standalone (2026-07-17, per Maro: "i dont want to see a
  // flipping canopy in any early phase") — confirmed against the real
  // Architectural file: "AC_Bandstand Canopy" (IfcBuildingElementProxy, a
  // park bandstand's roof structure) matched nothing above either, same
  // 'Structural Members' default, same early-phase bug as the tree canopy
  // — just a literal building canopy this time, not a tree's canopy. A
  // bare 'tree' or 'bench' keyword wouldn't have caught it since the name
  // has neither word in it.
  { category: 'Site & Landscaping', keywords: [
    'tree', 'shrub', 'planting', 'landscap', 'hardscape', 'site furniture', 'bench', 'bollard', 'canopy',
  ] },
]

// Flattened once and sorted longest-first at module load, not per call —
// see MEP_CATEGORY_KEYWORDS' own header for why length order (not category
// array order) is what actually matters here.
const MEP_KEYWORD_ENTRIES: { category: ScheduleCategory; keyword: string }[] =
  MEP_CATEGORY_KEYWORDS
    .flatMap(({ category, keywords }) => keywords.map(keyword => ({ category, keyword })))
    .sort((a, b) => b.keyword.length - a.keyword.length)

const MEP_FAMILY_TYPES: ReadonlySet<string> = new Set([
  'IfcFlowSegment', 'IfcFlowFitting', 'IfcFlowTerminal', 'IfcFlowController', 'IfcBuildingElementProxy',
])

function resolveMepCategory(name: string): ScheduleCategory | null {
  const lower = name.toLowerCase()
  for (const { category, keyword } of MEP_KEYWORD_ENTRIES) {
    if (lower.includes(keyword)) return category
  }
  return null
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


// The only categories a real IfcElementQuantity area is worth reading for
// (2026-07-18) — mirrors scheduleGeneration.ts's own COUNT_BASED set
// exactly (its inverse, for the 4 continuous/area-priced categories), kept
// as its own local list rather than imported from there to avoid a
// circular dependency (scheduleGeneration.ts already imports from this
// module).
const AREA_PRICED_CATEGORIES = new Set<ScheduleCategory>(['Slabs', 'Walls', 'Roofs', 'Coverings'])

// Length (columns/beams: the box's longest axis) or area (slabs/footings/
// walls: the product of the two largest axes — a slab/footing's footprint,
// or a wall's face area, since the thickness axis is reliably the
// smallest of the three for all of these element types) — one formula
// covers both quantity kinds without needing to know each element's local
// orientation. Only ever the fallback now (2026-07-18) — see
// getElementQuantityArea (ifcModel.ts) and AREA_PRICED_CATEGORIES above for
// why a real Qto value is tried first when the file actually has one.
function measureElement(
  box: THREE.Box3, category: ScheduleCategory, toMetres: number,
): { quantity: number; quantityUnit: 'm' | 'm²' } {
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
  // One cheap, synchronous, whole-model check (2026-07-18, per Maro: "yes,
  // then..." on preferring a real IFC quantity over the bounding-box
  // estimate) — if this file has zero IfcElementQuantity entities anywhere
  // (confirmed true for all 6 real Snowdon sample files — a common Revit
  // export gap, "Export base quantities" not enabled), skip the extra
  // per-element property read entirely rather than paying for a lookup
  // that can never succeed.
  const hasQuantitySets = ifcModel.getExpressIdsForType(handle, 'IfcElementQuantity').length > 0

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
    // Foundation so it sequences and prices as one, rather than showing up
    // as "Level 1 — Slabs" alongside actual floor slabs. IfcMember/
    // IfcPlate get the same re-bucketing treatment, off Name instead of
    // PredefinedType — see isCurtainWallMember's own header for why.
    // Every MEP-family instance (2026-07-17) goes through
    // resolveMepCategory the same way — see MEP_CATEGORY_KEYWORDS' own
    // header for why base ifcType alone can't disambiguate a duct from a
    // pipe from a conduit run here; falls back to rawCategory's own raw
    // IFC_TYPE_CATEGORIES default when nothing matches.
    const category: ScheduleCategory =
      ifcType === 'IfcSlab' && predefinedType === 'BASESLAB' ? 'Foundation'
      : (ifcType === 'IfcMember' || ifcType === 'IfcPlate') && isCurtainWallMember(name) ? 'Curtain Walls'
      : MEP_FAMILY_TYPES.has(ifcType) ? (resolveMepCategory(name) ?? rawCategory)
      : rawCategory
    // getExpressIdWorldBounds, not a materializing mesh lookup (2026-07-21
    // perf fix, per Maro: "generating the 4D link... cripples the
    // platform") — see that function's own header in elementBatching.ts.
    // Computes the identical bounding box without ever pulling a batched
    // element out of the shared THREE.BatchedMesh, so generating a schedule
    // no longer permanently un-batches nearly the entire model.
    const box = getExpressIdWorldBounds(handle.object, expressID)
    if (box && globalId) {
      const storey = storeyByExpressId.get(expressID)
      // Real IfcElementQuantity NetArea/GrossArea preferred over the
      // bounding-box estimate (2026-07-18) — only worth checking for the
      // continuous, area-priced categories (scheduleGeneration.ts's own
      // COUNT_BASED set — not importable here without a circular
      // dependency, since that module already imports from this one — so
      // this is the same 4 categories expressed as its own local allow-
      // list instead). Every other category prices by a flat per-element
      // count, so a more accurate area would never be read forward anyway.
      const realArea = hasQuantitySets && AREA_PRICED_CATEGORIES.has(category)
        ? await ifcModel.getElementQuantityArea(handle, expressID)
        : null
      const { quantity, quantityUnit } = realArea !== null
        ? { quantity: realArea, quantityUnit: 'm²' as const }
        : measureElement(box, category, toMetres)
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
