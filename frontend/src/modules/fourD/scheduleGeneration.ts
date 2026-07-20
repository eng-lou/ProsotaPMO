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
// groupByStorey below builds the StoreyGroup[] shape buildStagedSchedule
// consumes, off ifcScheduleExtraction.ts's automatic IFC-type scan. (A
// second grouping path, groupFromCollections — off a hand-curated
// Collections tree instead, added 2026-07-13 for "a controlled way" around
// a since-fixed mis-bucketing case — existed through 2026-07-19 and was
// removed per Maro; see git history if it ever needs resurrecting.)

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
  // "Foundation" (2026-07-17, per Maro: "Footings is Foundation") — was
  // 'Footings'; still IfcFooting-sourced, same phases/rates, renamed only.
  Foundation: [
    { key: 'excavate', label: 'Excavate & Prep', rate: {
      crewName: 'Excavation Crew', crewSize: 4, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 1100,
      equipmentName: 'Excavator (Mini)', equipmentCostPerDay: 600,
    } },
    { key: 'formwork_rebar', label: 'Formwork & Rebar', rate: {
      crewName: 'Foundation Formwork Crew', crewSize: 5, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1400,
    } },
    { key: 'pour', label: 'Pour Concrete', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 4, productivityPerCrewDay: 18, unit: 'each', costPerCrewDay: 1200,
      equipmentName: 'Concrete Pump Truck', equipmentCostPerDay: 900,
    } },
    { key: 'strip', label: 'Strip Formwork', rate: {
      crewName: 'Foundation Formwork Crew', crewSize: 3, productivityPerCrewDay: 25, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  // Individual rebar bars/mesh sheets (2026-07-15, per Maro, after a real
  // structural export's "Select Unassigned" turned up 149 of these with no
  // category at all — see ifcScheduleExtraction.ts's own header on why
  // this is its own category rather than folded into whichever pour each
  // bar belongs to) — a single generic placement phase, count-based like
  // Footings/Columns/Beams (a bar is a discrete countable thing, not an
  // area), same "editable defaults, not a certified takeoff" contract.
  Reinforcement: [
    { key: 'place', label: 'Place Reinforcement', rate: {
      crewName: 'Rebar Crew', crewSize: 4, productivityPerCrewDay: 150, unit: 'each', costPerCrewDay: 1400,
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
  // MEP + facade-detailing categories (2026-07-17, per Maro — real Snowdon
  // Towers HVAC/Electrical/Plumbing/Facades sample files). Typical-industry
  // ballpark figures same as every other category's own header already
  // says — reviewed and freely edited in the wizard's own Rates & Crews
  // step before anything commits, not sourced from any project's real
  // historical data (none exists yet for MEP in this app any more than it
  // did for structural). Rough-in (Ductwork/Piping/Electrical Containment)
  // and trim-out (Air Terminals/Plumbing Fixtures/Lighting/Electrical
  // Devices) are deliberately separate categories, not phases of one — see
  // CATEGORY_ORDER's own header (ifcScheduleExtraction.ts) for why they
  // sit apart in the sequence (trim-out happens after Coverings, once
  // rough-in and the finishes it mounts to both exist).
  'Facade Ornamentation': [
    { key: 'install', label: 'Install Facade Ornamentation & Trim', rate: {
      crewName: 'Ornamental Trim Crew', crewSize: 3, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1300,
      equipmentName: 'Scissor Lift', equipmentCostPerDay: 400,
    } },
  ],
  Ductwork: [
    { key: 'install', label: 'Install Ductwork', rate: {
      crewName: 'HVAC Ductwork Crew', crewSize: 4, productivityPerCrewDay: 25, unit: 'each', costPerCrewDay: 1400,
      equipmentName: 'Scissor Lift', equipmentCostPerDay: 400,
    } },
  ],
  'Air Terminals': [
    { key: 'install', label: 'Install Air Terminals & Diffusers', rate: {
      crewName: 'HVAC Trim Crew', crewSize: 2, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  Piping: [
    { key: 'install', label: 'Install Piping & Valves', rate: {
      crewName: 'Plumbing Piping Crew', crewSize: 3, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 1300,
    } },
  ],
  'Plumbing Fixtures': [
    { key: 'install', label: 'Install Plumbing Fixtures', rate: {
      crewName: 'Plumbing Trim Crew', crewSize: 2, productivityPerCrewDay: 12, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  'Electrical Containment': [
    { key: 'install', label: 'Install Conduit & Containment', rate: {
      crewName: 'Electrical Rough-In Crew', crewSize: 3, productivityPerCrewDay: 25, unit: 'each', costPerCrewDay: 1200,
    } },
  ],
  Lighting: [
    { key: 'install', label: 'Install Light Fixtures', rate: {
      crewName: 'Electrical Trim Crew', crewSize: 2, productivityPerCrewDay: 20, unit: 'each', costPerCrewDay: 900,
    } },
  ],
  'Electrical Devices': [
    { key: 'install', label: 'Install Electrical Devices & Equipment', rate: {
      crewName: 'Electrical Trim Crew', crewSize: 2, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1000,
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
  // Dead last in CATEGORY_ORDER (2026-07-17, per Maro — see that array's
  // own header) — trees/benches/site furniture, done once everything they
  // could get damaged/blocked by already exists.
  'Site & Landscaping': [
    { key: 'install', label: 'Install Site & Landscaping', rate: {
      crewName: 'Landscaping Crew', crewSize: 3, productivityPerCrewDay: 15, unit: 'each', costPerCrewDay: 1000,
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

export interface ResourceRecipeActivity {
  id: string
  schedule_category: string | null
  schedule_phase_key: string | null
}
export interface ResourceRecipeResource {
  temp_id: string
  name: string
  resource_type: 'crew' | 'equipment'
  unit: string
  rate: number
}
export interface ResourceRecipeAssignment {
  activity_id: string
  resource_temp_id: string
  utilisation_pct: number
}

// Reusable by the Scheduling module's own Resources tab — "Generate
// Resources" (resources only, populates the pool for review/editing) and
// "Auto Assign Resources" (resources + assignments, links the pool to the
// already-committed IFC-generated activities), both 2026-07-17 per Maro's
// two-stage flow ("first stage generate resources - this populates the
// resource pool. user can then edit etc. once satisfied (Auto Assign
// resources) which links the resource pool to the activities"). Walks the
// exact same DEFAULT_CATEGORY_PHASES/resolvePhases rate table
// buildStagedSchedule itself used to size a phase's own duration_hours (see
// computeDurationHours above) back when schedule generation still created
// resources inline — a crew/equipment recipe built here after the fact
// always matches what would have been generated in that same original pass,
// off nothing but each activity's own persisted schedule_category/
// schedule_phase_key (Activity columns, see StagedActivity.category's own
// header on why those exist at all). Only activities with a
// schedule_category are considered — a synthetic WBS/root/milestone node
// never has one (this module never sets it for those), so this naturally
// only ever touches real generated work, matching the Discipline UDF's own
// "tasks only, never WBS" rule.
//
// Dedupes resources by name across every activity (same "one steel
// erection crew and mobile crane does Columns then Beams" reasoning
// DEFAULT_CATEGORY_PHASES' own header already documents) — the caller
// (Scheduling.tsx) additionally passes dedupe_resources_by_name to the
// bulk-generate endpoint so re-running this against a project that already
// has some of these resources reuses them by name rather than creating
// duplicates.
export function buildResourceRecipe(activities: ResourceRecipeActivity[]): {
  resources: ResourceRecipeResource[]
  assignments: ResourceRecipeAssignment[]
} {
  const resourceByName = new Map<string, ResourceRecipeResource>()
  const assignments: ResourceRecipeAssignment[] = []
  let nextTempId = 0

  const tempIdFor = (name: string, resource_type: 'crew' | 'equipment', rate: number): string => {
    const existing = resourceByName.get(name)
    if (existing) return existing.temp_id
    const temp_id = `res-${nextTempId++}`
    resourceByName.set(name, { temp_id, name, resource_type, unit: 'day', rate })
    return temp_id
  }

  for (const activity of activities) {
    if (!activity.schedule_category) continue
    const phases = resolvePhases(activity.schedule_category)
    const phase = phases.find(p => p.key === activity.schedule_phase_key) ?? phases[0]
    if (!phase) continue
    const { rate } = phase
    assignments.push({
      activity_id: activity.id,
      resource_temp_id: tempIdFor(rate.crewName, 'crew', rate.costPerCrewDay),
      utilisation_pct: 100,
    })
    if (rate.equipmentName && rate.equipmentCostPerDay != null) {
      assignments.push({
        activity_id: activity.id,
        resource_temp_id: tempIdFor(rate.equipmentName, 'equipment', rate.equipmentCostPerDay),
        utilisation_pct: 100,
      })
    }
  }

  return { resources: [...resourceByName.values()], assignments }
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
  'Foundation', 'Reinforcement', 'Columns', 'Beams',
  'Structural Members', 'Stairs', 'Curtain Walls', 'Windows', 'Doors', 'Railings', 'Furnishings',
  // MEP + facade-detailing additions (2026-07-17) — every one of these is a
  // discrete family instance (a duct fitting, a light fixture, a
  // receptacle), not a continuous surface — same "installed per crew-day"
  // count basis as Foundation/Columns/Beams above, never an area measurement.
  'Ductwork', 'Air Terminals', 'Piping', 'Plumbing Fixtures',
  'Electrical Containment', 'Lighting', 'Electrical Devices', 'Facade Ornamentation',
  // Same reasoning, 2026-07-17 — a tree/bench/bollard is a discrete
  // planted/placed instance, not a continuous surface.
  'Site & Landscaping',
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
  // Persisted on the real Activity row (Activity.schedule_category/
  // schedule_phase_key, backend) — null for the synthetic root/storey-WBS/
  // milestone nodes this module also generates, set for every real category-
  // phase work activity. See that column's own docstring for why: a later,
  // separate "Generate Resources"/"Auto Assign Resources" pass (Resources
  // tab) needs to find these activities again without re-scanning the IFC
  // file or parsing task_name (freely user-editable after generation).
  category: string | null
  phase_key: string | null
  // The real IFC-measured quantity duration_hours (below) was computed
  // FROM — same category.quantity computeDurationHours already reads, just
  // also persisted verbatim this time (2026-07-18, per Maro's own QA catch:
  // isolating L2's beams in the 4D viewer showed 193 real IfcBeam elements,
  // but BOQ generation — having nothing but duration_hours to work from —
  // could only reverse-engineer "whole days x rate" = 200, the rounded-up
  // day count, not the true 193 that produced those days). Null for the
  // same synthetic nodes category/phase_key are.
  quantity: number | null
  // "task" default — only Construction Start/Substantial Completion
  // (2026-07-17, per Maro) ever set this to start_milestone/finish_milestone.
  activity_type: 'task' | 'start_milestone' | 'finish_milestone'
  // Written into a "Discipline" UDF value, not a new Activity column — see
  // disciplineFor's own header above and BulkActivityInput.discipline's
  // (backend). Null for the same synthetic nodes category/phase_key are.
  discipline: string | null
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

// Structural climb categories (2026-07-17, per Maro: "you literally give
// everything a finish to start sequence from start to end... its not
// practical in real life... first floor works can start as soon as its
// slab has been placed so no need to wait for all ground floor works to be
// done") — these are the categories the floor ABOVE literally bears on (a
// column can't stand until the slab below it is poured), so they're what
// actually gates the *next* storey's own structure starting. Everything
// else on a storey (envelope, secondary members, stairs, finishes,
// furnishings) still sequences after its OWN storey's structure completes
// — CATEGORY_ORDER already puts them after Slabs/Walls — but no longer
// waits on any OTHER storey at all: this storey's finishes and the storey
// above's structure can now genuinely run in parallel, matching how a real
// multi-storey job actually climbs (structure several floors ahead, trades
// following behind it), not a strict "finish this whole floor before
// touching the next" chain. Every relationship generated is still a plain
// 0-lag FS link either way — this only changes *which* activities connect,
// not the relationship type/lag, so it stays exactly as DCMA-clean
// (#3 Relationship Types, #4 Positive Lags, #5 Leads) as the flat chain was.
const STRUCTURAL_CATEGORIES: ReadonlySet<string> = new Set(['Foundation', 'Reinforcement', 'Columns', 'Beams', 'Slabs'])

// Facade categories (2026-07-17, per Maro, after reviewing an exported real
// schedule + the 4D viewport: "dont touch facade until architecture walls
// for all levels are complete") — the cascade rule above deliberately lets
// a storey's own finishes run in parallel with the storey ABOVE it's
// structure, which is correct for envelope-agnostic trades (MEP, interior
// coverings), but real high-rise sequencing never glazes/clads a floor
// while the floor(s) above it are still mid steel-erection/concrete-pour —
// dropped tools, weld spatter, wet-concrete overspill and crane swing all
// put finished glazing at risk. Confirmed against a real generated
// schedule's own exported dates: Level 2's Curtain Walls/Glazing (26 May -
// 24 Jun 2027) ran the entire time Level 3's steel/concrete erection (08
// Apr - 25 Aug 2027) was underway directly overhead. The fix below adds one
// global gate — see the "Structure Complete — All Levels" milestone further
// down — rather than a per-storey "wait N floors" lag, matching Maro's own
// literal rule: every level's Walls phase (the last structural pour before
// envelope work) must be complete building-wide before ANY facade
// (Curtain Walls/Windows/Doors/Facade Ornamentation) starts anywhere.
const FACADE_CATEGORIES: ReadonlySet<string> = new Set(['Curtain Walls', 'Windows', 'Doors', 'Facade Ornamentation'])

// Discipline (2026-07-17, per Maro: "create a udf column called
// Discipline... Earthworks, Architecture, Structures, Electrical, HVAC,
// Landscape, Plumbing, Misc. etc like that so where necessary") — coarser
// than ScheduleCategory, written into a "Discipline" UDF value per
// generated activity (see BulkActivityInput.discipline's own header,
// backend) so the Scheduling grid can group by it directly. Furnishings
// falls to Misc — none of the other 7 named disciplines are a real fit for
// FF&E, and Misc exists specifically as that catch-all.
// Exported (2026-07-18) so riskGeneration.ts can map an activity's own
// schedule_category back to its coarse discipline the same way this module
// already does for the Discipline UDF — one source of truth for "what
// discipline is this category," not a second copy drifting out of sync.
export const CATEGORY_DISCIPLINE: Record<string, string> = {
  Foundation: 'Structures', Reinforcement: 'Structures', Columns: 'Structures', Beams: 'Structures',
  Slabs: 'Structures', Walls: 'Structures', 'Structural Members': 'Structures', Stairs: 'Structures',
  Roofs: 'Architecture', 'Curtain Walls': 'Architecture', 'Facade Ornamentation': 'Architecture',
  Windows: 'Architecture', Doors: 'Architecture', Railings: 'Architecture', Coverings: 'Architecture',
  Ductwork: 'HVAC', 'Air Terminals': 'HVAC',
  Piping: 'Plumbing', 'Plumbing Fixtures': 'Plumbing',
  'Electrical Containment': 'Electrical', Lighting: 'Electrical', 'Electrical Devices': 'Electrical',
  Furnishings: 'Misc',
  'Site & Landscaping': 'Landscape',
}

// Foundation's own "Excavate & Prep" phase specifically (2026-07-17) —
// bulk excavation is genuinely Earthworks, not Structures, even though it
// sits inside the Foundation category alongside the concrete pour itself
// (2026-07-17, per Maro: "Earthworks is more like Excavation which we
// dont have" as its own category — this phase-level override is exactly
// that, without needing a whole separate ScheduleCategory for it); every
// other Foundation phase (formwork/rebar, pour, strip) stays Structures
// via CATEGORY_DISCIPLINE above. Keyed by "category::phaseKey" (phaseRowId,
// defined further below) once that function exists.
const PHASE_DISCIPLINE_OVERRIDES: Record<string, string> = {
  'Foundation::excavate': 'Earthworks',
}

function disciplineFor(category: string, phaseKey: string): string {
  return PHASE_DISCIPLINE_OVERRIDES[`${category}::${phaseKey}`] ?? CATEGORY_DISCIPLINE[category] ?? 'Misc'
}

interface StoreyHandoff {
  // First/last phase belonging to a STRUCTURAL_CATEGORIES category on this
  // storey — null when the storey has none.
  firstStructuralTempId: string | null
  lastStructuralTempId: string | null
  // First/last phase belonging to any NON-facade category (2026-07-17 fix,
  // per a real "circular dependency" rejection against a real generated
  // schedule) — the fallback used to go straight to firstTempId/lastTempId
  // (the storey's overall first/last activity, whatever it was), which for
  // a storey with NO structural category at all and ONLY a facade one (a
  // real case: "Block 43 - Parapet," whose sole activity is its own Facade
  // Ornamentation phase) meant that facade activity itself became this
  // storey's handoff anchor — feeding straight into the NEXT storey's own
  // structural chain as a predecessor, which that storey's own Walls is a
  // descendant of, which (after the "Structure Complete — All Levels" gate
  // above) is ALSO a predecessor of that same facade-only storey's facade
  // activity. A textbook cycle, entirely on the automatic IFC-scan path,
  // nothing to do with the earlier Collections-ordering fix. A facade
  // activity must never be used as a handoff anchor for this reason — see
  // the handoff-building loop below for what happens when a storey has
  // truly nothing else to anchor on (firstStructuralTempId and this both
  // null): it's skipped over in the chain entirely, not force-anchored on
  // its own facade activity.
  firstNonFacadeTempId: string | null
  lastNonFacadeTempId: string | null
  firstTempId: string | null
  lastTempId: string | null
}

// Schedule generation stops at activity detail + sequence for now — no
// Resource/ResourceAssignment rows (2026-07-17, per Maro's phased-generation
// plan: schedule first, so it can be reviewed/edited on its own; resources
// and cost data come from a later, separate generation pass off the IFC +
// this now-committed schedule, then a full cost plan off *that* combined
// output, then a risk register off *that* — each stage refining the last,
// eventually a risk-adjusted schedule/CRA-derived contingency feeding back
// into costing). The crew/productivity rate model below (CategoryRate,
// resolvePhases, computeDurationHours) still fully drives realistic
// *durations* — none of that goes away, only the step that used to also
// turn those same rates into real Resource/ResourceAssignment rows.
export function buildStagedSchedule(
  projectId: string, schedulePeriodId: string, storeys: StoreyGroup[], rates: Record<string, CategoryRate>,
  rootName: string, calendarId: string | null,
): { staged: StagedSchedule; summary: ProposedScheduleSummary } {
  const activities: StagedActivity[] = []
  const relationships: StagedRelationship[] = []
  let elementCount = 0
  // Per-storey handoff points the between-storey linking below reads —
  // see STRUCTURAL_CATEGORIES' own header for why this replaced a single
  // flat "last phase of storey N -> first phase of storey N+1" chain.
  const handoffByStorey: StoreyHandoff[] = []

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
  activities.push({
    temp_id: rootTempId, task_name: rootName, parent_temp_id: null, duration_hours: 0, element_refs: [],
    category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
  })

  // Project Milestones (2026-07-17, per Maro: "there should be a
  // Construction Start start milestone kicking off everything... these two
  // will be in the first wbs called Project Milestones then the others
  // follow") — root's own FIRST child, ahead of every storey WBS node.
  // Construction Start (a real start_milestone, not a 0-duration task —
  // schedule_bulk_generate.py's own create loop now reads staged.
  // activity_type instead of hardcoding "task") feeds the very first
  // storey's own first activity below, giving it a real predecessor instead
  // of leaving it as the network's only unconstrained start (still fine
  // for DCMA #1, but a named kickoff milestone reads far better on a real
  // PM's schedule than an unlabeled implicit start). Substantial Completion
  // (finish_milestone) is the same closeout every storey's own finishing
  // work already converged on before this change — moved from a root-level
  // task into this folder, not otherwise changed in what feeds it.
  const milestonesWbsTempId = 'wbs-milestones'
  const constructionStartTempId = 'act-construction-start'
  const substantialCompletionTempId = 'act-substantial-completion'
  // "Structure Complete — All Levels" (2026-07-17, per Maro — see
  // FACADE_CATEGORIES' own header) — a third real milestone alongside
  // Construction Start/Substantial Completion: every storey's own last
  // Walls-category phase feeds it, and it in turn feeds every storey's own
  // first facade-category phase, so no facade work anywhere can start until
  // every level's walls are structurally complete. Declared here (added to
  // `activities` further down, only if it ends up with at least one real
  // predecessor AND successor — see the storeys.forEach loop) so its
  // temp_id is in scope for that loop.
  const structureCompleteTempId = 'act-structure-complete-all-levels'
  activities.push({
    temp_id: milestonesWbsTempId, task_name: 'Project Milestones', parent_temp_id: rootTempId,
    duration_hours: 0, element_refs: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
  })
  activities.push({
    temp_id: constructionStartTempId, task_name: 'Construction Start', parent_temp_id: milestonesWbsTempId,
    duration_hours: 0, element_refs: [], category: null, phase_key: null, quantity: null, activity_type: 'start_milestone', discipline: null,
  })
  activities.push({
    temp_id: substantialCompletionTempId, task_name: 'Substantial Completion', parent_temp_id: milestonesWbsTempId,
    duration_hours: 0, element_refs: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
  })

  // No Resource/StagedAssignment rows generated here (2026-07-17 — see this
  // function's own header) — resources and assignments always come back
  // empty; only computeDurationHours below still reads rate.crewSize/
  // productivityPerCrewDay off the same CategoryRate.
  const resources: StagedResource[] = []
  const assignments: StagedAssignment[] = []

  // Collected across every storey for the "Structure Complete — All Levels"
  // gate below (2026-07-17, per Maro — see FACADE_CATEGORIES' own header).
  const lastWallsTempIds: string[] = []
  const firstFacadeTempIds: string[] = []

  storeys.forEach((storey, storeyIndex) => {
    const wbsTempId = `wbs-storey-${storeyIndex}`
    activities.push({
      temp_id: wbsTempId, task_name: storey.storeyName, parent_temp_id: rootTempId, duration_hours: 0,
      element_refs: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
    })

    let previousTempId: string | null = null
    let firstTempId: string | null = null
    let firstStructuralTempId: string | null = null
    let lastStructuralTempId: string | null = null
    let firstNonFacadeTempId: string | null = null
    let lastNonFacadeTempId: string | null = null
    let lastWallsTempId: string | null = null
    let lastWallsCategoryIndex: number | null = null
    let firstFacadeTempId: string | null = null
    let firstFacadeCategoryIndex: number | null = null
    storey.categories.forEach((category, categoryIndex) => {
      elementCount += category.elementRefs.length
      const phases = resolvePhases(category.name)
      const isStructural = STRUCTURAL_CATEGORIES.has(category.name)
      const isWalls = category.name === 'Walls'
      const isFacade = FACADE_CATEGORIES.has(category.name)
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
          category: category.name, phase_key: phase.key, quantity: category.quantity, activity_type: 'task',
          discipline: disciplineFor(category.name, phase.key),
        })
        firstTempId ??= tempId
        if (isStructural) {
          firstStructuralTempId ??= tempId
          lastStructuralTempId = tempId
        }
        if (!isFacade) {
          firstNonFacadeTempId ??= tempId
          lastNonFacadeTempId = tempId
        }
        if (isWalls) { lastWallsTempId = tempId; lastWallsCategoryIndex = categoryIndex }
        if (isFacade && firstFacadeTempId === null) { firstFacadeTempId = tempId; firstFacadeCategoryIndex = categoryIndex }
        if (previousTempId) {
          relationships.push({ predecessor_temp_id: previousTempId, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
        }
        previousTempId = tempId
      })
    })
    handoffByStorey.push({
      firstStructuralTempId, lastStructuralTempId, firstNonFacadeTempId, lastNonFacadeTempId,
      firstTempId, lastTempId: previousTempId,
    })
    // Skipped when this storey's own local category order runs Facade
    // before Walls (2026-07-17 fix, per a real "circular dependency"
    // rejection from schedule_bulk_generate.py) — this used to be reachable
    // via the manual Collections path (groupFromCollections, removed
    // 2026-07-19), where category order was whatever the user arranged,
    // not CATEGORY_ORDER's guaranteed Walls-before-Facade sequence the
    // automatic scan always produces; kept as a defensive safeguard since
    // groupByStorey's own guaranteed ordering means this should no longer
    // actually trigger. Contributing this storey to the global gate
    // anyway would add BOTH
    // "this storey's own Facade -> ... -> this storey's own Walls" (the
    // local chain, in the order the categories actually appear) AND
    // "Walls -> Structure Complete milestone -> Facade" (the global gate)
    // — a genuine cycle back through the same two activities. Simplest safe
    // fix: a storey only feeds the global gate when there's no such local
    // contradiction to begin with; every other storey's edges are
    // unaffected, so the global gate still holds everywhere it validly can.
    const noLocalConflict = lastWallsCategoryIndex === null || firstFacadeCategoryIndex === null
      || lastWallsCategoryIndex < firstFacadeCategoryIndex
    if (lastWallsTempId && noLocalConflict) lastWallsTempIds.push(lastWallsTempId)
    if (firstFacadeTempId && noLocalConflict) firstFacadeTempIds.push(firstFacadeTempId)
  })

  // Structural handoff, not "this storey's overall last phase" — see
  // STRUCTURAL_CATEGORIES' own header. Falls back to the storey's own
  // first/last NON-facade phase when it has no structural category at all
  // (a pure-MEP or pure-finishes storey) — never falls all the way to
  // firstTempId/lastTempId (2026-07-17 fix — see StoreyHandoff's own header
  // on the real cycle a facade-only storey, "Block 43 - Parapet" in a real
  // generated schedule, produced by letting its own Facade Ornamentation
  // phase anchor the chain). A storey with truly nothing but facade
  // categories has neither anchor (both null) — filtered out below entirely
  // rather than linked with a null edge, so the chain connects straight
  // from the storey before it to the storey after it, skipping over the
  // facade-only one exactly as if it weren't part of the structural
  // sequence at all (which, precisely because it's facade-only, it isn't —
  // the "Structure Complete — All Levels" gate above is its real
  // predecessor instead, and every storey's own lastTempId -> Substantial
  // Completion loop below still gives it a successor, so it's never left
  // dangling for DCMA #1/#2 either).
  const handoffAnchors = handoffByStorey
    .map(h => ({
      firstId: h.firstStructuralTempId ?? h.firstNonFacadeTempId,
      lastId: h.lastStructuralTempId ?? h.lastNonFacadeTempId,
    }))
    .filter((h): h is { firstId: string; lastId: string } => h.firstId !== null && h.lastId !== null)
  for (let i = 0; i < handoffAnchors.length - 1; i++) {
    relationships.push({
      predecessor_temp_id: handoffAnchors[i].lastId, successor_temp_id: handoffAnchors[i + 1].firstId,
      relationship_type: 'FS', lag_hours: 0,
    })
  }

  // "Structure Complete — All Levels" (2026-07-17, per Maro: "dont touch
  // facade until architecture walls for all levels are complete" — see
  // FACADE_CATEGORIES' own header) — only added when there's genuinely
  // something on both sides: a schedule with no Walls category anywhere, or
  // no facade category anywhere, would otherwise get an orphan milestone
  // with a missing predecessor or successor, exactly what DCMA #1/#2 flag.
  // One central milestone rather than an edge per (walls storey, facade
  // storey) pair — same O(n) vs O(n²) reasoning Construction Start/
  // Substantial Completion already use, and CPM resolves "wait for
  // whichever wall finishes last" automatically from the fan-in alone.
  if (lastWallsTempIds.length > 0 && firstFacadeTempIds.length > 0) {
    activities.push({
      temp_id: structureCompleteTempId, task_name: 'Structure Complete — All Levels', parent_temp_id: milestonesWbsTempId,
      duration_hours: 0, element_refs: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
    })
    for (const fromId of lastWallsTempIds) {
      relationships.push({ predecessor_temp_id: fromId, successor_temp_id: structureCompleteTempId, relationship_type: 'FS', lag_hours: 0 })
    }
    for (const toId of firstFacadeTempIds) {
      relationships.push({ predecessor_temp_id: structureCompleteTempId, successor_temp_id: toId, relationship_type: 'FS', lag_hours: 0 })
    }
  }

  if (handoffByStorey.length > 0) {
    // Construction Start kicks off the very first (structurally-anchored)
    // storey's own first activity (2026-07-17) — the structural-handoff
    // loop above only ever links storey-to-storey, so without this the
    // first storey's own first activity would be the network's only
    // implicit, unlabeled start (still DCMA #1-clean either way, but a real
    // PM's schedule names its kickoff). Reads off handoffAnchors, not
    // handoffByStorey[0] directly (2026-07-17 fix, same reasoning as the
    // handoff chain above) — a facade-only storey has no real predecessor
    // role to play; even as the very first storey, Construction Start
    // driving straight into a facade activity would be a semantically odd
    // kickoff, not a real methodology.
    const firstOfSchedule = handoffAnchors[0]?.firstId
    if (firstOfSchedule) {
      relationships.push({ predecessor_temp_id: constructionStartTempId, successor_temp_id: firstOfSchedule, relationship_type: 'FS', lag_hours: 0 })
    }

    // Substantial Completion is every storey's own finishing work's real
    // successor (2026-07-17) — the structural-handoff rewrite above only
    // carries each storey's *structural* completion forward to the next
    // storey; its envelope/finishes/furnishings branch (still chained to
    // the end of its own storey, just no longer to the next storey at all)
    // would otherwise dead-end with no successor at all on every storey but
    // the last — realistic in isolation (a floor's finishes genuinely
    // don't gate the floor above), but exactly what DCMA #2 (Missing
    // Successors) flags: every activity but the true project end should
    // feed *something*. Standard real-schedule practice already has an
    // answer for this same shape — every trade's finish work across every
    // floor converging on one Substantial Completion milestone — so that's
    // what this is, not an artificial fix bolted on just to satisfy a metric.
    for (const storey of handoffByStorey) {
      const fromId = storey.lastTempId
      if (fromId) relationships.push({ predecessor_temp_id: fromId, successor_temp_id: substantialCompletionTempId, relationship_type: 'FS', lag_hours: 0 })
    }
  }

  return {
    staged: { project_id: projectId, schedule_period_id: schedulePeriodId, calendar_id: calendarId, activities, resources, assignments, relationships },
    summary: {
      storeyCount: storeys.length,
      activityCount: activities.length,
      relationshipCount: relationships.length,
      elementCount,
    },
  }
}
