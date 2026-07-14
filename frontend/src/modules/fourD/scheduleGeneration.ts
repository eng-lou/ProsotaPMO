import type { Collection } from './collections'
import { CATEGORY_ORDER, type ExtractedElement, type ScheduleCategory } from './ifcScheduleExtraction'

// IFC Schedule Wizard, step 2 (2026-07-13) — groups a proposed WBS (one
// summary per storey, one child activity per storey+category+construction
// phase), sequences it, and prices durations off editable per-phase
// productivity rates and crew/equipment resources. Pure data functions
// only — this module never talks to the API; the wizard component
// (IfcScheduleWizard.tsx) POSTs the resulting payload to POST
// /api/v1/schedule-bulk-generate/, which persists it in one transaction
// (see schedule_bulk_generate.py's own docstring on the "frontend
// computes, backend just persists" split).
//
// Two ways to arrive at the same StoreyGroup[] shape buildStagedSchedule
// below actually consumes (2026-07-13, per Maro after the automatic scan
// mis-bucketed pile caps as slabs — see ifcScheduleExtraction.ts's own
// PredefinedType fix — and asked for "a controlled way" as a deliberate
// alternative, not just a better auto-classifier):
// - groupByStorey: automatic, off ifcScheduleExtraction.ts's IFC-type scan.
// - groupFromCollections: manual, off a Collections tree the user already
//   organised by hand (Pit > Footings, Level 1 > Columns, ...) — full
//   control when the automatic heuristic isn't good enough for a given
//   file, and not limited to the five structural types either, since a
//   collection can hold anything.

const HOURS_PER_DAY = 8

export interface CategoryRate {
  // A phase's own crew — every phase has one, resource_type='crew'.
  crewName: string
  crewSize: number
  productivityPerCrewDay: number
  unit: 'each' | 'm²'
  // $ per crew-day — becomes the generated crew Resource's own day rate
  // (resource_type='crew', unit='day'), same field compute_assignment_budget
  // (resource_costing.py) already prices any crew/labour/equipment
  // assignment against.
  costPerCrewDay: number
  // Optional — a phase that genuinely needs a piece of plant (excavator,
  // mobile crane, concrete pump) alongside its crew (2026-07-13, per Maro:
  // "add more detail... more resources, realistic, equipment etc.").
  // resource_type='equipment', assigned to the same activity as the crew,
  // priced the same $/day way — doesn't independently drive duration
  // (the crew's own productivity rate does), matching how this app already
  // treats crew/labour/equipment identically in resource_costing.py.
  equipmentName?: string
  equipmentCostPerDay?: number
}

// One real construction step within a category (2026-07-13, per Maro: "add
// more detail to the schedule") — a single "Level 1 — Columns" activity
// used to stand in for the whole trade; this instead sequences the actual
// steps a PM would put on a schedule (excavate -> formwork/rebar -> pour
// -> strip, or erect -> bolt/weld for steel), each with its own crew,
// optional equipment, and productivity rate, freely editable in the
// wizard's Rates & Crews step same as before.
export interface CategoryPhase {
  key: string
  label: string
  rate: CategoryRate
}

