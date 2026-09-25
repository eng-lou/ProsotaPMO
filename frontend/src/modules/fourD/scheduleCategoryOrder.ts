import type { ScheduleCategory } from './ifcScheduleExtraction'

// Split out of ifcScheduleExtraction.ts (2026-09-25) so scheduleGeneration.ts
// can use this list without importing that file's runtime code, which
// statically pulls in three.js and elementBatching. Scheduling, CostPlan,
// RiskRegister and IcdTracker all import scheduleGeneration, so every one of
// them was downloading three.js just for this array.
//
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
  // Piling first (2026-07-25) — real driven/bored piles are installed
  // before a pile cap/mat foundation can be poured on top of them; only
  // ever has real activities when the model has real IfcPile elements.
  'Piling', 'Foundation', 'Reinforcement', 'Columns', 'Beams', 'Slabs', 'Walls', 'Non-Structural Walls',
  // Elevators (2026-07-27) sits alongside Stairs/Ramps — all three are the
  // same "vertical circulation" family, sequenced together rather than
  // scattered; an elevator's own shaft/rail/car installation runs on the
  // same rough timeline as stairs going in floor-by-floor, well before
  // Roofs/envelope closes in.
  'Structural Members', 'Stairs', 'Elevators', 'Ramps', 'Roofs', 'Curtain Walls', 'Windows', 'Doors', 'Facade Ornamentation',
  'Ductwork', 'Piping', 'Electrical Containment', 'Railings', 'Coverings',
  'Air Terminals', 'Plumbing Fixtures', 'Lighting', 'Electrical Devices', 'Furnishings', 'Site & Landscaping',
]
