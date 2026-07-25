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
  // 2026-07-25, per Maro's own real example (exterior walls "not really
  // part of the structural core" appearing simultaneously with real
  // structural completion in the Animation Timeline) — a non-load-bearing
  // wall (Pset_WallCommon.LoadBearing=false, see ifcScheduleExtraction.ts's
  // own reclassification) still needs real formwork/pour/strip the same way
  // a structural wall does, just lighter/faster (typically a thinner
  // partition/backup/cladding-support wall, not a core shear wall) — a
  // single "install" phase instead of Walls' own three-phase concrete
  // sequence, since these are commonly precast/lightweight/block rather
  // than genuinely cast-in-place. Deliberately its own category (see
  // STRUCTURAL_CATEGORIES below, which this is NOT a member of) rather than
  // folded back into 'Walls' — the whole point is that it must NOT gate the
  // floor-above's own structural climb the way a real load-bearing wall
  // correctly still does.
  'Non-Structural Walls': [
    { key: 'install', label: 'Install Non-Structural Walls', rate: {
      crewName: 'Wall Formwork Crew', crewSize: 4, productivityPerCrewDay: 120, unit: 'm²', costPerCrewDay: 1400,
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
  // 2026-07-25, per Maro's own real example (an IfcRamp "ENTRANCE RAMP",
  // Pset_ProductRequirements.Category="Ramps", previously unassigned
  // entirely — see ifcScheduleExtraction.ts's own IFC_TYPE_CATEGORIES
  // header) — same two-phase shape as Stairs just above (a ramp is the
  // same "erect structure, then finish" circulation-element pattern), not
  // folded into Stairs itself so it gets its own real WBS/BOQ line rather
  // than being invisibly merged into a stair count.
  Ramps: [
    { key: 'erect', label: 'Erect Ramp Structure', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 4, productivityPerCrewDay: 2, unit: 'each', costPerCrewDay: 1400,
    } },
    { key: 'finish', label: 'Install Surface & Railings', rate: {
      crewName: 'Finishing Crew', crewSize: 3, productivityPerCrewDay: 2, unit: 'each', costPerCrewDay: 1200,
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
  // The four "full schedule" categories below (2026-07-25, per Maro — see
  // ScheduleCategory's own header, ifcScheduleExtraction.ts) never have a
  // real IFC-measured quantity behind them — every phase here is a fixed
  // process duration, not a per-element/per-area rate, so quantity is always
  // literally 1 and productivityPerCrewDay is set to 1/desired_days (the
  // same computeDurationHours math every other category already uses,
  // `ceil(quantity / productivityPerCrewDay)`, just solved for a target day
  // count instead of derived from a real takeoff). Durations are ballpark
  // figures cross-checked against the real reference schedules this feature
  // was built from (a 25-storey Gantt export, a real Primavera Tower 2B
  // schedule, a residential-building schedule) — same "editable defaults,
  // not a certified programme" contract as every other category in this
  // table; buildStagedSchedule's own "full schedule" block is what actually
  // injects these as real activities, since they never come from
  // groupByStorey.
  Preliminaries: [
    { key: 'approvals', label: 'Statutory Approvals & Permits', rate: {
      crewName: 'Permitting & Compliance Team', crewSize: 2, productivityPerCrewDay: 1 / 20, unit: 'each', costPerCrewDay: 800,
    } },
    { key: 'geotechnical', label: 'Geotechnical Investigation & Soil Testing', rate: {
      crewName: 'Geotechnical Survey Team', crewSize: 3, productivityPerCrewDay: 1 / 10, unit: 'each', costPerCrewDay: 1500,
      equipmentName: 'Drilling Rig', equipmentCostPerDay: 900,
    } },
    { key: 'mobilisation', label: 'Site Mobilisation & Establishment', rate: {
      crewName: 'Site Establishment Crew', crewSize: 6, productivityPerCrewDay: 1 / 10, unit: 'each', costPerCrewDay: 1400,
    } },
    { key: 'site_clearance', label: 'Site Clearance & Enabling Works', rate: {
      crewName: 'Site Clearance Crew', crewSize: 5, productivityPerCrewDay: 1 / 5, unit: 'each', costPerCrewDay: 1300,
      equipmentName: 'Excavator (Mini)', equipmentCostPerDay: 600,
    } },
  ],
  // Real line items on every reference schedule read for this (Excavation to
  // Remove Black Cotton Soil, Excavation for Foundations and Bases, Concrete
  // Blinding, Hardcore Filling/Compaction/Quarry Dust Blinding, Anti-termite
  // treatment/DPM, Waterproofing to Tank Walls, Backfilling — 25-storey Gantt
  // export) — none of it is ever modeled as 3D geometry, but all of it
  // genuinely happens, in this order, before a real Foundation pour. Reuses
  // Foundation's own "Excavation Crew"/"Excavator (Mini)" resource names
  // (same "one crew, several categories" reuse convention this table's own
  // header already documents) since it's realistically the same crew that
  // does both the bulk dig here and Foundation's own excavate-and-prep phase.
  'Substructure Earthworks': [
    { key: 'excavation', label: 'Bulk Excavation & Earthworks', rate: {
      crewName: 'Excavation Crew', crewSize: 4, productivityPerCrewDay: 1 / 15, unit: 'each', costPerCrewDay: 1100,
      equipmentName: 'Excavator (Mini)', equipmentCostPerDay: 600,
    } },
    { key: 'hardcore_fill', label: 'Hardcore Filling & Compaction', rate: {
      crewName: 'Hardcore & Compaction Crew', crewSize: 4, productivityPerCrewDay: 1 / 5, unit: 'each', costPerCrewDay: 1000,
      equipmentName: 'Plate Compactor', equipmentCostPerDay: 300,
    } },
    { key: 'anti_termite_dpm', label: 'Anti-Termite Treatment & DPM', rate: {
      crewName: 'Waterproofing Crew', crewSize: 3, productivityPerCrewDay: 1 / 3, unit: 'each', costPerCrewDay: 900,
    } },
    { key: 'blinding', label: 'Blinding to Foundations', rate: {
      crewName: 'Concrete Pour Crew', crewSize: 4, productivityPerCrewDay: 1 / 3, unit: 'each', costPerCrewDay: 1200,
      equipmentName: 'Concrete Pump Truck', equipmentCostPerDay: 900,
    } },
    { key: 'waterproofing', label: 'Waterproofing to Substructure', rate: {
      crewName: 'Waterproofing Crew', crewSize: 3, productivityPerCrewDay: 1 / 5, unit: 'each', costPerCrewDay: 900,
    } },
    { key: 'backfilling', label: 'Backfilling', rate: {
      crewName: 'Excavation Crew', crewSize: 4, productivityPerCrewDay: 1 / 5, unit: 'each', costPerCrewDay: 1100,
      equipmentName: 'Excavator (Mini)', equipmentCostPerDay: 600,
    } },
  ],
  // One shared, reusable submittal->approval->PO->delivery chain (2026-07-25,
  // per Maro's own real example — a real Primavera Tower 2B export's own
  // "Drawings & Procurement" section: Submittal -> Approval -> Placing
  // Purchase order -> Procurement -> Delivery on site, repeated per material/
  // system) — one CategoryRate set here, reused once per real procurable
  // category actually present in a generation (buildStagedSchedule's own
  // "full schedule" block loops over them), the same "edit once, applies to
  // every use" convention as every reused crew name elsewhere in this table.
  // Costed as office/coordination overhead (a Procurement & Logistics Team's
  // own day rate), not the value of the goods themselves — this schedule
  // generator has never priced real material cost, only crew/equipment
  // day-rate x duration, same as everywhere else in this table.
  Procurement: [
    { key: 'submittal', label: 'Submittal', rate: {
      crewName: 'Procurement & Logistics Team', crewSize: 2, productivityPerCrewDay: 1 / 5, unit: 'each', costPerCrewDay: 700,
    } },
    { key: 'approval', label: 'Approval', rate: {
      crewName: 'Procurement & Logistics Team', crewSize: 2, productivityPerCrewDay: 1 / 7, unit: 'each', costPerCrewDay: 700,
    } },
    { key: 'purchase_order', label: 'Place Purchase Order', rate: {
      crewName: 'Procurement & Logistics Team', crewSize: 1, productivityPerCrewDay: 1 / 2, unit: 'each', costPerCrewDay: 700,
    } },
    { key: 'delivery', label: 'Procure & Deliver to Site', rate: {
      crewName: 'Procurement & Logistics Team', crewSize: 1, productivityPerCrewDay: 1 / 20, unit: 'each', costPerCrewDay: 700,
    } },
  ],
  // A real project stage, not folded into Substantial Completion (2026-07-25
  // — same real Tower 2B export: "Elevators final finish" -> "Testing &
  // Commissioning" -> "Project Handing over" as three distinct closing
  // milestones/stages). Gated behind Substantial Completion in
  // buildStagedSchedule's own "full schedule" block — none of these systems
  // can be meaningfully tested until the building they serve is actually
  // built.
  'Testing & Commissioning': [
    { key: 'fire_life_safety', label: 'Fire & Life Safety Systems Testing', rate: {
      crewName: 'Fire Systems Testing Team', crewSize: 3, productivityPerCrewDay: 1 / 10, unit: 'each', costPerCrewDay: 1400,
    } },
    { key: 'elevator', label: 'Elevator Testing & Commissioning', rate: {
      crewName: 'Elevator Contractor', crewSize: 2, productivityPerCrewDay: 1 / 15, unit: 'each', costPerCrewDay: 1600,
    } },
    { key: 'mep_testing', label: 'MEP Systems Testing & Balancing', rate: {
      crewName: 'MEP Commissioning Team', crewSize: 4, productivityPerCrewDay: 1 / 15, unit: 'each', costPerCrewDay: 1800,
    } },
    { key: 'bms', label: 'Building Management System (BMS) Commissioning', rate: {
      crewName: 'BMS Integration Team', crewSize: 2, productivityPerCrewDay: 1 / 10, unit: 'each', costPerCrewDay: 1500,
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
  // Same order/length as elementRefs — each element's own real Name (2026-07-22,
  // per Maro: "another column to see the dropdown of 3d elements assigned so
  // i browse down the list" — see this module's own ModelElementLink write
  // in schedule_bulk_generate.py for why a real per-element label matters
  // here specifically: element_label is documented, backend-side, as "a
  // human-readable snapshot [of the element]", but the bulk-generate path
  // had never had a real one available to give it, so every one of a real
  // generation's thousands of links carried the same, unhelpful value (its
  // own activity's task_name, repeated) — a "browse the elements" column
  // built on top of that would have shown the identical string N times).
  elementLabels: string[]
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
  'Structural Members', 'Stairs', 'Ramps', 'Curtain Walls', 'Windows', 'Doors', 'Railings', 'Furnishings',
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
  interface Bucket { storeyName: string; elevationMetres: number | null; categories: Map<ScheduleCategory, { elementRefs: string[]; elementLabels: string[]; quantity: number }> }
  const byStorey = new Map<string, Bucket>()
  for (const el of elements) {
    let group = byStorey.get(el.storeyName)
    if (!group) { group = { storeyName: el.storeyName, elevationMetres: el.storeyElevation, categories: new Map() }; byStorey.set(el.storeyName, group) }
    let bucket = group.categories.get(el.category)
    if (!bucket) { bucket = { elementRefs: [], elementLabels: [], quantity: 0 }; group.categories.set(el.category, bucket) }
    bucket.elementRefs.push(el.globalId)
    // el.name falls back to el.ifcType (2026-07-22) — a handful of real
    // elements genuinely have no Name set in the source file; showing the
    // IFC type is still more useful for browsing than an empty string.
    bucket.elementLabels.push(el.name || el.ifcType)
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
// A permanent, absolute backstop against one phase-activity ever running
// unrealistically long just because a real floor genuinely has a lot of
// small elements assigned to it (2026-07-25, per Maro: "i dont want to see
// ridiculous task durations just because multiple elements are assigned to
// the tasks, curtain wall, mullions, doors, glazed panels etc" — a real
// curved/complex facade, unlike a plain rectangular one, exports as many
// more individual small IfcMember/IfcPlate/IfcDoor/IfcWindow instances per
// floor, and every one of those is a genuinely real, correctly-measured
// element, not a data bug — so clampOutlierQuantities below (which only
// catches a storey that's an outlier *relative to its own peers*) doesn't
// help here: a facade that's uniformly element-dense on EVERY floor is,
// by definition, never an outlier against itself). This is a DURATION cap,
// not a quantity cap — category.quantity (and therefore the real element
// count/area persisted to quantity, StagedActivity's own field, still feeds
// BOQ generation with the true, uncapped figure) is left completely alone;
// only the number of days a single phase is allowed to claim is bounded.
// 20 working days (4 working weeks) is a generous ceiling for one trade's
// one phase on one floor in real construction — nothing in
// DEFAULT_CATEGORY_PHASES should legitimately need more than that per
// floor even on a dense facade — and, same as OUTLIER_MULTIPLE below, is a
// deliberately reviewable default: a genuinely denser real project can
// raise crew size/productivity in the wizard's own Rates & Crews step
// before generating, which computeDurationHours below always reads first.
const MAX_PHASE_DURATION_DAYS = 20

function computeDurationHours(quantity: number, rate: CategoryRate): number {
  if (rate.productivityPerCrewDay <= 0 || rate.crewSize <= 0) return HOURS_PER_DAY
  const days = Math.max(1, Math.ceil(quantity / rate.productivityPerCrewDay))
  return Math.min(days, MAX_PHASE_DURATION_DAYS) * HOURS_PER_DAY
}

export interface StagedActivity {
  temp_id: string
  task_name: string
  parent_temp_id: string | null
  duration_hours: number
  element_refs: string[]
  // Same order/length as element_refs (2026-07-22) — see CategoryGroup's
  // own elementLabels header for why this exists: without it,
  // schedule_bulk_generate.py has nothing but this activity's own
  // task_name to fall back to for every one of these elements' real
  // ModelElementLink.element_label.
  element_labels: string[]
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

// The "full schedule" categories buildStagedSchedule injects directly
// (Preliminaries/Substructure Earthworks/Testing & Commissioning always,
// Procurement once per procurable real category present — see
// PROCURABLE_CATEGORIES' own header) never appear in `storeys` at all, so
// usedCategoryNames/usedPhaseRows above can't see them. Exported so the
// wizard's own Review-step summary can add them into its category/phase
// counts when the "Full Schedule" toggle is on, so what's shown before
// generating matches what buildStagedSchedule will actually create.
export function fullScheduleCategoryNames(storeys: StoreyGroup[]): string[] {
  const hasProcurable = usedCategoryNames(storeys).some(name => PROCURABLE_CATEGORIES.has(name))
  return ['Preliminaries', 'Substructure Earthworks', ...(hasProcurable ? ['Procurement'] : []), 'Testing & Commissioning']
}

export function fullSchedulePhaseRows(storeys: StoreyGroup[]): PhaseRow[] {
  const rows: PhaseRow[] = []
  for (const category of fullScheduleCategoryNames(storeys)) {
    for (const phase of resolvePhases(category)) rows.push({ id: phaseRowId(category, phase.key), category, phase })
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

// Genuinely-last categories (2026-07-25, per Maro: "ensure landscaping
// environments/trees/benches/parking etc are the last things to get done, i
// dont want to see them mid way" — a repeat, stronger version of the same
// "leave to the final phases" ask CATEGORY_ORDER's own header already
// documents from 2026-07-17). CATEGORY_ORDER already sorts 'Site &
// Landscaping' dead last *within* one storey, but that alone isn't enough:
// the site/ground-level storey (isSiteElement's own reclassified
// asphalt/parking/planting/pool/planter elements — see
// ifcScheduleExtraction.ts) sits at
// or near grade, so it sorts near the FRONT of groupByStorey's own
// elevation-ascending order and, per the structural-climb rule above, can
// genuinely finish its own local chain (including its own Landscaping
// phase) while upper floors are still mid-construction — exactly "seeing
// them mid way." Gated the same way FACADE_CATEGORIES is gated behind
// "Structure Complete — All Levels" below, one step later: every storey's
// own Landscaping phase now additionally waits on a new "All Building Work
// Complete" milestone fed by every OTHER storey's own true last activity
// (structure, facade, MEP, finishes, furnishings — literally everything
// except Landscaping itself), so no landscaping/parking/planting work
// anywhere can start until the whole building is otherwise done, not just
// its own floor.
const LATE_CATEGORIES: ReadonlySet<string> = new Set(['Site & Landscaping'])

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
  Slabs: 'Structures', Walls: 'Structures', 'Structural Members': 'Structures', Stairs: 'Structures', Ramps: 'Structures',
  Roofs: 'Architecture', 'Curtain Walls': 'Architecture', 'Facade Ornamentation': 'Architecture',
  Windows: 'Architecture', Doors: 'Architecture', Railings: 'Architecture', Coverings: 'Architecture',
  // Architecture, not Structures (2026-07-25) — the whole point of this
  // category is that it's explicitly NOT part of the structural core (see
  // its own DEFAULT_CATEGORY_PHASES header) — a non-load-bearing wall reads
  // more naturally as an architectural/envelope element for reporting.
  'Non-Structural Walls': 'Architecture',
  Ductwork: 'HVAC', 'Air Terminals': 'HVAC',
  Piping: 'Plumbing', 'Plumbing Fixtures': 'Plumbing',
  'Electrical Containment': 'Electrical', Lighting: 'Electrical', 'Electrical Devices': 'Electrical',
  Furnishings: 'Misc',
  'Site & Landscaping': 'Landscape',
  // The four "full schedule" categories (2026-07-25 — see their own
  // DEFAULT_CATEGORY_PHASES header) each get their own discipline rather than
  // falling to Misc — 'Earthworks' already exists as a value (Foundation's
  // own excavate-phase override below already writes it), so Substructure
  // Earthworks reuses it rather than inventing a near-duplicate; Discipline
  // is a free-text UDF value (backend has no fixed choice list), so adding
  // 'Preliminaries'/'Procurement'/'Commissioning' is safe.
  Preliminaries: 'Preliminaries',
  'Substructure Earthworks': 'Earthworks',
  Procurement: 'Procurement',
  'Testing & Commissioning': 'Commissioning',
}

// Real, manufactured/selected items a real project genuinely submits,
// approves, and orders ahead of installation (2026-07-25 — see Procurement's
// own DEFAULT_CATEGORY_PHASES header) — deliberately excludes bulk
// cast-in-place/site-fabricated structural categories (Foundation,
// Reinforcement, Columns, Beams, Slabs, Walls, Structural Members, Stairs,
// Ramps), matching the real Tower 2B export this was built from: its own
// "Drawings & Procurement" section only ever covered architectural/MEP
// finishes and equipment (marbles, wardrobes, kitchen cabinets, paint,
// doors, windows/louvers, roofing tiles, gypsum boards, railings, electrical
// fittings, HVAC machinery, plumbing fixtures, fire pumps, generators) —
// concrete/rebar/formwork were never a distinct submittal chain there
// either, since nobody "selects" ready-mix concrete the way they select a
// glazing system or a light fixture. buildStagedSchedule's own "full
// schedule" block generates one submittal->approval->PO->delivery chain per
// member of this set that's actually present in a real generation.
const PROCURABLE_CATEGORIES: ReadonlySet<string> = new Set([
  'Curtain Walls', 'Windows', 'Doors', 'Railings', 'Facade Ornamentation', 'Roofs', 'Non-Structural Walls',
  'Ductwork', 'Air Terminals', 'Piping', 'Plumbing Fixtures',
  'Electrical Containment', 'Lighting', 'Electrical Devices',
  'Coverings', 'Furnishings',
])

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
// A permanent backstop against one bad quantity ever again producing an
// absurd multi-year activity duration (2026-07-22, per Maro: "make sure an
// outlier never does something that silly" — a real Hotel export, WITH
// "Export base quantities" on, still turned one Slabs phase into a 1,570-day
// activity; root-caused to a real unit-conversion bug in
// getElementQuantityArea, ifcModel.ts, now fixed separately — but the
// actual lesson here is broader than that one bug: this function trusts
// whatever quantity extraction handed it, from a real Qto, a bounding-box
// guess, or any future measurement path this app grows, and none of those
// can ever be guaranteed free of a bad value on some real file this hasn't
// been tested against yet. Rather than trust the source, this compares
// each storey's own quantity for a category against every OTHER storey's
// quantity for that *same* category — a hotel's floor slabs are naturally
// comparable to each other in a way nothing else in this generator's own
// data already checks. Requires at least 3 storeys with that category
// present before attempting this at all (fewer data points can't
// distinguish "the real outlier" from "just genuinely different" — a
// building with, say, only a ground floor and a roof sharing one category
// is left completely alone). OUTLIER_MULTIPLE is deliberately generous
// (10x its own peers' median) — real floor-to-floor variation (a smaller
// penthouse, a larger podium level) should never come close to that; only
// something like the mis-bucketed sitewide-slab/unit-conversion class of
// bug this was written against would. Clamps down to the threshold itself,
// not the median — the clamped activity still reads as the largest of its
// peers (a real, if imprecise, signal that something about that storey
// genuinely differs), just bounded to a plausible magnitude instead of an
// absurd one.
const OUTLIER_MULTIPLE = 10

function clampOutlierQuantities(storeys: StoreyGroup[]): StoreyGroup[] {
  const quantitiesByCategory = new Map<string, number[]>()
  for (const storey of storeys) {
    for (const category of storey.categories) {
      const list = quantitiesByCategory.get(category.name) ?? []
      list.push(category.quantity)
      quantitiesByCategory.set(category.name, list)
    }
  }

  const capByCategory = new Map<string, number>()
  for (const [name, quantities] of quantitiesByCategory) {
    if (quantities.length < 3) continue
    const sorted = [...quantities].sort((a, b) => a - b)
    const median = sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    if (median > 0) capByCategory.set(name, median * OUTLIER_MULTIPLE)
  }
  if (capByCategory.size === 0) return storeys

  return storeys.map(storey => ({
    ...storey,
    categories: storey.categories.map(category => {
      const cap = capByCategory.get(category.name)
      return cap !== undefined && category.quantity > cap ? { ...category, quantity: cap } : category
    }),
  }))
}

export function buildStagedSchedule(
  projectId: string, schedulePeriodId: string, storeys: StoreyGroup[], rates: Record<string, CategoryRate>,
  rootName: string, calendarId: string | null,
  // "Full schedule generation" (2026-07-25, per Maro — see ScheduleCategory's
  // own header, ifcScheduleExtraction.ts) — when true, injects Preliminaries,
  // Substructure Earthworks, Procurement, and Testing & Commissioning
  // activities that never come from the IFC scan at all, ahead of/around the
  // real IFC-derived storey work below. When false, output is byte-for-byte
  // identical to this function's pre-2026-07-25 behaviour — every new code
  // path below is strictly additive and gated on this flag.
  includeFullSchedule: boolean,
): { staged: StagedSchedule; summary: ProposedScheduleSummary } {
  storeys = clampOutlierQuantities(storeys)
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
    temp_id: rootTempId, task_name: rootName, parent_temp_id: null, duration_hours: 0, element_refs: [], element_labels: [],
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
  // "All Building Work Complete" (2026-07-25, per Maro — see
  // LATE_CATEGORIES' own header) — a fourth real milestone, the same shape
  // as Structure Complete — All Levels just one step later in the project:
  // every storey's own true last NON-Landscaping activity feeds it, and it
  // in turn feeds every storey's own first Site & Landscaping phase, so no
  // landscaping/parking/planting work anywhere can start until literally
  // everything else, on every floor, is done.
  const allWorkCompleteTempId = 'act-all-building-work-complete'
  activities.push({
    temp_id: milestonesWbsTempId, task_name: 'Project Milestones', parent_temp_id: rootTempId,
    duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
  })
  activities.push({
    temp_id: constructionStartTempId, task_name: 'Construction Start', parent_temp_id: milestonesWbsTempId,
    duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'start_milestone', discipline: null,
  })
  activities.push({
    temp_id: substantialCompletionTempId, task_name: 'Substantial Completion', parent_temp_id: milestonesWbsTempId,
    duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
  })

  // Preliminaries + Substructure Earthworks (2026-07-25, per Maro — see
  // ScheduleCategory's own header) — real work that happens before/around
  // the IFC-derived storey climb but is never IFC geometry itself. Both WBS
  // folders and their internal phase chains are built unconditionally when
  // includeFullSchedule is on, ahead of the storeys.forEach loop below, since
  // the very first storey's own structural anchor needs to chain off the
  // end of this instead of straight off Construction Start (see the
  // `firstOfSchedule` linking further down). earthworksExitTempId stays null
  // when the flag is off, which that same linking code reads as "fall back
  // to today's unchanged Construction Start -> first storey edge."
  let earthworksExitTempId: string | null = null
  // Each procurable category's own final "Procure & Deliver to Site" temp_id
  // (2026-07-25), keyed by category name — populated in this same early
  // block (below, alongside Preliminaries/Earthworks) so the Procurement WBS
  // folder sorts near the top of the schedule like a real project-level
  // package, not after every storey (per Maro: "why is procurement wbs all
  // the way down" — it used to be built entirely after the storeys.forEach
  // loop below, since it needed each category's first real installation
  // activity to link against; that installation-linking edge is the only
  // part that genuinely has to wait — the WBS folder and its own internal
  // submittal->approval->PO->delivery chains don't). Read after the
  // storeys.forEach loop, once firstOccurrenceByCategory is known, to add
  // just the delivery -> first-installation relationship per category.
  const procurementDeliveryTempIdByCategory = new Map<string, string>()
  if (includeFullSchedule) {
    const preliminariesWbsTempId = 'wbs-preliminaries'
    activities.push({
      temp_id: preliminariesWbsTempId, task_name: 'Preliminaries', parent_temp_id: rootTempId,
      duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
    })
    let previousPrelimTempId: string | null = null
    for (const phase of resolvePhases('Preliminaries')) {
      const rate = rates[phaseRowId('Preliminaries', phase.key)] ?? phase.rate
      const tempId = `act-preliminaries-${phase.key}`
      activities.push({
        temp_id: tempId, task_name: phase.label, parent_temp_id: preliminariesWbsTempId,
        duration_hours: computeDurationHours(1, rate), element_refs: [], element_labels: [],
        category: 'Preliminaries', phase_key: phase.key, quantity: 1, activity_type: 'task',
        discipline: disciplineFor('Preliminaries', phase.key),
      })
      if (previousPrelimTempId) relationships.push({ predecessor_temp_id: previousPrelimTempId, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
      else relationships.push({ predecessor_temp_id: constructionStartTempId, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
      previousPrelimTempId = tempId
    }

    const earthworksWbsTempId = 'wbs-substructure-earthworks'
    activities.push({
      temp_id: earthworksWbsTempId, task_name: 'Substructure Earthworks', parent_temp_id: rootTempId,
      duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
    })
    let previousEarthworksTempId: string | null = null
    for (const phase of resolvePhases('Substructure Earthworks')) {
      const rate = rates[phaseRowId('Substructure Earthworks', phase.key)] ?? phase.rate
      const tempId = `act-earthworks-${phase.key}`
      activities.push({
        temp_id: tempId, task_name: phase.label, parent_temp_id: earthworksWbsTempId,
        duration_hours: computeDurationHours(1, rate), element_refs: [], element_labels: [],
        category: 'Substructure Earthworks', phase_key: phase.key, quantity: 1, activity_type: 'task',
        discipline: disciplineFor('Substructure Earthworks', phase.key),
      })
      // First earthworks phase chains off Preliminaries' own last phase
      // (site clearance must finish before bulk excavation starts) — falls
      // back to Construction Start directly only in the pathological case
      // where Preliminaries somehow generated no phases at all.
      const predecessor = previousEarthworksTempId ?? previousPrelimTempId ?? constructionStartTempId
      relationships.push({ predecessor_temp_id: predecessor, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
      previousEarthworksTempId = tempId
    }
    earthworksExitTempId = previousEarthworksTempId

    // Procurement — Long-Lead Items (2026-07-25 — see
    // procurementDeliveryTempIdByCategory's own header just above for why
    // this moved here). usedCategoryNames(storeys) is a pure read of the
    // real IFC-derived storeys, safe to call before storeys.forEach runs —
    // only the final "delivery -> first real installation" edge actually
    // needs anything the forEach loop itself produces.
    const procurableCategoriesUsed = usedCategoryNames(storeys).filter(name => PROCURABLE_CATEGORIES.has(name))
    if (procurableCategoriesUsed.length > 0) {
      const procurementWbsTempId = 'wbs-procurement'
      activities.push({
        temp_id: procurementWbsTempId, task_name: 'Procurement — Long-Lead Items', parent_temp_id: rootTempId,
        duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
      })
      const procurementPhases = resolvePhases('Procurement')
      for (const categoryName of procurableCategoriesUsed) {
        const slug = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        let previousTempId: string | null = null
        for (const phase of procurementPhases) {
          const rate = rates[phaseRowId('Procurement', phase.key)] ?? phase.rate
          const tempId = `act-procurement-${slug}-${phase.key}`
          activities.push({
            temp_id: tempId, task_name: `${phase.label} — ${categoryName}`, parent_temp_id: procurementWbsTempId,
            duration_hours: computeDurationHours(1, rate), element_refs: [], element_labels: [],
            category: 'Procurement', phase_key: phase.key, quantity: 1, activity_type: 'task',
            discipline: disciplineFor('Procurement', phase.key),
          })
          relationships.push({
            predecessor_temp_id: previousTempId ?? constructionStartTempId, successor_temp_id: tempId,
            relationship_type: 'FS', lag_hours: 0,
          })
          previousTempId = tempId
        }
        if (previousTempId) procurementDeliveryTempIdByCategory.set(categoryName, previousTempId)
      }
    }
  }

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
  // Collected across every storey for the "All Building Work Complete" gate
  // below (2026-07-25 — see LATE_CATEGORIES' own header).
  const lastNonLateTempIds: string[] = []
  const firstLateTempIds: string[] = []
  // One entry per storey, in the same elevation order `storeys` is already
  // sorted in, unconditionally pushed (2026-07-25, per Maro: "windows are
  // all generated at the same time... these would follow a careful rhythm
  // from bottom to top" — see FACADE_CATEGORIES' own bottom-up handoff
  // chain further down for the fix) — null/null for a storey with no real
  // facade category at all, filtered out when the chain itself is built so
  // it doesn't insert a false link across a facade-less floor.
  const facadeHandoffByStorey: { firstFacadeTempId: string | null; lastFacadeTempId: string | null }[] = []
  // Every category name's own very first phase activity anywhere across the
  // whole building, in storey-elevation order (2026-07-25, per Maro — see
  // PROCUREMENT_CATEGORIES' own header) — storeys are already iterated
  // bottom-up by elevation, so the first time a category name is seen here
  // is naturally its lowest, earliest-installed occurrence, exactly what a
  // real procurement delivery needs to be linked in front of. Populated
  // unconditionally (cheap, no behaviour change when includeFullSchedule is
  // off — nothing ever reads this map in that case).
  const firstOccurrenceByCategory = new Map<string, string>()

  storeys.forEach((storey, storeyIndex) => {
    const wbsTempId = `wbs-storey-${storeyIndex}`
    activities.push({
      temp_id: wbsTempId, task_name: storey.storeyName, parent_temp_id: rootTempId, duration_hours: 0,
      element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
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
    let lastFacadeTempId: string | null = null
    let lastNonLateTempId: string | null = null
    let firstLateTempId: string | null = null
    storey.categories.forEach((category, categoryIndex) => {
      elementCount += category.elementRefs.length
      const phases = resolvePhases(category.name)
      const isStructural = STRUCTURAL_CATEGORIES.has(category.name)
      const isWalls = category.name === 'Walls'
      const isFacade = FACADE_CATEGORIES.has(category.name)
      const isLate = LATE_CATEGORIES.has(category.name)
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
          element_labels: phaseIndex === phases.length - 1 ? category.elementLabels : [],
          category: category.name, phase_key: phase.key, quantity: category.quantity, activity_type: 'task',
          discipline: disciplineFor(category.name, phase.key),
        })
        firstTempId ??= tempId
        if (phaseIndex === 0 && !firstOccurrenceByCategory.has(category.name)) firstOccurrenceByCategory.set(category.name, tempId)
        if (isStructural) {
          firstStructuralTempId ??= tempId
          lastStructuralTempId = tempId
        }
        // Excludes Late (2026-07-25) same as Facade — neither should ever
        // become a storey's own fallback handoff anchor: a storey made up
        // of ONLY site/landscaping elements (a dedicated ground/site level)
        // must be skipped over in the structural climb chain entirely, the
        // same way a facade-only storey already is — see StoreyHandoff's
        // own header for why a fallback anchor exists at all, and why it
        // must never land on a category that's deliberately sequenced
        // apart from the rest of the building.
        if (!isFacade && !isLate) {
          firstNonFacadeTempId ??= tempId
          lastNonFacadeTempId = tempId
        }
        if (isWalls) { lastWallsTempId = tempId; lastWallsCategoryIndex = categoryIndex }
        if (isFacade && firstFacadeTempId === null) { firstFacadeTempId = tempId; firstFacadeCategoryIndex = categoryIndex }
        // Tracks the true last facade-category phase in this storey's own
        // local order (2026-07-25, per Maro: "windows are all generated at
        // the same time [after Structure Complete]... these would follow a
        // careful rhythm from bottom to top" — confirmed live via the
        // Animation Timeline: once the global gate below fires, every
        // storey's own firstFacadeTempId becomes eligible simultaneously,
        // since nothing chains one storey's facade to the next the way
        // STRUCTURAL_CATEGORIES' own handoff already does for structure).
        // Feeds the facade-specific handoff chain further down, alongside
        // (not replacing) the existing Structure Complete gate.
        if (isFacade) lastFacadeTempId = tempId
        // Tracks the true last non-Landscaping phase in this storey's own
        // local order (2026-07-25) — CATEGORY_ORDER always sorts Site &
        // Landscaping dead last, so this ends up as whatever category
        // genuinely comes right before it here (Furnishings, MEP trim-out,
        // Coverings, ...), feeding the "All Building Work Complete" gate
        // below. firstLateTempId is this storey's own first Landscaping
        // phase, if it has one.
        if (!isLate) lastNonLateTempId = tempId
        else if (firstLateTempId === null) firstLateTempId = tempId
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
    // No local-conflict guard needed here (2026-07-25) — unlike Facade,
    // which a hand-arranged Collection could theoretically place before
    // Walls, CATEGORY_ORDER unconditionally sorts Site & Landscaping dead
    // last on the automatic scan path this whole generator runs on, so
    // lastNonLateTempId can never itself be a Landscaping phase feeding
    // back into firstLateTempId.
    if (lastNonLateTempId) lastNonLateTempIds.push(lastNonLateTempId)
    if (firstLateTempId) firstLateTempIds.push(firstLateTempId)
    // Same noLocalConflict guard as lastWallsTempIds/firstFacadeTempIds just
    // above — a storey with a local Facade-before-Walls contradiction
    // shouldn't feed the facade-to-facade handoff chain either, same
    // reasoning as why it doesn't feed the Structure Complete gate.
    facadeHandoffByStorey.push({
      firstFacadeTempId: noLocalConflict ? firstFacadeTempId : null,
      lastFacadeTempId: noLocalConflict ? lastFacadeTempId : null,
    })
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

  // Facade handoff — a real bottom-to-top installation wave, not "every
  // floor's facade starts the instant Structure Complete fires" (2026-07-25,
  // per Maro, confirmed live via the Animation Timeline: every storey's own
  // windows appeared simultaneously the moment structure finished, not the
  // "careful rhythm from bottom to top" a real facade crew actually climbs
  // in). The "Structure Complete — All Levels" gate below still stands — no
  // facade work anywhere can start before every level's walls are done — but
  // once it fires, THIS chain is what actually staggers each storey's own
  // facade start behind the storey below it finishing its own facade first,
  // the same elevation-ascending climb handoffAnchors already gives
  // structure. Same "filter to storeys with a real anchor, chain
  // consecutively, skip anything with neither" shape as handoffAnchors — a
  // storey with no facade category at all (all-MEP, all-finishes) is simply
  // skipped over, exactly as if it weren't part of this particular chain
  // (it has no facade work to sequence in the first place). Additive to,
  // never a replacement for, the "Structure Complete -> every storey's own
  // firstFacadeTempId" fan-out just below: for the very first facade-having
  // storey this chain is empty-predecessor and that fan-out edge is its only
  // real gate; every storey after it also keeps that same edge (still
  // correct — its own facade genuinely can't start before Structure
  // Complete either — just no longer the *binding* constraint once the
  // storey below it takes longer to finish, which is exactly the desired
  // wave). Forward-only across increasing elevation, same direction as
  // handoffAnchors' own chain and the "All Building Work Complete" gate
  // below — no new cycle risk for the same reason those don't have one.
  const facadeAnchors = facadeHandoffByStorey
    .filter((h): h is { firstFacadeTempId: string; lastFacadeTempId: string } =>
      h.firstFacadeTempId !== null && h.lastFacadeTempId !== null)
  for (let i = 0; i < facadeAnchors.length - 1; i++) {
    relationships.push({
      predecessor_temp_id: facadeAnchors[i].lastFacadeTempId, successor_temp_id: facadeAnchors[i + 1].firstFacadeTempId,
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
      duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
    })
    for (const fromId of lastWallsTempIds) {
      relationships.push({ predecessor_temp_id: fromId, successor_temp_id: structureCompleteTempId, relationship_type: 'FS', lag_hours: 0 })
    }
    for (const toId of firstFacadeTempIds) {
      relationships.push({ predecessor_temp_id: structureCompleteTempId, successor_temp_id: toId, relationship_type: 'FS', lag_hours: 0 })
    }
  }

  // "All Building Work Complete" (2026-07-25, per Maro — see
  // LATE_CATEGORIES' own header) — same guarded-milestone pattern as
  // Structure Complete — All Levels just above, one project stage later:
  // only added when there's genuinely a Landscaping category somewhere AND
  // at least one other real activity somewhere to gate it behind (a file
  // with no Site & Landscaping elements at all generates no such gate,
  // same as the facade gate above).
  if (lastNonLateTempIds.length > 0 && firstLateTempIds.length > 0) {
    activities.push({
      temp_id: allWorkCompleteTempId, task_name: 'All Building Work Complete', parent_temp_id: milestonesWbsTempId,
      duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
    })
    for (const fromId of lastNonLateTempIds) {
      relationships.push({ predecessor_temp_id: fromId, successor_temp_id: allWorkCompleteTempId, relationship_type: 'FS', lag_hours: 0 })
    }
    for (const toId of firstLateTempIds) {
      relationships.push({ predecessor_temp_id: allWorkCompleteTempId, successor_temp_id: toId, relationship_type: 'FS', lag_hours: 0 })
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
    // Chains off the end of Substructure Earthworks instead of straight off
    // Construction Start when full-schedule mode is on (2026-07-25) — a real
    // Foundation pour genuinely can't start before excavation/backfill/
    // blinding are done; earthworksExitTempId is null (falls back to
    // Construction Start directly) when the flag is off, reproducing the
    // exact pre-2026-07-25 edge.
    const firstOfSchedule = handoffAnchors[0]?.firstId
    if (firstOfSchedule) {
      relationships.push({
        predecessor_temp_id: earthworksExitTempId ?? constructionStartTempId, successor_temp_id: firstOfSchedule,
        relationship_type: 'FS', lag_hours: 0,
      })
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

  // Procurement (2026-07-25, per Maro's own real example — a real Primavera
  // Tower 2B export's "Drawings & Procurement" section) — one submittal ->
  // approval -> PO -> delivery chain per real category actually present in
  // this generation that's genuinely a procured/selected item (see
  // PROCURABLE_CATEGORIES' own header), starting immediately off
  // Construction Start (runs in parallel with Preliminaries/Earthworks/the
  // structural climb, same as a real project orders long-lead materials
  // while groundworks are still underway) and feeding into that category's
  // own first real installation activity anywhere in the building — you
  // can't glaze a curtain wall panel that hasn't been delivered yet.
  if (includeFullSchedule) {
    const procurableCategoriesUsed = [...firstOccurrenceByCategory.keys()].filter(name => PROCURABLE_CATEGORIES.has(name))
    if (procurableCategoriesUsed.length > 0) {
      const procurementWbsTempId = 'wbs-procurement'
      activities.push({
        temp_id: procurementWbsTempId, task_name: 'Procurement — Long-Lead Items', parent_temp_id: rootTempId,
        duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
      })
      const procurementPhases = resolvePhases('Procurement')
      for (const categoryName of procurableCategoriesUsed) {
        const slug = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        let previousTempId: string | null = null
        for (const phase of procurementPhases) {
          const rate = rates[phaseRowId('Procurement', phase.key)] ?? phase.rate
          const tempId = `act-procurement-${slug}-${phase.key}`
          activities.push({
            temp_id: tempId, task_name: `${phase.label} — ${categoryName}`, parent_temp_id: procurementWbsTempId,
            duration_hours: computeDurationHours(1, rate), element_refs: [], element_labels: [],
            category: 'Procurement', phase_key: phase.key, quantity: 1, activity_type: 'task',
            discipline: disciplineFor('Procurement', phase.key),
          })
          relationships.push({
            predecessor_temp_id: previousTempId ?? constructionStartTempId, successor_temp_id: tempId,
            relationship_type: 'FS', lag_hours: 0,
          })
          previousTempId = tempId
        }
        const installTempId = firstOccurrenceByCategory.get(categoryName)
        if (previousTempId && installTempId) {
          relationships.push({ predecessor_temp_id: previousTempId, successor_temp_id: installTempId, relationship_type: 'FS', lag_hours: 0 })
        }
      }
    }

    // Testing & Commissioning + Project Handover (2026-07-25, per Maro's own
    // real example — the same Tower 2B export: "Elevators final finish" ->
    // "Testing & Commissioning" -> "Project Handing over" as three distinct
    // closing stages). Gated behind Substantial Completion, which is already
    // fed by every storey's own true last activity (including its own
    // Landscaping phase, if any — see Substantial Completion's own header) —
    // nothing here needs to separately wait on All Building Work Complete.
    // Fire/Life Safety, Elevator, and MEP testing run in parallel (independent
    // systems); BMS commissioning — which integrates all of them — runs
    // after all three converge; Project Handover is the network's true final
    // node, succeeding BMS commissioning.
    if (handoffByStorey.length > 0) {
      // Parented to rootTempId, not milestonesWbsTempId (2026-07-25 fix, per
      // Maro: "why is testing and commissioning inside Project Milestones" —
      // it's a real 25-day work package with real testing activities inside
      // it, not a 0-duration milestone; Project Milestones is reserved for
      // Construction Start/Substantial Completion/Structure Complete/All
      // Building Work Complete/Project Handover, every one of which is a
      // genuine activity_type: 'start_milestone'/'finish_milestone', unlike
      // this WBS folder itself).
      const commissioningWbsTempId = 'wbs-testing-commissioning'
      activities.push({
        temp_id: commissioningWbsTempId, task_name: 'Testing & Commissioning', parent_temp_id: rootTempId,
        duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'task', discipline: null,
      })
      const commissioningPhases = resolvePhases('Testing & Commissioning')
      const bmsPhase = commissioningPhases.find(p => p.key === 'bms')!
      const parallelPhases = commissioningPhases.filter(p => p.key !== 'bms')
      const parallelTempIds: string[] = []
      for (const phase of parallelPhases) {
        const rate = rates[phaseRowId('Testing & Commissioning', phase.key)] ?? phase.rate
        const tempId = `act-commissioning-${phase.key}`
        activities.push({
          temp_id: tempId, task_name: phase.label, parent_temp_id: commissioningWbsTempId,
          duration_hours: computeDurationHours(1, rate), element_refs: [], element_labels: [],
          category: 'Testing & Commissioning', phase_key: phase.key, quantity: 1, activity_type: 'task',
          discipline: disciplineFor('Testing & Commissioning', phase.key),
        })
        relationships.push({ predecessor_temp_id: substantialCompletionTempId, successor_temp_id: tempId, relationship_type: 'FS', lag_hours: 0 })
        parallelTempIds.push(tempId)
      }
      const bmsRate = rates[phaseRowId('Testing & Commissioning', bmsPhase.key)] ?? bmsPhase.rate
      const bmsTempId = 'act-commissioning-bms'
      activities.push({
        temp_id: bmsTempId, task_name: bmsPhase.label, parent_temp_id: commissioningWbsTempId,
        duration_hours: computeDurationHours(1, bmsRate), element_refs: [], element_labels: [],
        category: 'Testing & Commissioning', phase_key: bmsPhase.key, quantity: 1, activity_type: 'task',
        discipline: disciplineFor('Testing & Commissioning', bmsPhase.key),
      })
      for (const fromId of parallelTempIds) {
        relationships.push({ predecessor_temp_id: fromId, successor_temp_id: bmsTempId, relationship_type: 'FS', lag_hours: 0 })
      }

      const projectHandoverTempId = 'act-project-handover'
      activities.push({
        temp_id: projectHandoverTempId, task_name: 'Project Handover', parent_temp_id: milestonesWbsTempId,
        duration_hours: 0, element_refs: [], element_labels: [], category: null, phase_key: null, quantity: null, activity_type: 'finish_milestone', discipline: null,
      })
      relationships.push({ predecessor_temp_id: bmsTempId, successor_temp_id: projectHandoverTempId, relationship_type: 'FS', lag_hours: 0 })
    }
  }

  const acyclicRelationships = makeRelationshipsAcyclic(activities, relationships)

  return {
    staged: { project_id: projectId, schedule_period_id: schedulePeriodId, calendar_id: calendarId, activities, resources, assignments, relationships: acyclicRelationships },
    summary: {
      storeyCount: storeys.length,
      activityCount: activities.length,
      relationshipCount: acyclicRelationships.length,
      elementCount,
    },
  }
}

// A hard, structural guarantee that this generator can never hand
// schedule_bulk_generate.py a cyclic relationship set (2026-07-21, per
// Maro, after a real cycle on a real Hotel model: "this issue needs to be
// fixed once and for all... there shouldn't be a circular relationship
// ever, if confused simplify the relationship - fs"). The real cycle:
// "12-CEILING LEVEL" has no structural category at all (curtain walls,
// coverings, furnishings only), so the structural-handoff chain's own
// fallback anchor (firstNonFacadeTempId/lastNonFacadeTempId, meant for a
// pure-MEP/finishes storey with genuinely nothing else to anchor on — see
// StoreyHandoff's own header) lands on that storey's Furnishings phase —
// which, in THIS storey's own local chain, sits AFTER its own Curtain
// Walls phase, itself fed by the global "Structure Complete" gate. That
// closes a loop: gate -> this storey's Curtain Walls -> (local chain) ->
// Furnishings -> (handoff fallback) -> next storey's Slabs -> (local
// chain) -> next storey's Walls -> gate. This is the fourth distinct real
// cycle shape this generator has produced (three earlier ones already
// root-caused and patched individually — the facade-only-storey anchor
// fix and the local Facade-before-Walls skip above are two of them) — a
// fourth targeted patch would only close this one specific shape, the
// same way the first three didn't close this one. This function instead
// makes the *output* provably acyclic regardless of which storey/category
// arrangement produced it, so a fifth real-world IFC file with yet another
// odd storey shape can degrade this generator's plan quality, but can
// never again produce a request schedule_bulk_generate.py rejects outright
// — automation later in the pipeline (Resources/Cost/Risk generation, all
// built on top of a committed schedule) can always assume one exists.
//
// Method: rank every activity by a real topological sort (Kahn's
// algorithm) over the candidate edges, breaking ties — and, critically,
// breaking any actual cycle — by falling back to `activities`' own
// insertion order (root -> milestones -> storey by storey -> category by
// category -> phase by phase), which is already a real, deterministic,
// PM-meaningful default sequence on its own. Only ever forced when no
// node is genuinely "ready" (in-degree 0), i.e., exactly when a cycle
// exists among whatever's left — everywhere else this is a completely
// normal topological sort and every edge survives untouched. Once every
// activity has a final rank, keep only the edges consistent with it
// (predecessor's rank < successor's rank) — a relationship set built
// entirely from one strict total order can never cycle, by construction,
// so this is a proof, not a heuristic. Activity count stays in the low
// hundreds even for a huge IFC import (this is WBS granularity —
// storeys x categories x phases — not raw element count), so the plain
// linear "find the next ready activity" scan below is trivial, not worth
// a real priority-queue implementation.
function makeRelationshipsAcyclic(activities: StagedActivity[], relationships: StagedRelationship[]): StagedRelationship[] {
  const order = activities.map(a => a.temp_id)
  const adjacency = new Map<string, string[]>(order.map(id => [id, []]))
  const inDegree = new Map<string, number>(order.map(id => [id, 0]))
  for (const rel of relationships) {
    adjacency.get(rel.predecessor_temp_id)?.push(rel.successor_temp_id)
    inDegree.set(rel.successor_temp_id, (inDegree.get(rel.successor_temp_id) ?? 0) + 1)
  }

  const rank = new Map<string, number>()
  const done = new Set<string>()
  while (rank.size < order.length) {
    let next = order.find(id => !done.has(id) && (inDegree.get(id) ?? 0) === 0)
    // No zero-in-degree activity left among what's remaining -> the
    // remaining activities form a cycle. Force-picking the next one in
    // `order` instead of getting stuck is exactly "simplify the
    // relationship" per Maro — whichever edge(s) pointed backward into
    // this activity get dropped by the final filter below; the rest of
    // the cycle unwinds completely normally from here on.
    next ??= order.find(id => !done.has(id))!
    rank.set(next, rank.size)
    done.add(next)
    for (const successor of adjacency.get(next) ?? []) {
      if (!done.has(successor)) inDegree.set(successor, (inDegree.get(successor) ?? 0) - 1)
    }
  }

  return relationships.filter(rel => (rank.get(rel.predecessor_temp_id) ?? -1) < (rank.get(rel.successor_temp_id) ?? -1))
}