// Typical-industry ballpark figures, deliberately not sourced from any one
// project's real historical productivity data (none exists yet for this
// app) — reviewed and freely edited in the wizard's own Rates & Crews step
// before anything commits, per Maro's confirmed "editable defaults"
// choice. Not used for any EVM/cost-baseline calculation on their own —
// only to seed a first-draft duration, same as any other schedule.
//
// Crew/equipment *names* are deliberately reused across categories where a
// real project would genuinely reuse the same resource (buildStagedSchedule
// dedupes resources by name, not by category) — one steel erection crew
// and mobile crane does Columns then Beams; one concrete pour crew and
// pump truck services Footings, Slabs, and Walls in turn — rather than
// inventing a separate crew per category that would just sit idle most of
// the schedule.
export const DEFAULT_CATEGORY_PHASES: Record<ScheduleCategory, CategoryPhase[]> = {
  // Footings' own rates are calibrated for *small, repetitive* footings —
  // pile caps especially, which a real IFC file can easily have hundreds
  // of concentrated on one or two storeys (2026-07-13, per Maro: a
  // 538-pile-cap storey at the original 3/day Excavate rate alone produced
  // a 179-day activity — traced by hand, the arithmetic was internally
  // correct, the *rate* just assumed a handful of custom spread footings,
  // not hundreds of near-identical small pours). These are still a single
  // crew's own throughput, not multiple parallel crews — freely edited in
  // the wizard's own Rates & Crews step either way.
  Footings: [
    { key: 'excavate', label: 'Excavate & Prep', rate: {
      crewName: 'Excavation Crew', crewSize: 4, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 1100,
      equipmentName: 'Excavator (Mini)', equipmentCostPerDay: 600,
    } },
    { key: 'formwork_rebar', label: 'Formwork & Rebar', rate: {
      crewName: 'Footings Formwork Crew', crewSize: 5, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1400,
    } },
    { key: 'pour', label: 'Pour Concrete', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 4, productivityPerCrewDay: 18, unit: 'each', costPerCrewDay: 1200,
      equipmentName: 'Concrete Pump Truck', equipmentCostPerDay: 900,
    } },
    { key: 'strip', label: 'Strip Formwork', rate: {
      crewName: 'Footings Formwork Crew', crewSize: 3, productivityPerCrewDay: 25, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  Columns: [
    { key: 'erect', label: 'Erect Steel Columns', rate: {
      crewName: 'Steel Erection Crew', crewSize: 6, productivityPerCrewDay: 6, unit: 'each', costPerCrewDay: 2400,
      equipmentName: 'Mobile Crane (50t)', equipmentCostPerDay: 1500,
    } },
    { key: 'bolt', label: 'Bolt & Align', rate: {
      crewName: 'Ironworker Crew', crewSize: 4, productivityPerCrewDay: 10, unit: 'each', costPerCrewDay: 1600,
    } },
  ],
  Beams: [
    { key: 'erect', label: 'Erect Steel Beams', rate: {
      crewName: 'Steel Erection Crew', crewSize: 6, productivityPerCrewDay: 8, unit: 'each', costPerCrewDay: 2400,
      equipmentName: 'Mobile Crane (50t)', equipmentCostPerDay: 1500,
    } },
    { key: 'bolt_weld', label: 'Bolt & Weld Connections', rate: {
      crewName: 'Ironworker Crew', crewSize: 4, productivityPerCrewDay: 8, unit: 'each', costPerCrewDay: 1600,
    } },
  ],
  Slabs: [
    { key: 'deck_rebar', label: 'Install Metal Deck & Rebar', rate: {
      crewName: 'Slab Crew', crewSize: 6, productivityPerCrewDay: 200, unit: 'm²', costPerCrewDay: 1800,
    } },
    { key: 'pour', label: 'Pour Concrete', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 8, productivityPerCrewDay: 300, unit: 'm²', costPerCrewDay: 2000,
      equipmentName: 'Concrete Pump Truck', equipmentCostPerDay: 900,
    } },
    { key: 'finish', label: 'Cure & Finish', rate: {
      crewName: 'Concrete Finishing Crew', crewSize: 4, productivityPerCrewDay: 400, unit: 'm²', costPerCrewDay: 1200,
    } },
  ],
  Walls: [
    { key: 'formwork_rebar', label: 'Erect Formwork & Rebar', rate: {
      crewName: 'Wall Formwork Crew', crewSize: 5, productivityPerCrewDay: 60, unit: 'm²', costPerCrewDay: 1800,
    } },
    { key: 'pour', label: 'Pour Concrete', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 5, productivityPerCrewDay: 80, unit: 'm²', costPerCrewDay: 1200,
      equipmentName: 'Concrete Pump Truck', equipmentCostPerDay: 900,
    } },
    { key: 'strip', label: 'Strip Formwork', rate: {
      crewName: 'Wall Formwork Crew', crewSize: 4, productivityPerCrewDay: 100, unit: 'm²', costPerCrewDay: 1000,
    } },
  ],
  // Architectural categories, added 2026-07-14 (per Maro, after pointing
  // the wizard at a real steel+architectural Revit export: "not just
  // structural now, this new model is also architectural"). Same
  // "editable defaults, not a certified takeoff" contract as the
  // structural table above — these have zero historical productivity
  // data behind them (nothing this app-specific exists yet), so they're
  // pure industry-ballpark figures, reviewed and freely edited in the
  // wizard's own Rates & Crews step same as every other phase. Crew names
  // are reused across categories where a real project genuinely reuses
  // the trade (Ironworker Crew/Steel Erection Crew/Mobile Crane (50t) —
  // same rationale as the structural table's own header).
  'Structural Members': [
    { key: 'install', label: 'Install Secondary Members', rate: {
      crewName: 'Ironworker Crew', crewSize: 4, productivityPerCrewDay: 12, unit: 'each', costPerCrewDay: 1600,
    } },
  ],
  Stairs: [
    { key: 'erect', label: 'Erect Stair Structure', rate: {
      crewName: 'Steel Erection Crew', crewSize: 4, productivityPerCrewDay: 1, unit: 'each', costPerCrewDay: 2400,
      equipmentName: 'Mobile Crane (50t)', equipmentCostPerDay: 1500,
    } },
    { key: 'finish', label: 'Install Treads, Rails & Finishes', rate: {
      crewName: 'Finishing Crew', crewSize: 3, productivityPerCrewDay: 1, unit: 'each', costPerCrewDay: 1200,
    } },
  ],
  Roofs: [
    { key: 'deck', label: 'Install Roof Deck', rate: {
      crewName: 'Roofing Crew', crewSize: 5, productivityPerCrewDay: 300, unit: 'm²', costPerCrewDay: 1800,
    } },
    { key: 'waterproof', label: 'Waterproof & Membrane', rate: {
      crewName: 'Roofing Crew', crewSize: 4, productivityPerCrewDay: 400, unit: 'm²', costPerCrewDay: 1500,
    } },
    { key: 'finish', label: 'Roofing Finish', rate: {
      crewName: 'Roofing Crew', crewSize: 4, productivityPerCrewDay: 500, unit: 'm²', costPerCrewDay: 1300,
    } },
  ],
  'Curtain Walls': [
    { key: 'frame', label: 'Install Mullions & Frames', rate: {
      crewName: 'Glazing Crew', crewSize: 4, productivityPerCrewDay: 30, unit: 'each', costPerCrewDay: 1600,
      equipmentName: 'Scissor Lift', equipmentCostPerDay: 400,
    } },
    { key: 'glaze', label: 'Glaze Panels', rate: {
      crewName: 'Glazing Crew', crewSize: 4, productivityPerCrewDay: 25, unit: 'each', costPerCrewDay: 1400,
      equipmentName: 'Scissor Lift', equipmentCostPerDay: 400,
    } },
  ],
  Windows: [
    { key: 'install', label: 'Install Windows', rate: {
      crewName: 'Glazing Crew', crewSize: 3, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1200,
    } },
  ],
  Doors: [
    { key: 'install', label: 'Install Doors & Hardware', rate: {
      crewName: 'Door Installation Crew', crewSize: 2, productivityPerCrewDay: 12, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  Railings: [
    { key: 'install', label: 'Install Railings', rate: {
      crewName: 'Railing Crew', crewSize: 2, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  // Single generic phase for v1 — no floor/wall/ceiling split (would need
  // each element's own PredefinedType, already read for free alongside
  // Name, but deferred to keep this pass scoped — see this module's own
  // plan doc).
  Coverings: [
    { key: 'install', label: 'Install Interior Finishes', rate: {
      crewName: 'Finishing Crew', crewSize: 5, productivityPerCrewDay: 150, unit: 'm²', costPerCrewDay: 1600,
    } },
  ],
  Furnishings: [
    { key: 'install', label: 'Install Furnishings & Fixtures', rate: {
      crewName: 'Furnishing Crew', crewSize: 3, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 1100,
    } },
  ],
}

// A generic single-phase fallback for a Collections-derived category with
// no name match against the known categories above — always count-based
// (a hand-built collection carries no length/area metadata the way an
// IFC-type scan's own bounding-box measurement does). Same "editable
// defaults" contract either way.
export function genericCategoryPhases(name: string): CategoryPhase[] {
  return [{
    key: 'work', label: name,
    rate: { crewName: `${name} Crew`, crewSize: 4, productivityPerCrewDay: 5, unit: 'each', costPerCrewDay: 1500 },
  }]
}

// Resolves a category name to its real construction-phase breakdown —
// the fixed table above for an exact (case-insensitive) name match
// (covers both the automatic scan's own fixed ScheduleCategory names, and
// a hand-built Collection a user happened to name "Footings"/"Columns"/
// "Curtain Walls"/etc.), the generic single-phase fallback otherwise.
export function resolvePhases(categoryName: string): CategoryPhase[] {
  const matched = (Object.keys(DEFAULT_CATEGORY_PHASES) as ScheduleCategory[])
    .find(k => k.toLowerCase() === categoryName.toLowerCase())
  return matched ? DEFAULT_CATEGORY_PHASES[matched] : genericCategoryPhases(categoryName)
}

export interface CategoryGroup {
  name: string
  elementRefs: string[]
  quantity: number
}
export interface StoreyGroup {
  storeyName: string
  // Already in the order categories should be sequenced within this
  // storey — CATEGORY_ORDER for the automatic path, each collection's own
  // sort_order for the controlled one.
  categories: CategoryGroup[]
}

// Discrete members (footings/columns/beams, and the architectural
// categories added 2026-07-14 below) are counted — "installed per
// crew-day" reads far more naturally to a PM reviewing this than an
// area/weight figure, and needs no extra data this app doesn't have (e.g.
// steel tonnage, which would need parsing AISC section designations out
// of each element's own Name — deferred unless actually asked for).
// Continuous elements (slabs/walls/roofs/coverings) are priced by area,
// summed from ifcScheduleExtraction.ts's own per-element bounding-box
// quantity.
const COUNT_BASED: ReadonlySet<ScheduleCategory> = new Set([
  'Footings', 'Columns', 'Beams',
  'Structural Members', 'Stairs', 'Curtain Walls', 'Windows', 'Doors', 'Railings', 'Furnishings',
])

// One group per storey, bottom-up by elevation (storeys with an unknown
// elevation sort last rather than crashing the ordering — same "don't
// guess, degrade gracefully" rule ifcModel.ts's own unit-conversion
// fallback follows).
export function groupByStorey(elements: ExtractedElement[]): StoreyGroup[] {
  interface Bucket { storeyName: string; elevationMetres: number | null; categories: Map<ScheduleCategory, { elementRefs: string[]; quantity: number }> }
  const byStorey = new Map<string, Bucket>()
  for (const el of elements) {
    let group = byStorey.get(el.storeyName)
    if (!group) { group = { storeyName: el.storeyName, elevationMetres: el.storeyElevation, categories: new Map() }; byStorey.set(el.storeyName, group) }
    let bucket = group.categories.get(el.category)
    if (!bucket) { bucket = { elementRefs: [], quantity: 0 }; group.categories.set(el.category, bucket) }
    bucket.elementRefs.push(el.globalId)
    bucket.quantity += COUNT_BASED.has(el.category) ? 1 : el.quantity
  }
  return [...byStorey.values()]
    .sort((a, b) => {
      const ea = a.elevationMetres ?? Number.POSITIVE_INFINITY
      const eb = b.elevationMetres ?? Number.POSITIVE_INFINITY
      return ea !== eb ? ea - eb : a.storeyName.localeCompare(b.storeyName)
    })
    .map(group => ({
      storeyName: group.storeyName,
      categories: CATEGORY_ORDER
        .filter(c => group.categories.has(c))
        .map(c => ({ name: c, ...group.categories.get(c)! })),
    }))
}

// The "controlled way" (2026-07-13, per Maro: "I can take the time to
// create collections and sub collections... then with that you can
// generate the schedule") — a top-level Collection is a storey, its own
// direct child Collections are that storey's categories, in the order
// Maro organised them (Collection.sort_order, same field its own "Move
// to…" UI already sets — see collection.py's own docstring on why there's
// no separate drag-reorder yet). Only IFC-kind members are linkable
// (ModelElementLink's own source_kind='ifc' below) — mesh-kind members are
// skipped, surfaced via `warnings` rather than silently dropped. A
// top-level collection's own *direct* members (not organised into a
// sub-collection) land in a synthetic "(ungrouped)" category rather than
// being silently lost either.
export function groupFromCollections(collections: Collection[]): { storeys: StoreyGroup[]; warnings: string[] } {
  const warnings: string[] = []
  const byParent = new Map<string | null, Collection[]>()
  for (const c of collections) {
    const key = c.parent_collection_id
    const list = byParent.get(key)
    if (list) list.push(c)
    else byParent.set(key, [c])
  }
  const sortCollections = (list: Collection[]) =>
    [...list].sort((a, b) => (a.sort_order ?? Number.POSITIVE_INFINITY) - (b.sort_order ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name))

  const toCategoryGroup = (c: Collection): CategoryGroup | null => {
    const refs = c.members.filter(m => m.source_kind === 'ifc').map(m => m.element_ref)
    const skipped = c.members.length - refs.length
    if (skipped > 0) warnings.push(`"${c.name}" — ${skipped} non-IFC member(s) skipped (not supported by this wizard yet)`)
    if (refs.length === 0) return null
    return { name: c.name, elementRefs: refs, quantity: refs.length }
  }

  const storeys: StoreyGroup[] = []
  for (const storeyCollection of sortCollections(byParent.get(null) ?? [])) {
    const children = sortCollections(byParent.get(storeyCollection.id) ?? [])
    const categories = children.map(toCategoryGroup).filter((g): g is CategoryGroup => g !== null)
    const ownGroup = toCategoryGroup(storeyCollection)
    if (ownGroup) {
      warnings.push(`"${storeyCollection.name}" has its own directly-assigned elements outside any sub-collection — grouped as "(ungrouped)"`)
      categories.push({ ...ownGroup, name: '(ungrouped)' })
    }
    if (categories.length > 0) storeys.push({ storeyName: storeyCollection.name, categories })
  }
  return { storeys, warnings }
}

// Whole multiples of HOURS_PER_DAY only, never a fractional/.5-hour
// duration (2026-07-13, per Maro: "i think its because you have some
// durations in .5 or decimals. dont do that" — whole-day scheduling is
// now every calendar's own default, so a generated activity's own
// duration_hours should already be whole-day-aligned going in, not just
// rely on the CPM engine to round it at schedule time; the two would
// otherwise disagree on "how many days is this" whenever the raw quantity/
// rate math didn't happen to divide evenly).
function computeDurationHours(quantity: number, rate: CategoryRate): number {
  if (rate.productivityPerCrewDay <= 0 || rate.crewSize <= 0) return HOURS_PER_DAY
  const days = Math.max(1, Math.ceil(quantity / rate.productivityPerCrewDay))
  return days * HOURS_PER_DAY
}

export interface StagedActivity {
  temp_id: string
  task_name: string
  parent_temp_id: string | null
  duration_hours: number
  element_refs: string[]
}
export interface StagedResource {
  temp_id: string
  name: string
  resource_type: 'crew' | 'equipment'
  unit: string
  rate: number
  max_hours_per_day: number
}
export interface StagedAssignment {
  activity_temp_id: string
  resource_temp_id: string
  utilisation_pct: number
}
export interface StagedRelationship {
  predecessor_temp_id: string
  successor_temp_id: string
  relationship_type: 'FS'
  lag_hours: number
}
export interface StagedSchedule {
  project_id: string
  schedule_period_id: string
  // Applied to every generated activity (2026-07-13, per Maro: "prompt the
  // user to pick the calendar they want... by default the standard
  // calendar") — null means "inherit the project's own default calendar",
  // same fallback Activity.calendar_id already means everywhere else.
  calendar_id: string | null
  activities: StagedActivity[]
  resources: StagedResource[]
  assignments: StagedAssignment[]
  relationships: StagedRelationship[]
}

// Summary stats shown in the wizard's Extract/Review steps — element +
// activity + resource counts, cheap to derive from the same staged
// payload so the UI never needs a second pass over the raw elements.
export interface ProposedScheduleSummary {
  storeyCount: number
  activityCount: number
  resourceCount: number
  relationshipCount: number
  elementCount: number
}

// One row of the wizard's Rates & Crews table — a (category, phase) pair,
// carrying its own editable CategoryRate. Keyed by "category::phaseKey" so
// two different categories can each have their own "pour" phase without
// colliding in the wizard's own rates state.
export interface PhaseRow {
  id: string
  category: string
  phase: CategoryPhase
}

export function phaseRowId(category: string, phaseKey: string): string {
  return `${category}::${phaseKey}`
}

// Every distinct category name across all storeys, in first-seen order —
// the wizard's own Extract-step summary ("Found N elements: X Columns, Y
// Beams...") counts by plain category, not by phase.
export function usedCategoryNames(storeys: StoreyGroup[]): string[] {
  const seen = new Set<string>()
  for (const storey of storeys) for (const category of storey.categories) seen.add(category.name)
  return [...seen]
}

// Every (category, phase) combination actually present across all
// storeys, in first-seen order — what the wizard's Rates & Crews step
// renders one row per.
export function usedPhaseRows(storeys: StoreyGroup[]): PhaseRow[] {
  const seen = new Set<string>()
  const rows: PhaseRow[] = []
  for (const storey of storeys) {
    for (const category of storey.categories) {
      for (const phase of resolvePhases(category.name)) {
        const id = phaseRowId(category.name, phase.key)
        if (seen.has(id)) continue
        seen.add(id)
        rows.push({ id, category: category.name, phase })
      }
    }
  }
  return rows
}

export function buildStagedSchedule(
  projectId: string, schedulePeriodId: string, storeys: StoreyGroup[], rates: Record<string, CategoryRate>,
  rootName: string, calendarId: string | null,
): { staged: StagedSchedule; summary: ProposedScheduleSummary } {
  const activities: StagedActivity[] = []
  const relationships: StagedRelationship[] = []
  let elementCount = 0
  // storey index -> every phase activity temp_id generated for that storey,
  // in sequence order — the between-storey link below connects the last
  // one here to the first one of the next storey (a generic "this storey's
  // last trade feeds the next storey's first" rule, not hardcoded to
  // Slabs->Columns — works for both the fixed structural CATEGORY_ORDER
  // and an arbitrary Collections-driven category sequence alike).
  const phaseTempIdsByStorey: string[][] = []

  // One root WBS summary named after the source model, parenting every
  // storey (2026-07-13, per Maro: "PIT, Level 1... implying wbs like PIT,
  // Level 1 are individual projects" — each storey landed as its own
  // top-level root with no shared parent, reading as N separate
  // mini-projects rather than one building's WBS). Everything this
  // function generates nests under this single node; anything already in
  // the schedule period before this run (a stray pre-existing activity,
  // for instance) is untouched, since this function only ever adds new
  // rows, never reparents existing ones.
  const rootTempId = 'wbs-root'
  activities.push({ temp_id: rootTempId, task_name: rootName, parent_temp_id: null, duration_hours: 0, element_refs: [] })

  // One resource per (phase-row, crew|equipment) — shared across every
  // storey that phase touches (the same Steel Erection Crew visits every
  // storey's Columns phase, not a fresh crew each floor), but deliberately
  // NOT shared across two *different* phase rows even when they happen to
  // carry the same name (e.g. Columns' own "Steel Erection Crew" and
  // Beams' own, same display name by design — see DEFAULT_CATEGORY_PHASES'
  // own header on realistic reuse). An earlier version deduped by raw name
  // instead: whichever phase's rate got processed first silently became
  // the resource's own cost/crew size, and editing a *different* phase row
  // sharing that name in the wizard's Rates & Crews table had no visible
  // effect at all — a real bug (2026-07-13, per Maro: "the resources...
  // now the issue is multiplied because of the increased resource
  // detail"). Keying by phase-row id instead makes every row's own edits
  // land on its own resource, unambiguously, every time.
  //
  // That fix's own side effect, caught the same day from Maro's exported
  // Resource Pool: multiple genuinely-distinct resources sharing one plain
  // display name (three "Concrete Pour Crew" rows at 1200/2000/1200,
  // "Footings Formwork Crew" at 900/1400, ...) reads exactly like
  // accidental duplication in the Resource Pool list, since nothing
  // visually distinguishes them. Resolved here: a base name used by more
  // than one distinct phase-row gets its owning category *and* phase
  // suffixed on — "Concrete Pour Crew (Footings — Pour Concrete)",
  // "Concrete Pour Crew (Slabs — Pour Concrete)", ... — category alone
  // isn't always enough (Footings' own "Formwork & Rebar" and "Strip
  // Formwork" phases both reuse "Footings Formwork Crew" *within the same
  // category*, so two rows suffixed with just "(Footings)" would still
  // look identical) but a phase label is always unique per row. A name
  // only ever used by a single phase-row (Slab Crew, Excavator (Mini),
  // ...) stays exactly as typed.
  const phaseRows = usedPhaseRows(storeys)
  const nameUsers = new Map<string, Set<string>>()  // base name -> set of phase-row ids using it
  for (const row of phaseRows) {
    const rate = rates[row.id] ?? row.phase.rate
    for (const name of [rate.crewName, rate.equipmentName].filter((n): n is string => !!n)) {
      const users = nameUsers.get(name) ?? new Set<string>()
      users.add(row.id)
      nameUsers.set(name, users)
    }
  }
  // Category alone isn't always enough to disambiguate — Footings' own
  // "Formwork & Rebar" and "Strip Formwork" phases both reuse "Footings
  // Formwork Crew" *within the same category*, so two collision members
  // suffixed with just "(Footings)" would still read as identical
  // duplicates. The phase label is always unique per phase-row, so it's
  // used instead whenever the category alone wouldn't be enough.
  const displayName = (baseName: string, category: string, phaseLabel: string): string => {
    const users = nameUsers.get(baseName)?.size ?? 0
    if (users <= 1) return baseName
    return `${baseName} (${category} — ${phaseLabel})`
  }

  const resourceTempIdByKey = new Map<string, string>()
  const resources: StagedResource[] = []
  const getOrCreateResource = (key: string, name: string, type: 'crew' | 'equipment', costPerDay: number): string => {
    const existing = resourceTempIdByKey.get(key)
    if (existing) return existing
    const tempId = `res-${resources.length}`
    resourceTempIdByKey.set(key, tempId)
    resources.push({ temp_id: tempId, name, resource_type: type, unit: 'day', rate: costPerDay, max_hours_per_day: HOURS_PER_DAY })
    return tempId
  }

  const assignments: StagedAssignment[] = []

  storeys.forEach((storey, storeyIndex) => {
    const wbsTempId = `wbs-storey-${storeyIndex}`
    activities.push({ temp_id: wbsTempId, task_name: storey.storeyName, parent_temp_id: rootTempId, duration_hours: 0, element_refs: [] })

    const phaseTempIds: string[] = []
    let previousTempId: string | null = null
    storey.categories.forEach((category, categoryIndex) => {
      elementCount += category.elementRefs.length
      const phases = resolvePhases(category.name)
      phases.forEach((phase, phaseIndex) => {
        const rate = rates[phaseRowId(category.name, phase.key)] ?? phase.rate
        const tempId = `act-${storeyIndex}-${categoryIndex}-${phaseIndex}`
        activities.push({
          temp_id: tempId,
          task_name: `${storey.storeyName} — ${category.name} — ${phase.label}`,
          parent_temp_id: wbsTempId,
          duration_hours: computeDurationHours(category.quantity, rate),
          // Elements "appear" at their category's completion phase, not
          // every intermediate step — avoids the same IFC elements being
          // linked to N separate activities for one physical installation.
          element_refs: phaseIndex === phases.length - 1 ? category.elementRefs : [],
        })
        phaseTempIds.push(tempId)
        if (previousTempId) {
          relationships.push({ predecessor_temp_id: previousTempId, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
        }
        previousTempId = tempId

        const rowId = phaseRowId(category.name, phase.key)
        const crewTempId = getOrCreateResource(
          `${rowId}::crew`, displayName(rate.crewName, category.name, phase.label), 'crew', rate.costPerCrewDay,
        )
        assignments.push({ activity_temp_id: tempId, resource_temp_id: crewTempId, utilisation_pct: 100 })
        if (rate.equipmentName) {
          const equipmentTempId = getOrCreateResource(
            `${rowId}::equipment`, displayName(rate.equipmentName, category.name, phase.label), 'equipment', rate.equipmentCostPerDay ?? 0,
          )
          assignments.push({ activity_temp_id: tempId, resource_temp_id: equipmentTempId, utilisation_pct: 100 })
        }
      })
    })
    phaseTempIdsByStorey.push(phaseTempIds)
  })

  for (let i = 0; i < phaseTempIdsByStorey.length - 1; i++) {
    const thisStoreyIds = phaseTempIdsByStorey[i]
    const fromLast = thisStoreyIds[thisStoreyIds.length - 1]
    const toFirst = phaseTempIdsByStorey[i + 1][0]
    if (fromLast && toFirst) {
      relationships.push({ predecessor_temp_id: fromLast, successor_temp_id: toFirst, relationship_type: 'FS', lag_hours: 0 })
    }
  }

  return {
    staged: { project_id: projectId, schedule_period_id: schedulePeriodId, calendar_id: calendarId, activities, resources, assignments, relationships },
    summary: {
      storeyCount: storeys.length,
      activityCount: activities.length,
      resourceCount: resources.length,
      relationshipCount: relationships.length,
      elementCount,
    },
  }
}
